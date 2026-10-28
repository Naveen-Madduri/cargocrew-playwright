import { test, expect } from '@playwright/test';
import { HomePage } from './pages/HomePage';
import { PdpPage } from './pages/PdpPage';
import { CartPage } from './pages/CartPage';
import { open } from './helpers/site';
import { parsePrice, fetchCart, clearCart, BackendCart } from './helpers/price';

/**
 * End-to-end Cart page validation, as a single scenario rather than independent tests, so each
 * stage builds on the cart state left behind by the one before it - exactly as a real shopper
 * would experience it (empty -> one item -> embroidered -> two items -> back to empty).
 */
test('CP-01 - cart page: empty state, free shipping, quantity, embroidery, upsell, deletion, order summary, shipping and country', async ({ page }) => {
  test.setTimeout(6 * 60_000);

  const home = new HomePage(page);
  const pdp = new PdpPage(page);
  const cart = new CartPage(page);

  // The password-gate auth cookie (and therefore the backend cart it's keyed to) is shared across
  // every test run via the one `storageState` snapshot, so start from a guaranteed-empty cart.
  await clearCart(page);

  await test.step('CP-01 - empty cart page shows the empty state with no order summary or Clear cart', async () => {
    await cart.goto();

    await test.step('Empty state content', async () => {
      await expect.soft(cart.emptyHeading).toBeVisible();
      await expect.soft(cart.main).toContainText('Add an item to get started.');
      await expect.soft(cart.startShoppingLink).toBeVisible();
      await expect.soft(cart.startShoppingLink).toHaveAttribute('href', '/');
    });

    await test.step('No item count, Clear cart, order summary or free-shipping bar while empty', async () => {
      await expect.soft(cart.itemCountText).toHaveCount(0);
      await expect.soft(cart.clearCartButton).toHaveCount(0);
      await expect.soft(cart.freeShippingSection).toHaveCount(0);
      await expect.soft(cart.subtotalValue).toHaveCount(0);
      await expect.soft(cart.totalValue).toHaveCount(0);
    });

    await test.step('"Continue shopping" (header) navigates home', async () => {
      await cart.continueShoppingLink.click();
      await expect(page).toHaveURL(/\/$/);
    });
  });

  // A different random product every run deliberately exercises the pricing pipeline more broadly
  // than one hardcoded SKU would.
  let productName = '';
  let pdpPrice = 0;
  let backendCart!: BackendCart;

  await test.step('Add a product to the cart from its PDP, then go to the Cart page', async () => {
    // "Continue shopping" above navigates home via client-side routing, which can land this call
    // before the page's product cards (and their prices) have finished rendering - reload via goto.
    await home.goto();
    const picked = await home.randomProductCard();
    await open(page, picked.href);
    await pdp.expectLoaded();

    const pdpPriceText = await pdp.main.getByText(/^\$\d+\.\d{2}$/).first().innerText();
    pdpPrice = parsePrice(pdpPriceText);
    productName = picked.name;

    await pdp.addToBag();
    await pdp.closeCartDialog();
    await cart.goto();

    await expect(async () => {
      backendCart = await fetchCart(page);
      expect(backendCart.cartItems.some((i) => i.title === productName && i.quantity === 1)).toBe(true);
    }).toPass({ timeout: 10_000 });
  });

  await test.step('CP-02 - cart page shows the item, correct item count, and its price matches the PDP', async () => {
    // A hard (non-soft), bounded prerequisite: if the row never renders at all (seen for at least
    // one strap-variant product - see the BUG-CP-01 note below), every later step in this test would
    // otherwise also fail, each only after waiting out its own timeout, which can consume the whole
    // test's time budget before the real cause - a missing row - is ever reported.
    await expect(cart.itemRow(productName), 'cart page should render the item just added from its PDP').toBeVisible({ timeout: 15_000 });

    await expect.soft(cart.itemCountText).toHaveText('1 item');
    await expect.soft(cart.clearCartButton).toBeVisible();

    const cartUnitPrice = parsePrice(await cart.itemUnitPrice(productName).innerText({ timeout: 15_000 }));
    expect.soft(cartUnitPrice, 'Cart page unit price should match the PDP').toBe(pdpPrice);

    const cartLineTotal = parsePrice(await cart.itemTotal(productName).innerText({ timeout: 15_000 }));
    expect.soft(cartLineTotal, 'Line total at qty 1 should equal the unit price').toBe(pdpPrice);

    // A plain (not knownBug-wrapped) assertion, deliberately: whether this reproduces depends on
    // which real product got randomly picked, so a failure here (not every run) is itself the
    // useful signal. Confirmed for at least one real product (a strap-variant apron bundle): the
    // cart items <ul> renders an extra orphan <li>Strap: ...</li> as its own sibling list item
    // instead of nesting that detail inside the product's own row, so the list's <li> count exceeds
    // the backend's real line count.
    expect.soft(await cart.itemsList.locator('li').count(), 'item list <li> count should equal the backend cart line count').toBe(backendCart.cartItems.length);
  });

  await test.step('CP-03 - free shipping progress bar reflects remaining spend and flips once unlocked', async () => {
    await test.step('Below threshold: shows remaining amount and a partial bar matching the backend total', async () => {
      expect.soft(backendCart.summaryShippingIsFree, 'backend should not yet consider shipping free').toBe(false);

      const remaining = 350 - backendCart.summaryCartValueIncTax.amount;
      await expect.soft(cart.freeShippingMessage).toContainText('away from');
      await expect.soft(cart.freeShippingMessage).toContainText(`$${remaining.toFixed(2)}`);

      const valueNow = Number(await cart.freeShippingProgressBar.getAttribute('aria-valuenow'));
      const expectedPct = Math.round((backendCart.summaryCartValueIncTax.amount / 350) * 100);
      expect.soft(valueNow, 'progress bar % should track spend toward $350').toBe(expectedPct);
      expect.soft(valueNow, 'progress bar should not be full below the threshold').toBeLessThan(100);
    });

    await test.step('Raising the quantity enough to cross $350 unlocks free shipping', async () => {
      for (let i = 0; i < 8 && backendCart.summaryCartValueIncTax.amount < 350; i++) {
        const current = String(backendCart.cartItems.find((it) => it.title === productName)!.quantity);
        await cart.setQuantity(productName, current, String(Number(current) + 1));
        backendCart = await fetchCart(page);
      }
      expect(backendCart.summaryCartValueIncTax.amount, 'test setup should have crossed the $350 threshold').toBeGreaterThanOrEqual(350);

      await expect.soft(cart.freeShippingMessage).toContainText('Nice, you’ve unlocked');
      await expect.soft(cart.freeShippingMessage).not.toContainText('away from');
      await expect.soft(cart.freeShippingProgressBar).toHaveAttribute('aria-valuenow', '100');
    });

    await test.step('Dropping back below $350 reverts to the "away from" message', async () => {
      while (backendCart.cartItems.find((it) => it.title === productName)!.quantity > 1) {
        const current = String(backendCart.cartItems.find((it) => it.title === productName)!.quantity);
        await cart.setQuantity(productName, current, String(Number(current) - 1));
        backendCart = await fetchCart(page);
      }
      await expect.soft(cart.freeShippingMessage).toContainText('away from');
    });
  });

  await test.step('CP-04 - quantity stepper updates the line and order summary, and cannot go below 1', async () => {
    await test.step('Decrease is disabled at the minimum quantity of 1', async () => {
      await expect.soft(cart.quantityInput(productName)).toHaveValue('1');
      await expect.soft(cart.decreaseQtyButton(productName)).toBeDisabled();
    });

    const unitPriceBefore = parsePrice(await cart.itemUnitPrice(productName).innerText());

    await test.step('Increasing quantity updates the stepper, the line total, and the order summary - but not the unit price', async () => {
      await cart.setQuantity(productName, '1', '2');
      await expect.soft(cart.quantityInput(productName)).toHaveValue('2');

      const unitPriceAfter = parsePrice(await cart.itemUnitPrice(productName).innerText());
      expect.soft(unitPriceAfter, 'the unit price should stay per-unit, not scale with quantity').toBe(unitPriceBefore);

      const lineTotal = parsePrice(await cart.itemTotal(productName).innerText());
      expect.soft(Math.round(Math.abs(lineTotal - unitPriceAfter * 2) * 100) / 100, 'line total should be unit price x quantity').toBeLessThanOrEqual(0.01);

      backendCart = await fetchCart(page);
      const totalAfter = parsePrice(await cart.totalValue.innerText());
      expect.soft(totalAfter, 'order summary Total should match the backend total').toBe(backendCart.total.amount);
    });

    await test.step('Decreasing quantity back down updates everything again', async () => {
      await cart.setQuantity(productName, '2', '1');
      await expect.soft(cart.quantityInput(productName)).toHaveValue('1');
      await expect.soft(cart.decreaseQtyButton(productName)).toBeDisabled();

      backendCart = await fetchCart(page);
      const totalAfter = parsePrice(await cart.totalValue.innerText());
      expect.soft(totalAfter).toBe(backendCart.total.amount);
    });
  });

  await test.step('CP-05 - add and then edit embroidery on a line item', async () => {
    const subtotalBefore = parsePrice(await cart.subtotalValue.innerText());

    await test.step('Adding name embroidery creates its own priced sub-line and updates the order summary', async () => {
      await cart.addNameEmbroidery(productName, 'CARGO');
      await expect.soft(cart.embroideryDetails(productName)).toContainText('Name: CARGO');
      await expect.soft(cart.embroideryDetails(productName)).toContainText('Font: BLOCK');
      await expect.soft(cart.addEmbroideryButton(productName)).toHaveCount(0);

      backendCart = await fetchCart(page);
      const subtotalAfter = parsePrice(await cart.subtotalValue.innerText());
      // Embroidery adds a flat $12 (inc GST) line - ex-GST that's $12 / 1.1.
      expect.soft(Math.round((subtotalAfter - subtotalBefore) * 100) / 100, 'Subtotal should rise by embroidery\'s ex-GST price').toBeCloseTo(12 / 1.1, 1);
      expect.soft(parsePrice(await cart.totalValue.innerText())).toBe(backendCart.total.amount);
    });

    await test.step('"Edit" reopens the dialog pre-filled, and saving a new name updates the line', async () => {
      await expect(cart.editEmbroideryButton(productName)).toBeVisible();
      await cart.editEmbroideryButton(productName).click();
      await expect(cart.embroideryDialog).toBeVisible();
      await expect(cart.nameEmbroidery().nameField).toHaveValue('CARGO');
      await cart.embroideryDialog.getByRole('button', { name: 'Close' }).click();
      await expect(cart.embroideryDialog).toBeHidden();

      await cart.addNameEmbroidery(productName, 'CREW');
      await expect.soft(cart.embroideryDetails(productName)).toContainText('Name: CREW');
      await expect.soft(cart.embroideryDetails(productName)).not.toContainText('Name: CARGO');
    });
  });

  let secondProductName = '';

  await test.step('CP-06 - "Add a little extra" adds a suggested product and excludes items already in the cart', async () => {
    await expect.soft(cart.addALittleExtraSection.getByText(productName, { exact: true })).toHaveCount(0);

    const extraRow = cart.addALittleExtraSection.locator('li').first();
    await expect(extraRow).toBeVisible();
    secondProductName = (await extraRow.locator('img').getAttribute('alt'))!;
    const extraPriceBeforeAdd = parsePrice(await cart.extraItemPrice(secondProductName).innerText());

    await cart.addExtraItem(secondProductName);
    await expect.soft(cart.itemRow(secondProductName)).toBeVisible();
    await expect.soft(cart.itemCountText).toHaveText('2 items');

    const lineUnitPrice = parsePrice(await cart.itemUnitPrice(secondProductName).innerText());
    expect.soft(lineUnitPrice, 'line price should match the suggestion price shown before adding').toBe(extraPriceBeforeAdd);

    backendCart = await fetchCart(page);
    const originalLine = backendCart.cartItems.find((i) => i.title === productName)!;
    expect.soft(originalLine.unitPrice.amount, "adding a suggestion shouldn't affect the original item's price").toBe(pdpPrice);

    await expect.soft(cart.addALittleExtraSection.getByText(secondProductName, { exact: true })).toHaveCount(0);
  });

  await test.step('CP-07 - order summary: every field is present and the figures reconcile with the backend', async () => {
    const subtotal = parsePrice(await cart.subtotalValue.innerText());
    const gst = parsePrice(await cart.gstValue.innerText());
    const total = parsePrice(await cart.totalValue.innerText());
    const shippingText = (await cart.shippingValue.innerText()).trim();

    await test.step('Each field is present', async () => {
      await expect.soft(cart.subtotalValue).toBeVisible();
      await expect.soft(cart.shippingValue).toBeVisible();
      await expect.soft(cart.gstValue).toBeVisible();
      await expect.soft(cart.totalValue).toBeVisible();
    });

    await test.step('Figures match the backend cart exactly', async () => {
      backendCart = await fetchCart(page);
      expect.soft(subtotal, 'Subtotal (ex GST) should match the backend').toBe(backendCart.subtotalNet.amount);
      expect.soft(gst, 'GST should match the backend').toBe(backendCart.includedTaxes.amount);
      expect.soft(total, 'Total should match the backend').toBe(backendCart.total.amount);
    });

    await test.step('Subtotal + GST reconciles to the Total, and shipping is deferred (not yet selected)', async () => {
      expect.soft(Math.round((subtotal + gst) * 100) / 100, 'Subtotal + GST should equal Total').toBe(total);
      expect.soft(shippingText).toBe('Calculated at checkout');
    });
  });

  await test.step('CP-08 - removing a product deletes the line and recalculates totals', async () => {
    await cart.removeItem(secondProductName);
    await expect.soft(cart.itemRow(secondProductName)).toHaveCount(0);
    await expect.soft(cart.itemRow(productName)).toBeVisible();
    await expect.soft(cart.itemCountText).toHaveText('1 item');

    backendCart = await fetchCart(page);
    expect.soft(backendCart.cartItems.map((i) => i.title)).not.toContain(secondProductName);
    const totalAfter = parsePrice(await cart.totalValue.innerText());
    expect.soft(totalAfter).toBe(backendCart.total.amount);
  });

  await test.step('CP-09 - shipping method selection updates Shipping and Total immediately', async () => {
    await test.step('Selecting "Aust Post - Parcel Post" adds a real shipping cost', async () => {
      await cart.selectShippingMethod('Aust Post - Parcel Post');
      await expect.soft(cart.shippingValue).not.toHaveText('Calculated at checkout');
      await expect.soft(cart.shippingValue).toHaveText(/^\$\d+\.\d{2}$/);

      backendCart = await fetchCart(page);
      const totalAfter = parsePrice(await cart.totalValue.innerText());
      expect.soft(totalAfter, 'Total should include the selected shipping cost').toBe(backendCart.total.amount);
      expect.soft(totalAfter, 'Total with shipping should exceed the shipping-free total').toBeGreaterThan(backendCart.subtotalNet.amount + backendCart.includedTaxes.amount);
    });

    await test.step('Selecting "Pick up CC Bundoora" makes shipping free', async () => {
      await cart.selectShippingMethod('Pick up CC Bundoora');
      await expect.soft(cart.shippingValue).toHaveText('Free');

      backendCart = await fetchCart(page);
      const totalAfter = parsePrice(await cart.totalValue.innerText());
      expect.soft(totalAfter, 'Total with free pickup should equal Subtotal + GST').toBe(backendCart.total.amount);
    });
  });

  await test.step('CP-10 - switching the shipping country to NZ changes the order summary shape', async () => {
    await test.step('NZ drops the GST line and AU shipping methods, and asks for state/region + postcode', async () => {
      await cart.selectCountry('NZ');
      await expect.soft(cart.gstValue).toHaveCount(0);
      await expect.soft(cart.summaryValue('Subtotal')).toBeVisible();
      await expect.soft(cart.shippingMethodRadio('Aust Post')).toHaveCount(0);
      await expect.soft(cart.stateRegionInput).toBeVisible();
      await expect.soft(cart.postcodeInput).toBeVisible();
      await expect.soft(cart.deliveryOptionsPrompt).toBeVisible();
      // Previously confirmed free-shipping progress is AU-specific - it disappears for NZ.
      await expect.soft(cart.freeShippingSection).toHaveCount(0);
    });

    await test.step('Entering a state/region and postcode replaces the prompt with either a quote or a clear error', async () => {
      await cart.stateRegionInput.fill('Auckland');
      await cart.postcodeInput.fill('1010');
      await page.waitForTimeout(1500);
      await expect.soft(cart.deliveryOptionsPrompt).toHaveCount(0);
      const gotQuoteOrError = (await cart.main.getByText(/\$\d+\.\d{2}|can.?t quote delivery/i).count()) > 0;
      expect.soft(gotQuoteOrError, 'should show either delivery options or a clear quoting error, not stay silent').toBe(true);
    });

    await test.step('Switching back to AU restores the full AU order summary', async () => {
      await cart.selectCountry('AU');
      await expect.soft(cart.gstValue).toBeVisible();
      await expect.soft(cart.summaryValue('Subtotal (ex GST)')).toBeVisible();
      await expect.soft(cart.shippingMethodRadio('Aust Post')).toBeVisible();
      await expect.soft(cart.freeShippingSection).toBeVisible();
      // The shipping method chosen before switching country does not survive the round trip.
      await expect.soft(cart.shippingValue).toHaveText('Calculated at checkout');
    });
  });

  await test.step('CP-11 - an unrecognised discount code is rejected with a clear error (negative)', async () => {
    const totalBefore = parsePrice(await cart.totalValue.innerText());

    await cart.applyDiscountCode('INVALIDCODE123');
    await expect.soft(cart.discountError).toBeVisible();

    const totalAfter = parsePrice(await cart.totalValue.innerText());
    expect.soft(totalAfter, 'an unrecognised code should not change the Total').toBe(totalBefore);
  });

  await test.step('CP-12 - Clear cart: Cancel keeps items, confirming empties the cart', async () => {
    await test.step('"Cancel" leaves the cart untouched', async () => {
      await cart.clearCartButton.click();
      await expect(cart.clearCartConfirmPanel).toBeVisible();
      await cart.clearCartCancelButton.click();
      await expect(cart.clearCartConfirmPanel).toBeHidden();
      await expect.soft(cart.itemRow(productName)).toBeVisible();
    });

    await test.step('"Yes, clear cart" empties it back to the empty-cart state', async () => {
      await cart.clearCart();
      await expect.soft(cart.emptyHeading).toBeVisible();
      await expect.soft(cart.freeShippingSection).toHaveCount(0);
      await expect.soft(cart.clearCartButton).toHaveCount(0);

      backendCart = await fetchCart(page);
      expect.soft(backendCart.cartCount, 'backend cart should also be empty').toBe(0);
    });
  });
});
