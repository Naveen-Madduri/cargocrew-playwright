import { test, expect } from '@playwright/test';
import { HomePage } from './pages/HomePage';
import { PdpPage } from './pages/PdpPage';
import { CartPage } from './pages/CartPage';
import { MiniCartPage } from './pages/MiniCartPage';
import { open } from './helpers/site';
import { parsePrice, fetchCart, clearCart, readOrderSummary, BackendCart } from './helpers/price';
import { knownBug } from './helpers/known-bug';

/**
 * End-to-end mini-cart flyout validation, as a single scenario rather than independent tests, so
 * each stage builds on the cart state left behind by the one before it (empty -> one item -> two
 * items -> back to empty) exactly as a real shopper would experience it.
 */
test('MC-01 - mini cart flyout: empty state, free shipping, quantity, delete, upsell, totals and PDP price parity', async ({ page }) => {
  test.setTimeout(5 * 60_000);

  const home = new HomePage(page);
  const pdp = new PdpPage(page);
  const miniCart = new MiniCartPage(page);

  // The password-gate auth cookie (and therefore the backend cart it's keyed to) is shared across
  // every test run via the one `storageState` snapshot, so start from a guaranteed-empty cart
  // rather than assuming one.
  await clearCart(page);

  await test.step('MC-01 - empty cart shows the empty state with no order summary or badge', async () => {
    await home.goto();

    await test.step('No badge on the cart icon while empty', async () => {
      await expect.soft(miniCart.cartBadge).toHaveCount(0);
    });

    await test.step('Clicking the header cart icon opens the flyout', async () => {
      await miniCart.openFromHeader();
      await expect(miniCart.dialog).toBeVisible();
    });

    await test.step('Empty state content', async () => {
      await expect.soft(miniCart.emptyHeading).toBeVisible();
      await expect.soft(miniCart.dialog).toContainText('Add an item to get started. Orders over $350 ship free.');
      await expect.soft(miniCart.startShoppingLink).toBeVisible();
      await expect.soft(miniCart.startShoppingLink).toHaveAttribute('href', '/');
    });

    await test.step('No order summary or free-shipping progress bar while empty', async () => {
      await expect.soft(miniCart.freeShippingSection).toHaveCount(0);
      await expect.soft(miniCart.subtotalValue).toHaveCount(0);
      await expect.soft(miniCart.totalValue).toHaveCount(0);
      await expect.soft(miniCart.itemsList).toHaveCount(0);
    });

    await test.step('"Start shopping" closes the flyout and returns home', async () => {
      await miniCart.startShoppingLink.click();
      await expect(miniCart.dialog).toBeHidden();
      await expect(page).toHaveURL(/\/$/);
    });
  });

  // A different random product every run deliberately exercises the pricing pipeline more broadly
  // than one hardcoded SKU would.
  let productName = '';
  let pdpPrice = 0;
  let cart!: BackendCart;

  await test.step('Add a product to the cart from its PDP', async () => {
    const picked = await home.randomProductCard();
    await open(page, picked.href);
    await pdp.expectLoaded();

    const pdpPriceText = await pdp.main.getByText(/^\$\d+\.\d{2}$/).first().innerText();
    pdpPrice = parsePrice(pdpPriceText);
    productName = picked.name;

    await pdp.addToBag();
    await expect(miniCart.dialog).toBeVisible();

    // The dialog becomes visible once the client renders the add response, but poll briefly anyway
    // so the first backend read never races a half-committed cart.
    await expect(async () => {
      cart = await fetchCart(page);
      expect(cart.cartItems.some((i) => i.title === productName && i.quantity === 1)).toBe(true);
    }).toPass({ timeout: 10_000 });
  });

  await test.step('MC-02 - the header cart icon opens a populated mini cart with a matching item-count badge', async () => {
    await test.step('Dialog shows the added product', async () => {
      await expect.soft(miniCart.dialog).toContainText(productName);
      await expect.soft(miniCart.emptyHeading).toHaveCount(0);
    });

    await test.step('Badge shows the correct item count', async () => {
      await expect.soft(miniCart.cartBadge).toHaveText('1');
    });

    await test.step('Closing and reopening from the header icon preserves cart state', async () => {
      await miniCart.close();
      await expect.soft(miniCart.cartIcon).toBeVisible();
      await miniCart.openFromHeader();
      await expect(miniCart.dialog).toBeVisible();
      await expect.soft(miniCart.dialog).toContainText(productName);
      await expect.soft(miniCart.cartBadge).toHaveText('1');
    });
  });

  await test.step('MC-03 - free shipping progress bar reflects remaining spend and flips once unlocked', async () => {
    await test.step('Below threshold: shows remaining amount and a partial bar matching the backend total', async () => {
      expect.soft(cart.summaryShippingIsFree, 'backend should not yet consider shipping free').toBe(false);

      const remaining = 350 - cart.summaryCartValueIncTax.amount;
      await expect.soft(miniCart.freeShippingMessage).toContainText('away from');
      await expect.soft(miniCart.freeShippingMessage).toContainText(`$${remaining.toFixed(2)}`);

      const valueNow = Number(await miniCart.freeShippingProgressBar.getAttribute('aria-valuenow'));
      const expectedPct = Math.round((cart.summaryCartValueIncTax.amount / 350) * 100);
      expect.soft(valueNow, 'progress bar % should track spend toward $350').toBe(expectedPct);
      expect.soft(valueNow, 'progress bar should not be full below the threshold').toBeLessThan(100);
    });

    await test.step('Raising the quantity enough to cross $350 unlocks free shipping', async () => {
      for (let i = 0; i < 8 && cart.summaryCartValueIncTax.amount < 350; i++) {
        const current = String(cart.cartItems.find((it) => it.title === productName)!.quantity);
        cart = await miniCart.setQuantity(productName, current, String(Number(current) + 1));
      }
      expect(cart.summaryCartValueIncTax.amount, 'test setup should have crossed the $350 threshold').toBeGreaterThanOrEqual(350);

      // The UI's own unlock state is the user-facing truth being tested, and is asserted directly
      // below (hard requirement). The backend's `summaryShippingIsFree` flag is additionally
      // expected to agree with it, but see BUG-MC-01 below.
      await expect.soft(miniCart.freeShippingMessage).toContainText('Nice, you’ve unlocked');
      await expect.soft(miniCart.freeShippingMessage).not.toContainText('away from');
      await expect.soft(miniCart.freeShippingProgressBar).toHaveAttribute('aria-valuenow', '100');

      await knownBug(
        'BUG-MC-01',
        "cart API's summaryShippingIsFree flag stays false even once the mini cart's own total crosses $350 and its UI shows 'Nice, you've unlocked Free Standard Shipping'",
        async () => expect(cart.summaryShippingIsFree, 'backend should now consider shipping free').toBe(true),
      );
    });

    await test.step('Dropping back below $350 reverts to the "away from" message', async () => {
      while (cart.cartItems.find((it) => it.title === productName)!.quantity > 1) {
        const current = String(cart.cartItems.find((it) => it.title === productName)!.quantity);
        cart = await miniCart.setQuantity(productName, current, String(Number(current) - 1));
      }
      await expect.soft(miniCart.freeShippingMessage).toContainText('away from');
    });
  });

  await test.step('MC-04 - quantity stepper updates the line and order summary, and cannot go below 1', async () => {
    await test.step('Decrease is disabled at the minimum quantity of 1', async () => {
      await expect.soft(miniCart.quantityInput(productName)).toHaveValue('1');
      await expect.soft(miniCart.decreaseQtyButton(productName)).toBeDisabled();
    });

    const unitPriceBefore = parsePrice(await miniCart.unitPrice(productName).innerText());

    await test.step('Increasing quantity updates the stepper, the backend line, and the order summary - but not the unit-price badge', async () => {
      cart = await miniCart.setQuantity(productName, '1', '2');
      await expect.soft(miniCart.quantityInput(productName)).toHaveValue('2');

      const line = cart.cartItems.find((i) => i.title === productName)!;
      expect.soft(line.quantity, 'backend line quantity should match the stepper').toBe(2);
      // Within a cent (rounded, to avoid float noise like 0.01000...019) - see the line-total
      // rounding note on the full Cart page check further down.
      expect.soft(
        Math.round(Math.abs(line.totalPrice.amount - line.unitPrice.amount * 2) * 100) / 100,
        'backend line total should be unit price x quantity',
      ).toBeLessThanOrEqual(0.01);

      const unitPriceAfter = parsePrice(await miniCart.unitPrice(productName).innerText());
      expect.soft(unitPriceAfter, 'the unit-price badge should stay the per-unit price, not scale with quantity').toBe(unitPriceBefore);

      const totalAfter = parsePrice(await miniCart.totalValue.innerText());
      expect.soft(totalAfter, 'order summary Total should match the backend total').toBe(cart.total.amount);
    });

    await test.step('Decreasing quantity back down updates everything again', async () => {
      cart = await miniCart.setQuantity(productName, '2', '1');
      await expect.soft(miniCart.quantityInput(productName)).toHaveValue('1');
      await expect.soft(miniCart.decreaseQtyButton(productName)).toBeDisabled();

      const line = cart.cartItems.find((i) => i.title === productName)!;
      expect.soft(line.quantity).toBe(1);
      const totalAfter = parsePrice(await miniCart.totalValue.innerText());
      expect.soft(totalAfter).toBe(cart.total.amount);
    });
  });

  let secondProductName = '';

  await test.step('MC-06 - "Add a little extra" adds a suggested product and excludes items already in the cart', async () => {
    await test.step('The product already in the cart is never offered as a suggestion', async () => {
      await expect.soft(miniCart.addALittleExtraSection.getByText(productName, { exact: true })).toHaveCount(0);
    });

    const extraRow = miniCart.addALittleExtraSection.locator('li').first();
    await expect(extraRow).toBeVisible();
    // The suggestions panel re-renders after every cart mutation (several just happened in
    // MC-03/04 above), and its name/price can briefly disagree mid-update - poll until stable.
    const { name: extraNameBeforeAdd, price: extraPriceBeforeAdd } = await miniCart.extraItemInfoStable(extraRow);
    secondProductName = extraNameBeforeAdd;

    await test.step('Adding a suggestion inserts it as its own line without closing the drawer', async () => {
      cart = await miniCart.addExtraItem(secondProductName);
      await expect(miniCart.dialog).toBeVisible();
      await expect.soft(miniCart.itemRow(secondProductName)).toBeVisible();
      await expect.soft(miniCart.cartBadge).toHaveText('2');
    });

    await test.step('Its price in the cart line matches the price shown in the suggestion and the backend', async () => {
      const lineUnitPrice = parsePrice(await miniCart.unitPrice(secondProductName).innerText());

      // A plain (not knownBug-wrapped) assertion, deliberately: this depends on which real product
      // the suggestions panel happens to surface for the randomly-picked main product, so whether
      // it fails is itself the useful signal for that specific product, run to run - reproduces
      // consistently for at least one real pair (e.g. "Tom Bib Apron - Ash": shown $47.99, added at
      // $37.39), and survives polling the suggestion card until its name/price pair is stable (see
      // `extraItemInfoStable`), so it isn't a render race - the card is just wrong about the price.
      expect.soft(lineUnitPrice, 'line price should match the suggestion price shown before adding').toBe(extraPriceBeforeAdd);

      const backendLine = cart.cartItems.find((i) => i.title === secondProductName)!;
      expect.soft(backendLine.unitPrice.amount).toBe(lineUnitPrice);
      const originalLine = cart.cartItems.find((i) => i.title === productName)!;
      expect.soft(originalLine.unitPrice.amount, "adding a suggestion shouldn't affect the original item's price").toBe(pdpPrice);
    });

    await test.step('Now that it is in the cart, it is no longer offered as a suggestion either', async () => {
      await expect.soft(miniCart.addALittleExtraSection.getByText(secondProductName, { exact: true })).toHaveCount(0);
    });
  });

  await test.step('MC-05 - removing a product deletes the line, leaving the other item intact', async () => {
    cart = await miniCart.removeItem(secondProductName);
    await expect.soft(miniCart.itemRow(secondProductName)).toHaveCount(0);
    await expect.soft(miniCart.itemRow(productName)).toBeVisible();

    expect.soft(cart.cartItems.map((i) => i.title)).not.toContain(secondProductName);
    expect.soft(cart.cartItems.map((i) => i.title)).toContain(productName);
    const totalAfter = parsePrice(await miniCart.totalValue.innerText());
    expect.soft(totalAfter).toBe(cart.total.amount);
  });

  await test.step('MC-07 - Subtotal (ex GST), GST and Total match the backend, and shipping is deferred to checkout', async () => {
    cart = await miniCart.setQuantity(productName, '1', '3');

    const subtotal = parsePrice(await miniCart.subtotalValue.innerText());
    const gst = parsePrice(await miniCart.gstValue.innerText());
    const total = parsePrice(await miniCart.totalValue.innerText());
    const shippingText = (await miniCart.shippingValue.innerText()).trim();

    await test.step('Figures match the backend cart exactly', async () => {
      expect.soft(subtotal, 'Subtotal (ex GST) should match the backend').toBe(cart.subtotalNet.amount);
      expect.soft(gst, 'GST should match the backend').toBe(cart.includedTaxes.amount);
      expect.soft(total, 'Total should match the backend').toBe(cart.total.amount);
    });

    await test.step('Subtotal + GST reconciles to the Total shown', async () => {
      expect.soft(Math.round((subtotal + gst) * 100) / 100, 'Subtotal + GST should equal Total').toBe(total);
    });

    await test.step('Shipping is explicitly deferred, not computed as a dollar amount in the mini cart', async () => {
      expect.soft(shippingText).toBe('Calculated at checkout');
      expect.soft(shippingText).not.toMatch(/^\$\d+\.\d{2}$/);
    });
  });

  await test.step('MC-08 - mini cart unit price matches the PDP price for the same product', async () => {
    await test.step('Mini cart line price matches the PDP price it was added from', async () => {
      const miniCartPrice = parsePrice(await miniCart.unitPrice(productName).innerText());
      expect.soft(miniCartPrice, 'Mini cart unit price should match the PDP').toBe(pdpPrice);
    });

    await test.step('Backend unit price also agrees', async () => {
      const line = cart.cartItems.find((i) => i.title === productName)!;
      expect.soft(line.unitPrice.amount, 'Backend unit price should match the PDP price').toBe(pdpPrice);
    });

    await test.step('Quantity (currently 3) does not make the mini cart unit price drift from the PDP price', async () => {
      const miniCartPriceAfter = parsePrice(await miniCart.unitPrice(productName).innerText());
      expect.soft(miniCartPriceAfter, 'Unit price badge should remain the single-unit PDP price, not a multiplied line total').toBe(pdpPrice);
    });
  });

  let miniCartSubtotal = 0;
  let miniCartGst = 0;
  let miniCartTotal = 0;

  await test.step('MC-09 - "View Cart & Checkout" matches the mini cart totals on the full Cart page', async () => {
    miniCartSubtotal = parsePrice(await miniCart.subtotalValue.innerText());
    miniCartGst = parsePrice(await miniCart.gstValue.innerText());
    miniCartTotal = parsePrice(await miniCart.totalValue.innerText());

    await test.step('"View Cart & Checkout" navigates to the full cart page', async () => {
      await expect(async () => {
        await miniCart.viewCartButton.click({ timeout: 5_000 });
        await expect(page).toHaveURL(/\/cart\/$/, { timeout: 5_000 });
      }).toPass({ timeout: 20_000 });
    });

    const cartPage = new CartPage(page);
    await expect(page.getByRole('heading', { name: 'Your Cart' })).toBeVisible();

    await test.step('The full cart page shows the same line item and quantity', async () => {
      await expect.soft(cartPage.itemRow(productName)).toBeVisible();
      const unitPrice = parsePrice(await cartPage.itemUnitPrice(productName).innerText());
      const lineTotal = parsePrice(await cartPage.itemTotal(productName).innerText());
      // Within a cent (rounded, to avoid float noise) of unit price x quantity - the backend can
      // round the line total slightly differently than multiplying the displayed (already-rounded)
      // unit price would suggest.
      expect
        .soft(Math.round(Math.abs(lineTotal - unitPrice * 3) * 100) / 100, 'line total should be unit price x quantity of 3')
        .toBeLessThanOrEqual(0.01);
    });

    await test.step('The full cart page order summary matches what the mini cart showed', async () => {
      const summary = await readOrderSummary(page);
      expect.soft(summary.subtotalExGst, 'Subtotal (ex GST) should match the mini cart').toBe(miniCartSubtotal);
      expect.soft(summary.gst, 'GST should match the mini cart').toBe(miniCartGst);
      expect.soft(summary.total, 'Total should match the mini cart').toBe(miniCartTotal);
    });
  });

  await test.step('MC-05 (cont.) - removing the only remaining item reverts to the empty-cart state', async () => {
    // The dedicated Cart page (just visited via "View Cart & Checkout") uses a minimal header with
    // no cart icon at all - go back to an ordinary page before reopening the mini cart from it.
    await home.goto();
    await miniCart.openFromHeader();
    cart = await miniCart.removeItem(productName);
    await expect.soft(miniCart.emptyHeading).toBeVisible();
    await expect.soft(miniCart.freeShippingSection).toHaveCount(0);
    await expect.soft(miniCart.cartBadge).toHaveCount(0);
    expect.soft(cart.cartCount, 'backend cart should also be empty').toBe(0);
  });
});
