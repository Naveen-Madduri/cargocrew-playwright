import { test, expect, Locator, TestInfo } from '@playwright/test';
import { HomePage } from './pages/HomePage';
import { PlpPage } from './pages/PlpPage';
import { PdpPage } from './pages/PdpPage';
import { knownBug } from './helpers/known-bug';
import { fetchPdpProduct, PdpProduct, StockState, OVER_STOCK_MESSAGE } from './helpers/pdp';
import { fetchCart, clearCart } from './helpers/price';

/**
 * Categories that contain only normal garments (shirts/pants), not bundles, gift cards or
 * accessories, so a random pick from either is always an eligible PDP-001 candidate.
 */
const ELIGIBLE_CATEGORIES = ['Tops', 'Bottoms'];

/** Parses the first "$X.XX" price found in a string of text. */
function parsePrice(text: string): number {
  const match = text.match(/\$(\d+(?:\.\d{2})?)/);
  if (!match) throw new Error(`No price found in "${text}"`);
  return parseFloat(match[1]);
}

/**
 * Selects the first in-stock option (if any) on a <select>, e.g. "Select size" or "Choose your
 * strap" - excluding `excludeValue` so a second call can pick a genuinely different option.
 */
async function selectInStockOption(select: Locator, excludeValue?: string) {
  const options = await select.locator('option').evaluateAll((opts) =>
    opts.map((o) => ({ value: (o as HTMLOptionElement).value, disabled: (o as HTMLOptionElement).disabled, text: o.textContent })),
  );
  const inStock = options.find((o) => o.value && !o.disabled && o.value !== excludeValue);
  if (inStock) await select.selectOption({ value: inStock.value });
  return { inStock, options };
}

/** The PDP stock badge text expected for each server-side stock state. */
const STOCK_BADGE: Record<StockState, RegExp> = {
  'in-stock': /^In Stock$/,
  low: /^Only \d+ Left$/,
  out: /^Out of Stock$/,
};

/**
 * PDP-001 - validate PDP visibility and functionality for a randomly selected product.
 *
 * Starts at the home page and reaches the product only by navigating Home -> PLP -> PDP (never a
 * direct /product/... URL), picks a random non-bundle/gift-card/accessory product from a
 * shirts-or-pants category, then validates content and interactions. Checks that don't apply to
 * the picked product (e.g. no colour variants) are reported as skipped rather than failed.
 */
test('PDP-001 - PDP validation for a randomly selected product', async ({ page }, testInfo) => {
  test.setTimeout(5 * 60_000);

  const home = new HomePage(page);
  const plp = new PlpPage(page);
  const pdp = new PdpPage(page);

  let productName = '';
  let productHref = '';
  // "As seen on our crews" / "More Great Wears" recommendation strips aren't consistently wrapped
  // in a landmark with a stable accessible name, but they do reuse the PLP card component (an
  // <article> per item) - so detecting by that is far more reliable than matching heading text.
  const recommendedCards = pdp.main.locator('article');

  await test.step('Step 1 - open the home page and verify header elements', async () => {
    await home.goto();
    await expect.soft(home.header).toBeVisible();
    await expect.soft(home.logo).toBeVisible();
    await expect.soft(home.searchInput).toBeVisible();
    await expect.soft(home.wishlistLink).toBeVisible();
    await expect.soft(home.accountLink).toBeVisible();
    await expect.soft(home.cartLink).toBeVisible();
    for (const item of ELIGIBLE_CATEGORIES) {
      await expect.soft(home.navLink(item)).toBeVisible();
    }
  });

  const category = ELIGIBLE_CATEGORIES[Math.floor(Math.random() * ELIGIBLE_CATEGORIES.length)];

  await test.step(`Step 2 - navigate to the "${category}" listing page`, async () => {
    await home.goToCategory(category);
    await expect(page).toHaveURL(new RegExp(`/${category.toLowerCase()}/$`));
    await expect(plp.productCards.first()).toBeVisible();
    await expect.soft(plp.productCards.first().locator('img').first()).toBeVisible();
  });

  await test.step('Step 3 - select a random eligible product and open its PDP', async () => {
    const picked = await plp.pickRandomEligibleProduct();
    productName = picked.name;
    productHref = picked.href;
    testInfo.annotations.push({ type: 'product under test', description: `${productName} (${productHref})` });

    await plp.cardTitle(picked.card).click();
    await expect(page).toHaveURL(new RegExp(`${productHref}$`));
    await pdp.expectLoaded();
    await expect(pdp.heading).toContainText(productName);
  });

  await test.step('Step 4 - validate PDP content visibility', async () => {
    await expect.soft(pdp.breadcrumb).toBeVisible();
    await expect.soft(pdp.breadcrumb).toContainText(productName);
    await pdp.expectGalleryImagesLoaded();
    await expect.soft(pdp.main).toContainText(/\$\d+\.\d{2}/);
    // Scoped to <span>, not getByText(), because a size dropdown's "XL - Out of Stock" <option>
    // also matches this text and would otherwise trip Playwright's strict-mode uniqueness check.
    await expect.soft(pdp.main.locator('span', { hasText: /^(In Stock|Out of Stock|Only \d+ Left)$/ })).toBeVisible();

    if (await pdp.quantity.count()) {
      await expect.soft(pdp.quantity).toBeVisible();
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: 'No quantity selector - product has no sizes in stock' });
    }

    if (await pdp.addToBagButton.count()) {
      await expect.soft(pdp.addToBagButton).toBeVisible();
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: 'No "Add to Bag" button - product has no sizes in stock' });
    }

    if (await pdp.colourSwatches.count()) {
      await expect.soft(pdp.colourSwatches).toBeVisible();
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: 'No colour variants on this product' });
    }

    if (await page.getByRole('combobox', { name: /select size/i }).count()) {
      await expect.soft(page.getByRole('combobox', { name: /select size/i })).toBeVisible();
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: 'No size selector on this product' });
    }

    if (await pdp.wishlistButton.count()) {
      await expect.soft(pdp.wishlistButton).toBeVisible();
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: 'No wishlist icon on this product' });
    }

    for (const name of ['Description', 'Garment care']) {
      const { heading } = pdp.accordion(name);
      if (await heading.count()) {
        await expect.soft(heading).toBeVisible();
      } else {
        testInfo.annotations.push({ type: 'skip reason', description: `No "${name}" accordion on this product` });
      }
    }

    if (await recommendedCards.count()) {
      await expect.soft(recommendedCards.first()).toBeVisible();
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: 'No related/recommended products section on this product' });
    }

    await pdp.footer.scrollIntoViewIfNeeded();
    await expect.soft(pdp.footer).toBeVisible();
  });

  let product!: PdpProduct;
  await test.step('Step 4b - PDP content matches the server\'s product data', async () => {
    product = await fetchPdpProduct(page, productHref);

    await expect.soft(pdp.heading, 'heading should match the API title').toHaveText(product.title);
    const displayedPrice = parsePrice(await pdp.main.getByText(/^\$\d+\.\d{2}$/).first().innerText());
    expect.soft(displayedPrice, 'displayed price should match the API price').toBe(product.price);

    const stockBadge = pdp.main.locator('span', { hasText: /^(In Stock|Out of Stock|Only \d+ Left)$/ });
    if (STOCK_BADGE[product.stock]) {
      await expect.soft(stockBadge, `stock badge should reflect API stock "${product.stock}"`).toHaveText(STOCK_BADGE[product.stock]);
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: `Unrecognised API stock state "${product.stock}"` });
    }

    for (const crumb of product.breadcrumbs) {
      await expect.soft(pdp.breadcrumb, `breadcrumb should include API label "${crumb.label}"`).toContainText(crumb.label);
    }

    await expect.soft(pdp.galleryEnlargeButtons(), 'gallery image count should match the API').toHaveCount(product.images.length);

    if (product.colour?.options.length) {
      await expect.soft(pdp.main).toContainText(`Colour: ${product.colour.selectedLabel}`);
      await expect
        .soft(pdp.colourSwatches.getByRole('link'), 'colour swatch count should match the API')
        .toHaveCount(product.colour.options.length);
    }

    if (product.rating?.count) {
      // Matched as one pattern because the rating and count are adjacent with no whitespace in the
      // text content ("4.915 Reviews"). Not via `pdp.reviewsButton`: some products render two of them.
      const { value, count } = product.rating;
      await expect
        .soft(pdp.main, 'rating and review count should match the API')
        .toContainText(new RegExp(`${value.toFixed(1).replace('.', '\\.')}\\s*${count} Reviews?`));
    }

    // One-size products (most aprons) still carry a single API "size" but render no dropdown.
    const sizeSelect = page.getByRole('combobox', { name: /select size/i });
    if (await sizeSelect.count()) {
      const options = await sizeSelect.locator('option').evaluateAll((opts) =>
        opts
          .map((o) => ({ value: (o as HTMLOptionElement).value, disabled: (o as HTMLOptionElement).disabled }))
          .filter((o) => o.value),
      );
      expect
        .soft(options, 'size options (and which are disabled) should match the API sizes and their stock')
        .toEqual(product.sizes.map((s) => ({ value: s.value, disabled: s.stock === 'out' })));
    }
  });

  await test.step('Step 6 - basic visual/layout sanity checks', async () => {
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect.soft(hasHorizontalScroll, 'page should not scroll horizontally at desktop width').toBe(false);

    // Content images only - recommendation cards are checked separately below and reuse the PLP
    // card component, whose second (hover-swap) image is intentionally decorative with alt="".
    const contentImages = pdp.main.locator('img').and(page.locator(':not(article *)'));
    for (const img of await contentImages.all()) {
      await expect.soft(img).toHaveAttribute('alt', /.+/);
    }
  });

  await testInfo.attach('pdp-screenshot', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  await test.step('Step 5a - quantity selector increments, decrements and rejects invalid input', async () => {
    if (await pdp.increaseQty.count()) {
      await expect.soft(pdp.quantity).toHaveValue('1');
      await pdp.setQuantity('1', '2');
      await pdp.setQuantity('2', '1');
      await expect.soft(pdp.decreaseQty).toBeDisabled();

      await pdp.quantity.fill('-1');
      const value = await pdp.quantity.inputValue();
      expect.soft(Number(value), 'quantity should not go below 1').toBeGreaterThanOrEqual(1);
      await pdp.quantity.fill('1');
    } else {
      // Backordered products (all sizes out of stock) render a "notify me" link instead of a
      // quantity stepper, so there's nothing purchasable to test here.
      testInfo.annotations.push({ type: 'skip reason', description: 'No quantity selector - product has no sizes in stock' });
    }
  });

  await test.step('Step 5b - selecting a colour variant navigates to that colour\'s PDP', async () => {
    if (await pdp.colourSwatches.count()) {
      const swatches = pdp.colourSwatches.getByRole('link');
      const other = swatches.and(page.locator(':not([aria-current="true"]):not([aria-current="page"])')).first();
      if (await other.count()) {
        const href = await other.getAttribute('href');
        await other.click();
        await expect(page).toHaveURL(new RegExp(`${href}$`));
        // The colour-swatch href changing plus the new PDP loading correctly is the meaningful
        // proof here. The heading's colour suffix isn't compared against the swatch's aria-label:
        // they can format a multi-colour name differently (e.g. "Vanilla/Black" vs "Vanilla &
        // Black"), and the heading's base name is a substring of every colour's heading anyway, so
        // neither a containment nor a non-containment check against it would be meaningful.
        await pdp.expectLoaded();
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await expect(pdp.heading).toContainText(productName);
      }
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: 'No colour variants to switch between' });
    }
  });

  await test.step('Step 5c - size dropdown lets the user pick an in-stock size; out-of-stock sizes are disabled', async () => {
    const sizeSelect = page.getByRole('combobox', { name: /select size/i });
    if (await sizeSelect.count()) {
      const { inStock, options } = await selectInStockOption(sizeSelect);
      const outOfStock = options.find((o) => o.disabled);
      if (outOfStock) {
        expect.soft(outOfStock.text, 'disabled size option should be labelled as unavailable').toMatch(/out of stock|sold out/i);
      }
      if (inStock) {
        await expect.soft(sizeSelect).toHaveValue(inStock.value);
      } else {
        testInfo.annotations.push({ type: 'skip reason', description: 'All sizes are out of stock for this product' });
      }
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: 'This product has no size dropdown' });
    }
  });

  await test.step('Step 5d - Order / Order Multiple toggle switches between single and bulk ordering', async () => {
    // Not every product offers bulk ordering (e.g. most aprons don't), so this only runs when the
    // random pick happens to be one that does.
    if (await pdp.orderMultipleTab.count()) {
      await expect.soft(pdp.orderTab).toHaveAttribute('aria-selected', 'true');
      await pdp.selectTab(pdp.orderMultipleTab);
      await expect.soft(pdp.addAllToCartButton).toBeVisible();

      const rows = pdp.orderMultipleRows();
      const rowCount = await rows.count();
      if (rowCount > 0) {
        // The point of "Order Multiple" is picking several sizes in one go, so exercise at least
        // two distinct sizes (falling back to one if that's all the product offers) rather than
        // just adding a single size, which the regular "Order" tab already covers in step 5g.
        const enabledIndices: number[] = [];
        for (let i = 0; i < rowCount; i++) {
          if (!(await rows.nth(i).isDisabled())) enabledIndices.push(i);
        }
        const chosenIndices = enabledIndices.slice(0, 2);
        if (chosenIndices.length < 2) {
          testInfo.annotations.push({
            type: 'skip reason',
            description: 'Fewer than two selectable sizes on Order Multiple - cannot exercise multi-size add',
          });
        }

        const chosenSizes: string[] = [];
        for (const index of chosenIndices) {
          const label = await rows.nth(index).getAttribute('aria-label');
          chosenSizes.push(label?.replace(/^Quantity for size /i, '') ?? '');
          await pdp.increaseOrderMultipleQuantity(index);
          await expect.soft(rows.nth(index)).not.toHaveValue('0');
        }

        await pdp.addAllToCart();
        await expect.soft(pdp.cartDialog).toContainText(productName);
        for (const size of chosenSizes) {
          const escaped = size.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          await expect.soft(pdp.cartDialog).toContainText(new RegExp(`Size:\\s*${escaped}`));
        }
        await expect.soft(pdp.cartDialog).toContainText(/\$\d+\.\d{2}/);
        await pdp.closeCartDialog();
      } else {
        testInfo.annotations.push({ type: 'skip reason', description: 'Order Multiple tab has no per-size quantity rows' });
      }

      await pdp.selectTab(pdp.orderTab);
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: 'No Order/Order Multiple toggle on this product' });
    }
  });

  await test.step('Step 5e - accordions expand and collapse', async () => {
    for (const name of ['Description', 'Garment care']) {
      const { heading } = pdp.accordion(name);
      if (await heading.count()) {
        await pdp.toggleAccordion(name, 'true');
        await pdp.toggleAccordion(name, 'false');
      }
    }
  });

  await test.step('Step 5f - breadcrumb links point at the expected previous pages', async () => {
    // Checked by href rather than clicking through: clicking away and back is exercised by the
    // colour-variant step above, and this keeps the still-fresh PDP state intact for the steps below.
    await expect.soft(pdp.breadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    const categoryLink = pdp.breadcrumb.getByRole('link', { name: category });
    if (await categoryLink.count()) {
      await expect.soft(categoryLink).toHaveAttribute('href', new RegExp(`/${category.toLowerCase()}/`));
    }
  });

  await test.step('Step 5g - "Add to Bag" adds the product to the cart with the right details', async () => {
    if (await pdp.addToBagButton.count()) {
      // Defensive re-check: a size selected back in step 5c can be dropped by an unrelated
      // re-render triggered by the accordion toggles in 5e, so make sure one is still set.
      const sizeSelect = page.getByRole('combobox', { name: /select size/i });
      if ((await sizeSelect.count()) && (await sizeSelect.inputValue()) === '') {
        await selectInStockOption(sizeSelect);
      }
      await pdp.addToBag();
      await expect.soft(pdp.cartDialog).toContainText(productName);
      await expect.soft(pdp.cartDialog).toContainText(/\$\d+\.\d{2}/);
      await pdp.closeCartDialog();

      const backendItem = (await fetchCart(page)).cartItems.find((i) => i.title === product.title);
      expect.soft(backendItem, `backend cart should contain "${product.title}"`).toBeTruthy();
      expect.soft(backendItem?.unitPrice.amount, 'backend cart unit price should match the API product price').toBe(product.price);
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: 'No "Add to Bag" button - product has no sizes in stock' });
    }
  });

  // Wishlisting is kept as the last interaction: PDP-BUG-2 (confirmed reproducible) auto-navigates
  // away from the PDP to /wishlist/ about 900ms after the heart is clicked, so nothing after it on
  // this page can be meaningfully checked.
  await test.step('Step 5h - wishlist icon adds the product to favourites', async () => {
    if (await pdp.wishlistButton.count()) {
      await pdp.wishlistButton.click();
      await knownBug('PDP-BUG-2', 'Clicking the wishlist heart on the PDP auto-navigates to /wishlist/ ~900ms later', async () => {
        // Give the delayed navigation more room than the originally-observed ~900ms: by this point
        // in the flow several other interactions have already queued their own timers/requests, so
        // a tight wait here could read the URL before this one actually fires.
        await page.waitForTimeout(4_000);
        expect(page.url()).toMatch(/\/product\/.+\/$/);
      });
    } else {
      testInfo.annotations.push({
        type: 'skip reason',
        description: 'No wishlist icon on this product - wishlist add/remove not testable',
      });
    }
  });
});

/**
 * Adds the current page's product to the cart and asserts the cart reflects the given colour and
 * (if a strap is selected) strap, then closes the cart drawer. Skips with an annotation rather than
 * failing when there's no "Add to Bag" button at all (this colour/strap combination out of stock).
 */
async function addCurrentSelectionToCart(pdp: PdpPage, testInfo: TestInfo, colourName: string) {
  if (!(await pdp.addToBagButton.count())) {
    testInfo.annotations.push({ type: 'skip reason', description: `"${colourName}" is out of stock - no "Add to Bag" button to test` });
    return;
  }
  await pdp.addToBag();
  await expect.soft(pdp.cartDialog).toContainText(colourName);
  if (await pdp.strapSelect.count()) {
    const selectedStrapText = await pdp.strapSelect.locator('option:checked').innerText();
    if (selectedStrapText && selectedStrapText !== 'Select a strap') {
      await expect.soft(pdp.cartDialog).toContainText(selectedStrapText);
    }
  }
  await expect.soft(pdp.cartDialog).toContainText(/\$\d+\.\d{2}/);
  await pdp.closeCartDialog();
}

/**
 * PDP-002 - Apron: add a colour to the cart, change colour and add again, then do the same for strap.
 *
 * Reaches the product only by navigating Home -> Aprons PLP -> PDP. Needs a single apron that has
 * both multiple colours and a "Choose your strap" option to exercise both variant types, so this
 * tries a bounded number of random eligible picks (going back to the PLP in between) until it finds
 * one that qualifies; if none of the attempts do, that's reported rather than faked.
 */
test('PDP-002 - Apron: add to cart, change colour and add again, change strap and add again', async ({ page }, testInfo) => {
  test.setTimeout(3 * 60_000);

  const home = new HomePage(page);
  const plp = new PlpPage(page);
  const pdp = new PdpPage(page);

  const MAX_ATTEMPTS = 8;
  let qualifies = false;

  await test.step('Step 1 - open the home page and navigate to Aprons', async () => {
    await home.goto();
    await home.goToCategory('Aprons');
    await expect(page).toHaveURL(/\/aprons\/$/);
    await expect(plp.productCards.first()).toBeVisible();
  });

  await test.step('Step 2 - find an apron with both colour and strap variants', async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !qualifies; attempt++) {
      const picked = await plp.pickRandomEligibleProduct();
      await plp.cardTitle(picked.card).click();
      await expect(page).toHaveURL(new RegExp(`${picked.href}$`));
      await pdp.expectLoaded();

      const otherColours = pdp.colourSwatches
        .getByRole('link')
        .and(page.locator(':not([aria-current="true"]):not([aria-current="page"])'));
      qualifies = (await otherColours.count()) > 0 && (await pdp.strapSelect.count()) > 0;

      if (!qualifies) {
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await expect(plp.productCards.first()).toBeVisible();
      }
    }
    if (!qualifies) {
      testInfo.annotations.push({
        type: 'skip reason',
        description: `No apron with both colour and strap variants found after ${MAX_ATTEMPTS} random picks`,
      });
    }
  });

  if (!qualifies) return;

  let colour1Name = '';
  await test.step('Step 3 - add the current colour to the cart', async () => {
    colour1Name = (await pdp.heading.innerText()).trim();
    await selectInStockOption(pdp.strapSelect);
    await addCurrentSelectionToCart(pdp, testInfo, colour1Name);
  });

  let colour2Name = '';
  let firstStrapValue: string | undefined;
  await test.step('Step 4 - change colour (navigates to that colour\'s own PDP) and add it to the cart', async () => {
    const other = pdp.colourSwatches
      .getByRole('link')
      .and(page.locator(':not([aria-current="true"]):not([aria-current="page"])'))
      .first();
    const href = await other.getAttribute('href');
    await other.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await pdp.expectLoaded();
    // The URL and heading can update slightly before the page is fully done settling, so reading
    // the DOM immediately after can occasionally hit "Execution context was destroyed" from a
    // navigation still finishing underneath it. Not waiting for the `load` event itself here -
    // that's slow/unreliable on this UAT site (see helpers/site.ts) - just a short settle.
    await page.waitForTimeout(500);
    colour2Name = (await pdp.heading.innerText()).trim();
    expect.soft(colour2Name, 'changing colour should land on a different product name/colour').not.toBe(colour1Name);

    if (await pdp.strapSelect.count()) {
      const { inStock } = await selectInStockOption(pdp.strapSelect);
      firstStrapValue = inStock?.value;
    }
    await addCurrentSelectionToCart(pdp, testInfo, colour2Name);
  });

  await test.step('Step 5 - change strap (same colour, same page) and add it to the cart', async () => {
    if (await pdp.strapSelect.count()) {
      const { inStock, options } = await selectInStockOption(pdp.strapSelect, firstStrapValue);
      const outOfStock = options.find((o) => o.disabled);
      if (outOfStock) {
        expect.soft(outOfStock.text, 'disabled strap option should be labelled as unavailable').toMatch(/out of stock|sold out/i);
      }
      if (inStock) {
        await expect.soft(pdp.strapSelect).toHaveValue(inStock.value);
        await addCurrentSelectionToCart(pdp, testInfo, colour2Name);
      } else {
        testInfo.annotations.push({ type: 'skip reason', description: 'Only one in-stock strap option - nothing different to switch to' });
      }
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: 'This colour has no "Choose your strap" option' });
    }
  });
});

/**
 * PDP-003 - Apron: add plain to cart, then add again with Name Embroidery (positive & negative).
 *
 * Reaches the product only by navigating Home -> Aprons PLP -> PDP, picking a single random apron.
 * Covers the "Add Embroidery" modal's Name Embroidery tab: default/empty state, input validation
 * (character limit, letters/numbers-only filtering), the "no name entered" guard, live price and
 * preview updates, thread colour selection, and the final cart contents - which must show the
 * plain item and the embroidered item as two separate line items with the right embroidery details.
 */
test('PDP-003 - Apron: add plain to cart, then add again with Name Embroidery', async ({ page }, testInfo) => {
  test.setTimeout(3 * 60_000);

  const home = new HomePage(page);
  const plp = new PlpPage(page);
  const pdp = new PdpPage(page);

  let productName = '';
  let priceBeforeName = 0;

  await test.step('Step 1 - open the home page and navigate to Aprons', async () => {
    await home.goto();
    await home.goToCategory('Aprons');
    await expect(page).toHaveURL(/\/aprons\/$/);
    await expect(plp.productCards.first()).toBeVisible();
  });

  await test.step('Step 2 - open a random apron product', async () => {
    const picked = await plp.pickRandomEligibleProduct();
    await plp.cardTitle(picked.card).click();
    await expect(page).toHaveURL(new RegExp(`${picked.href}$`));
    await pdp.expectLoaded();
    productName = picked.name;
  });

  if (!(await pdp.addEmbroideryButton.count())) {
    testInfo.annotations.push({ type: 'skip reason', description: 'This apron has no "Add Embroidery" option' });
    return;
  }
  if (!(await pdp.addToBagButton.count())) {
    // Out of stock - no "Add to Bag" button renders at all (only a "notify me" link), same as the
    // backordered-product case in PDP-001/PDP-002. Nothing addable, so nothing to test here.
    testInfo.annotations.push({ type: 'skip reason', description: 'This apron is out of stock - no "Add to Bag" button to test' });
    return;
  }
  if (await pdp.addEmbroideryButton.isDisabled()) {
    testInfo.annotations.push({ type: 'skip reason', description: 'This apron\'s "Add Embroidery" button is disabled (e.g. out of stock)' });
    return;
  }

  await test.step('Step 3 - add the plain product to the cart (no embroidery)', async () => {
    await pdp.addToBag();
    await expect.soft(pdp.cartDialog).toContainText(productName);
    await expect.soft(pdp.cartDialog).not.toContainText(/embroidery/i);
    await expect.soft(pdp.cartDialog).toContainText(/\$\d+\.\d{2}/);
    await pdp.closeCartDialog();
  });

  await pdp.openEmbroideryModal();
  if (!(await pdp.nameEmbroidery().tab.count())) {
    testInfo.annotations.push({ type: 'skip reason', description: 'This apron\'s embroidery modal has no "Name Embroidery" tab' });
    return;
  }

  // The max character limit is printed in the modal but varies between products (seen both 10 and
  // 12), so read it rather than assuming a fixed value.
  let maxLength = 10;

  await test.step('Step 4 - switch to the Name Embroidery tab and verify its default state', async () => {
    const emb = pdp.nameEmbroidery();
    // The modal's default tab varies by product (some open on "Logo Embroidery" instead), so select
    // this one explicitly rather than assuming it's already active.
    await pdp.selectTab(emb.tab);
    await expect.soft(emb.nameField).toHaveValue('');
    await expect.soft(pdp.embroideryDialog).toContainText('No name entered');

    maxLength = Number(await emb.nameField.getAttribute('maxlength')) || 10;
    await expect.soft(pdp.embroideryDialog).toContainText(`0 / ${maxLength}`);
    // No embroidery surcharge applied yet - record this as the baseline to compare against once a
    // name is entered (step 8), rather than just asserting *some* price is shown.
    await expect.soft(emb.totalPrice).toContainText(/\$\d+\.\d{2}/);
    priceBeforeName = parseFloat((await emb.totalPrice.innerText()).replace('$', ''));
  });

  await test.step('Step 5 (negative) - submitting with no name shows a validation message and does not add to cart', async () => {
    const emb = pdp.nameEmbroidery();
    await pdp.submitEmbroideryModal();
    await expect.soft(emb.validationMessage).toBeVisible();
    await expect.soft(pdp.embroideryDialog).toBeVisible();
    await expect.soft(pdp.cartDialog).toBeHidden();
  });

  await test.step('Step 6 (negative) - the name field enforces its character limit', async () => {
    const emb = pdp.nameEmbroidery();
    const overLong = 'ABCDEFGHIJKLMNOPQRST'.slice(0, maxLength + 5); // always 5 chars over the limit
    await emb.nameField.fill('');
    await emb.nameField.pressSequentially(overLong, { delay: 10 });
    await expect.soft(emb.nameField).toHaveValue(overLong.slice(0, maxLength));
    await expect.soft(pdp.embroideryDialog).toContainText(`${maxLength} / ${maxLength}`);
  });

  await test.step('Step 7 (negative) - only letters and numbers are accepted', async () => {
    const emb = pdp.nameEmbroidery();
    await emb.nameField.fill('');
    await emb.nameField.pressSequentially('AB!@12', { delay: 10 });
    await expect.soft(emb.nameField).toHaveValue('AB12');
  });

  await test.step('Step 8 (positive) - a valid name updates the character count, preview and price', async () => {
    const emb = pdp.nameEmbroidery();
    await emb.nameField.fill('');
    await emb.nameField.pressSequentially('CARGO', { delay: 10 });
    await expect.soft(emb.nameField).toHaveValue('CARGO');
    await expect.soft(pdp.embroideryDialog).toContainText(`5 / ${maxLength}`);
    await expect.soft(pdp.embroideryDialog).toContainText(/Name CARGO in/i);
    await expect.soft(pdp.embroideryDialog).not.toContainText('No name entered');
    // Embroidery adds a flat $12 surcharge once a name is entered.
    const priceAfterName = parseFloat((await emb.totalPrice.innerText()).replace('$', ''));
    expect
      .soft(priceAfterName, `total ($${priceAfterName}) should be $12 more than the no-name baseline ($${priceBeforeName})`)
      .toBeCloseTo(priceBeforeName + 12, 2);
  });

  await test.step('Step 9 (positive) - selecting a thread colour updates the live preview', async () => {
    const emb = pdp.nameEmbroidery();
    const red = emb.threadColour('Red');
    if (await red.count()) {
      await red.check();
      await expect.soft(red).toBeChecked();
      await expect.soft(pdp.embroideryDialog).toContainText(/Name CARGO in Red/i);
    } else {
      testInfo.annotations.push({ type: 'skip reason', description: 'No "Red" thread colour option on this apron' });
    }
  });

  await test.step('Step 10 (positive) - adding with a valid name succeeds and the cart shows both the plain and embroidered items', async () => {
    await pdp.submitEmbroideryModal();
    await expect.soft(pdp.cartDialog).toBeVisible();
    const cartText = await pdp.cartDialog.innerText();
    const productOccurrences = cartText.split(productName).length - 1;
    expect.soft(productOccurrences, 'cart should list both the plain and the embroidered line items').toBeGreaterThanOrEqual(2);
    // Case varies between products ("EMBROIDERY" vs "Embroidery"), so match case-insensitively.
    await expect.soft(pdp.cartDialog).toContainText(/embroidery/i);
    await expect.soft(pdp.cartDialog).toContainText('Name: CARGO');
    await expect.soft(pdp.cartDialog).toContainText(/\$\d+\.\d{2}/);
    await pdp.closeCartDialog();
  });
});

/**
 * PDP-004 - Apron: Logo Embroidery - New/Existing/Not Sure artwork, post-purchase checkbox, pricing.
 *
 * Reaches the product only by navigating Home -> Aprons PLP -> PDP, picking a single random apron.
 * Covers the "Add Embroidery" modal's Logo Embroidery tab across all three "artwork" options (New
 * Logo, Existing Logo, Not Sure): the post-purchase "I will email my logo post-purchase" checkbox
 * must show only for New Logo, "Continue" must be gated on that checkbox (or a file) only for New
 * Logo, and every displayed price - the modal's running total, the one-off set-up fee that only
 * applies to New Logo, and the final cart total - must agree with each other.
 */
test('PDP-004 - Apron: Logo Embroidery - New/Existing/Not Sure logo, post-purchase checkbox, pricing', async ({ page }, testInfo) => {
  test.setTimeout(3 * 60_000);

  const home = new HomePage(page);
  const plp = new PlpPage(page);
  const pdp = new PdpPage(page);

  let productName = '';
  let basePrice = 0;

  await test.step('Step 1 - open the home page and navigate to Aprons', async () => {
    await home.goto();
    await home.goToCategory('Aprons');
    await expect(page).toHaveURL(/\/aprons\/$/);
    await expect(plp.productCards.first()).toBeVisible();
  });

  await test.step('Step 2 - open a random apron product', async () => {
    const picked = await plp.pickRandomEligibleProduct();
    await plp.cardTitle(picked.card).click();
    await expect(page).toHaveURL(new RegExp(`${picked.href}$`));
    await pdp.expectLoaded();
    productName = picked.name;
    basePrice = parsePrice(await pdp.main.innerText());
  });

  if (!(await pdp.addEmbroideryButton.count())) {
    testInfo.annotations.push({ type: 'skip reason', description: 'This apron has no "Add Embroidery" option' });
    return;
  }
  if (await pdp.addEmbroideryButton.isDisabled()) {
    testInfo.annotations.push({ type: 'skip reason', description: 'This apron\'s "Add Embroidery" button is disabled (e.g. out of stock)' });
    return;
  }

  await pdp.openEmbroideryModal();
  const logo = pdp.logoEmbroidery();
  if (!(await logo.tab.count())) {
    testInfo.annotations.push({ type: 'skip reason', description: 'This apron\'s embroidery modal has no "Logo Embroidery" tab' });
    return;
  }
  await pdp.selectTab(logo.tab);

  // Some products' "Logo Embroidery" tab isn't the interactive artwork/quantity flow at all - it's
  // a "Speak to our uniform specialists" lead-gen contact form (an embedded iframe) instead, with no
  // artwork-type dropdown to test.
  if (!(await logo.artworkSelect.count())) {
    testInfo.annotations.push({
      type: 'skip reason',
      description: 'This apron\'s "Logo Embroidery" tab is a lead-gen contact form, not the interactive artwork/quantity flow',
    });
    return;
  }

  await test.step('Step 3 (positive) - "New Logo" is the default artwork option and shows the post-purchase checkbox', async () => {
    await expect.soft(logo.artworkSelect).toHaveValue('newlogo');
    await expect.soft(logo.postPurchaseCheckboxLabel).toBeVisible();
    await expect.soft(logo.postPurchaseCheckbox).not.toBeChecked();
  });

  await test.step('Step 4 (negative) - "Continue" is disabled for New Logo until a file or the checkbox is provided', async () => {
    await expect.soft(logo.continueButton).toBeDisabled();
  });

  await test.step('Step 5 (positive) - "Existing Logo" hides the post-purchase checkbox and enables Continue immediately', async () => {
    await logo.artworkSelect.selectOption({ value: 'existinglogo' });
    await expect.soft(logo.postPurchaseCheckboxLabel).toBeHidden();
    await expect.soft(logo.continueButton).toBeEnabled();
  });

  await test.step('Step 6 (positive) - "Not Sure" also hides the post-purchase checkbox and enables Continue', async () => {
    await logo.artworkSelect.selectOption({ value: 'notsure' });
    await expect.soft(logo.postPurchaseCheckboxLabel).toBeHidden();
    await expect.soft(logo.continueButton).toBeEnabled();
  });

  await test.step('Step 7 (positive) - switching back to "New Logo" re-displays the checkbox and re-disables Continue', async () => {
    await logo.artworkSelect.selectOption({ value: 'newlogo' });
    await expect.soft(logo.postPurchaseCheckboxLabel).toBeVisible();
    await expect.soft(logo.continueButton).toBeDisabled();
  });

  // Logo embroidery pricing is tiered by cumulative quantity *of that add-on across the whole
  // cart*, confirmed by testing: adding a second batch can silently apply a better per-unit rate
  // to the newest batch, and can even retroactively discount a quantity already sitting in the
  // cart from an earlier add. That makes both the static "PER UNIT $X.XX each" label and a running
  // sum of each add's own total unreliable as exact expected values, so below each add verifies
  // price *sanity* (a positive, non-zero embroidery surcharge; the grand total strictly increasing)
  // rather than asserting an exact formula that this legitimate site behavior can invalidate.
  let previousCartTotal = 0;

  /**
   * Advances past step 1 for the given artwork type, sanity-checks the modal's running total, adds
   * it to the cart, and asserts the cart's grand total increased by a sane amount.
   */
  async function verifyArtworkTypeEndToEnd(artworkValue: 'newlogo' | 'existinglogo' | 'notsure', artworkLabel: string) {
    await logo.artworkSelect.selectOption({ value: artworkValue });
    if (artworkValue === 'newlogo') {
      await logo.postPurchaseCheckboxLabel.click();
      await expect.soft(logo.postPurchaseCheckbox).toBeChecked();
    }
    await expect.soft(logo.continueButton).toBeEnabled();
    await pdp.submitEmbroideryModal(logo.continueButton);

    const step2 = pdp.logoEmbroideryStep2();

    // The default quantity (the Logo Embroidery minimum of 6) can exceed what's actually in stock
    // for this product/location, which the site flags with an inline alert and silently blocks
    // "Add to Bag" for - an unmeetable constraint, not something this test can work around, so skip
    // the rest of this artwork type rather than fail on it.
    const stockAlert = pdp.embroideryDialog.getByRole('alert').filter({ hasText: /quantity.*more than.*available/i });
    if (await stockAlert.count()) {
      testInfo.annotations.push({
        type: 'skip reason',
        description: `${artworkLabel}: ${await stockAlert.innerText()}`,
      });
      return;
    }

    const quantity = Number(await step2.quantity.inputValue());
    expect.soft(quantity, 'default logo quantity should respect the Logo Embroidery minimum of 6').toBeGreaterThanOrEqual(6);

    const dialogText = await pdp.embroideryDialog.innerText();
    const perUnitMatch = dialogText.match(/\$(\d+\.\d{2})\s*each/i);
    expect.soft(perUnitMatch, 'expected a "$X.XX each" per-unit embroidery price').not.toBeNull();

    const setupFeeMatch = dialogText.match(/\+\s*\$(\d+\.\d{2})\s*one-off set-up/i);
    if (artworkValue === 'newlogo') {
      expect.soft(setupFeeMatch, 'New Logo should show a one-off set-up fee line').not.toBeNull();
    } else {
      expect.soft(setupFeeMatch, `${artworkLabel} should NOT show a one-off set-up fee line`).toBeNull();
    }
    const setupFee = setupFeeMatch ? parseFloat(setupFeeMatch[1]) : 0;

    // Not compared against (base + the displayed per-unit price) x quantity + set-up fee: logo
    // embroidery is tiered by cumulative quantity across the whole cart, so the per-unit price
    // actually applied to this add can be better than the static label shown (confirmed by
    // testing), making that exact formula an unreliable expectation. The implied per-unit price is
    // still sanity-checked - it must be a real, positive embroidery surcharge, not zero or negative.
    const modalTotal = parsePrice(await step2.totalPrice.innerText());
    const impliedPerUnit = (modalTotal - setupFee) / quantity - basePrice;
    expect
      .soft(impliedPerUnit, `${artworkLabel} implied per-unit embroidery cost ($${impliedPerUnit.toFixed(2)}) should be a positive surcharge`)
      .toBeGreaterThan(0);

    await pdp.submitEmbroideryModal(step2.addToBagButton);

    // The stock-availability check (see the alert handling above) has been observed to sometimes
    // only resolve after actually attempting to add to the bag, not just after setting the
    // quantity/location - so give it another chance to appear here before treating a cart that
    // never opened as a genuine failure.
    const cartOpened = await pdp.cartDialog
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!cartOpened && (await stockAlert.count())) {
      testInfo.annotations.push({
        type: 'skip reason',
        description: `${artworkLabel} (on Add to Bag): ${await stockAlert.innerText()}`,
      });
      return;
    }

    await expect.soft(pdp.cartDialog).toBeVisible();
    const cartText = await pdp.cartDialog.innerText();
    expect.soft(cartText, 'cart should contain this product').toContain(productName);
    expect.soft(cartText, 'cart should contain a logo embroidery line').toMatch(/logo embroidery/i);

    // The cart accumulates every item added so far in this test (New Logo was added first), so
    // "no set-up fee" can't be checked against the whole cart text once a prior add already put one
    // in there - only the text for THIS newly-added item (everything after its own "CARGO CREW"
    // header, i.e. the last segment) is relevant here.
    const segments = cartText.split('CARGO CREW');
    const newestItemText = segments[segments.length - 1];
    if (artworkValue === 'newlogo') {
      // This add's own set-up-fee entry is a separate top-level block that appears just *before*
      // this item's "CARGO CREW" header, not inside it - so check the preceding segment instead.
      // "Artwork: New logo" itself is printed in the standalone set-up-fee entry, not in the
      // item's own entry (which instead shows "Logo file: To be emailed post-purchase" directly).
      const precedingText = segments[segments.length - 2] ?? '';
      expect.soft(precedingText, `${artworkLabel} should show its own one-off set-up fee entry`).toMatch(/logo set-up fee/i);
      expect.soft(precedingText, `${artworkLabel}'s set-up fee entry should mention "New logo"`).toMatch(/new logo/i);
      expect.soft(newestItemText, `${artworkLabel}'s cart entry should mention the emailed-post-purchase logo file`).toContain(
        'To be emailed post-purchase',
      );
    } else {
      expect.soft(newestItemText, `${artworkLabel}'s own cart entry should NOT show a set-up fee`).not.toMatch(/logo set-up fee/i);
      expect.soft(newestItemText, `${artworkLabel}'s cart entry should mention "${artworkLabel}"`).toMatch(new RegExp(artworkLabel, 'i'));
    }

    const cartTotalMatch = cartText.match(/Total\s*\$([\d,]+\.\d{2})/);
    expect.soft(cartTotalMatch, 'cart should show a final "Total $X.XX" line').not.toBeNull();
    if (cartTotalMatch) {
      const cartTotal = parseFloat(cartTotalMatch[1].replace(',', ''));
      // Not compared to a sum of each add's own modal total: the cumulative-quantity tiering above
      // can retroactively discount an earlier add once a later one crosses a tier threshold, so the
      // only thing reliably true here is that adding something increased the cart's total.
      expect.soft(cartTotal, `cart total ($${cartTotal}) should have increased after this add (was $${previousCartTotal})`).toBeGreaterThan(
        previousCartTotal,
      );
      previousCartTotal = cartTotal;
    }
    await pdp.closeCartDialog();
  }

  /**
   * Re-opening "Add Embroidery" between artwork types occasionally finds it disabled on some
   * products (state this test doesn't control, e.g. stock/session-specific gating) - in that case
   * there's nothing left to test for the remaining artwork types, so skip rather than hard-fail.
   */
  async function reopenEmbroideryModal(testInfo: TestInfo, remainingStepsLabel: string): Promise<boolean> {
    if (await pdp.addEmbroideryButton.isDisabled()) {
      testInfo.annotations.push({
        type: 'skip reason',
        description: `"Add Embroidery" became disabled after the previous add - cannot test ${remainingStepsLabel}`,
      });
      return false;
    }
    await pdp.openEmbroideryModal();
    await pdp.selectTab(logo.tab);
    return true;
  }

  await test.step('Step 8 - New Logo: complete the flow and verify pricing (incl. one-off set-up fee)', async () => {
    await verifyArtworkTypeEndToEnd('newlogo', 'New Logo');
  });

  await test.step('Step 9 - Existing Logo: complete the flow and verify pricing (no set-up fee)', async () => {
    if (await reopenEmbroideryModal(testInfo, 'Existing Logo and Not Sure')) {
      await verifyArtworkTypeEndToEnd('existinglogo', 'Existing Logo');
    }
  });

  await test.step('Step 10 - Not Sure: complete the flow and verify pricing (no set-up fee)', async () => {
    if (await reopenEmbroideryModal(testInfo, 'Not Sure')) {
      await verifyArtworkTypeEndToEnd('notsure', 'Not Sure');
    }
  });
});

/**
 * PDP-005 (negative) - adding more than the available inventory is rejected with an error message.
 *
 * Reaches the product only by navigating Home -> Aprons PLP -> PDP. Requests a quantity far above
 * any real stock level and expects `/api/cart/add/` to reject it (409) with a "more than we currently
 * have available" message that the PDP shows to the user, and the cart to stay unchanged. The
 * message states the real limit ("a quantity of N or less"), which is then used to check the
 * boundary on both sides: N + 1 is rejected, N is accepted.
 */
test('PDP-005 - adding more than the available inventory to the cart shows an error message', async ({ page }, testInfo) => {
  test.setTimeout(3 * 60_000);

  const home = new HomePage(page);
  const plp = new PlpPage(page);
  const pdp = new PdpPage(page);
  const errorAlert = pdp.main.getByRole('alert').filter({ hasText: /more than we currently have available/i });

  /**
   * Sets the quantity and clicks "Add to Bag", returning the `/api/cart/add/` response. The first
   * fill/click can land before hydration (nothing is sent), so retry until a request actually goes
   * out. Only the request is retried on: the UAT response itself can take well over 5s, and clicking
   * again while it's in flight ("Adding...") would just hit a busy button.
   */
  async function submitQuantity(quantity: number) {
    await expect(async () => {
      await pdp.quantity.fill(String(quantity));
      await expect(pdp.quantity).toHaveValue(String(quantity), { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    const isCartAdd = (r: { url(): string; method(): string }) => /\/api\/cart\/add\/?$/.test(r.url()) && r.method() === 'POST';
    const response = page.waitForResponse((r) => isCartAdd(r.request()) && /\/add\/$/.test(r.url()), { timeout: 60_000 });
    await expect(async () => {
      await Promise.all([page.waitForRequest(isCartAdd, { timeout: 3_000 }), pdp.addToBagButton.click({ timeout: 5_000 })]);
    }).toPass({ timeout: 20_000 });
    return response;
  }

  let productTitle = '';

  await test.step('Step 1 - start with an empty cart', async () => {
    await clearCart(page);
    expect((await fetchCart(page)).cartCount).toBe(0);
  });

  await test.step('Step 2 - open an in-stock apron (without a strap option) from the Aprons PLP', async () => {
    await home.goto();
    await home.goToCategory('Aprons');
    await expect(page).toHaveURL(/\/aprons\/$/);
    await expect(plp.productCards.first()).toBeVisible();

    const MAX_ATTEMPTS = 10;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const picked = await plp.pickRandomEligibleProduct();
      await plp.cardTitle(picked.card).click();
      await expect(page).toHaveURL(new RegExp(`${picked.href}$`));
      await pdp.expectLoaded();
      const product = await fetchPdpProduct(page, picked.href);
      // Strap aprons are skipped: their first over-stock message states the apron's limit, but the
      // selected strap has its own, lower stock ("we only have N of this strap available"), so the
      // stated limit isn't actually addable and the boundary checks below wouldn't be meaningful.
      if (product.stock !== 'out' && (await pdp.addToBagButton.count()) && !(await pdp.strapSelect.count())) {
        productTitle = product.title;
        testInfo.annotations.push({ type: 'product under test', description: `${productTitle} (${picked.href})` });
        break;
      }
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await expect(plp.productCards.first()).toBeVisible();
    }
    expect(productTitle, `no in-stock, strap-less apron found after ${MAX_ATTEMPTS} random picks`).not.toBe('');

    const sizeSelect = page.getByRole('combobox', { name: /select size/i });
    if (await sizeSelect.count()) await selectInStockOption(sizeSelect);
  });

  let available = 0;

  await test.step('Step 3 (negative) - a quantity far above stock is rejected by the API and the PDP shows its error', async () => {
    const response = await submitQuantity(99_999);
    expect(response.status(), 'add-to-cart API should reject an over-stock quantity').toBe(409);
    const { message } = await response.json();
    expect(message).toMatch(OVER_STOCK_MESSAGE);
    available = Number(message.match(OVER_STOCK_MESSAGE)[1]);
    testInfo.annotations.push({ type: 'available quantity', description: String(available) });

    await expect(errorAlert, 'PDP should show the API\'s over-stock message').toHaveText(message);
    await expect.soft(pdp.cartDialog, 'cart drawer should not open on a rejected add').toBeHidden();
    expect.soft((await fetchCart(page)).cartCount, 'nothing should have been added to the cart').toBe(0);
  });

  await test.step('Step 4 (negative) - one more than the available quantity is also rejected', async () => {
    const response = await submitQuantity(available + 1);
    expect.soft(response.status()).toBe(409);
    expect.soft((await response.json()).message).toMatch(OVER_STOCK_MESSAGE);
    await expect.soft(errorAlert).toBeVisible();
    expect.soft((await fetchCart(page)).cartCount, 'nothing should have been added to the cart').toBe(0);
  });

  await test.step('Step 5 (positive) - exactly the available quantity is accepted and the error clears', async () => {
    const response = await submitQuantity(available);
    expect
      .soft(response.ok(), `adding exactly ${available} (the stated limit) should succeed - got ${response.status()} ${await response.text()}`)
      .toBe(true);
    await expect.soft(pdp.cartDialog).toBeVisible();
    await expect.soft(errorAlert).toBeHidden();
    const item = (await fetchCart(page)).cartItems.find((i) => i.title === productTitle);
    expect.soft(item?.quantity, 'backend cart should hold exactly the available quantity').toBe(available);
  });

  // Don't leave thousands of units sitting in the shared session cart for other tests.
  await clearCart(page);
});
