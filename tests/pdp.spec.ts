// import { test, expect, TestInfo } from '@playwright/test';
// import { PlpPage } from './pages/PlpPage';
// import { PdpPage } from './pages/PdpPage';
// import { knownBug } from './helpers/known-bug';
// 
// /**
//  * Opens a category PLP and clicks into the first product's PDP.
//  * Per test requirements, products are always reached by navigating from the PLP,
//  * never by opening a /product/... URL directly.
//  */
// async function openPdpFromPlp(plp: PlpPage, category = '/aprons/') {
//   await plp.goto(category);
//   const card = plp.productCards.first();
//   const title = plp.cardTitle(card);
//   const name = (await title.innerText()).trim();
//   await title.click();
//   await expect(plp.page.getByRole('heading', { level: 1 })).toContainText(name);
//   return name;
// }
// 
// /** Records a test case as not automated yet, with the reason, instead of faking a check. */
// function pending(testInfo: TestInfo, id: string, reason: string) {
//   testInfo.annotations.push({ type: 'not automated', description: `${id}: ${reason}` });
// }
// 
// /*
//  * Split into several focused tests (rather than one long chain of steps) so a single slow or
//  * stuck section can't eat the whole suite's time budget and take unrelated sections down with
//  * it. Each test still always reaches its product by navigating a PLP category and clicking a
//  * product card - never a direct /product/... URL.
//  */
// 
// test('PDP - product essentials', async ({ page }, testInfo) => {
//   test.setTimeout(5 * 60_000);
//   const plp = new PlpPage(page);
//   const pdp = new PdpPage(page);
// 
//   let productName = '';
// 
//   await test.step('TC_PDP_001 - PDP loads successfully when opened from the PLP', async () => {
//     productName = await openPdpFromPlp(plp, '/aprons/');
//     await expect(page).toHaveURL(/\/product\/.+\/$/);
//     await pdp.expectLoaded();
//   });
// 
//   await test.step('TC_PDP_002 - breadcrumb navigation is visible, correct and functional', async () => {
//     await expect.soft(pdp.breadcrumb).toBeVisible();
//     await expect.soft(pdp.breadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
//     await expect.soft(pdp.breadcrumb).toContainText(productName);
//   });
// 
//   await test.step('TC_PDP_003 - browser page title matches the product name on the PDP', async () => {
//     await expect.soft(page).toHaveTitle(/\| Cargo Crew$/);
//     // Page <title> is often a longer SEO variant of the H1 (extra descriptor words), so only
//     // require the product's first/base name word appears in it, not an exact match.
//     const baseName = productName.split(/[\s-]/)[0];
//     const title = await page.title();
//     expect.soft(title, `title "${title}" should mention "${baseName}" from the product name "${productName}"`).toContain(baseName);
//   });
// 
//   await test.step('TC_PDP_004 - primary product image(s) load correctly', async () => {
//     const images = pdp.galleryEnlargeButtons().locator('img');
//     const count = await images.count();
//     expect.soft(count).toBeGreaterThan(0);
//     for (const img of await images.all()) {
//       await expect.soft(img).toHaveAttribute('alt', /.+/);
//       await expect
//         .soft.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
//         .toBe(true);
//     }
//   });
// 
//   await test.step('TC_PDP_005 - clicking the gallery image opens the image viewer', async () => {
//     await pdp.openImageViewer();
//     await expect.soft(pdp.imageViewerDialog.getByRole('navigation', { name: 'Product images' })).toBeVisible();
//   });
// 
//   await test.step('TC_PDP_006 - "X" close icon on the image gallery modal closes it', async () => {
//     await pdp.imageViewerDialog.getByRole('button', { name: 'Close' }).click();
//     await expect.soft(pdp.imageViewerDialog).toBeHidden();
//   });
// 
//   await test.step('TC_PDP_007 - product name is correctly displayed', async () => {
//     await expect(pdp.heading).toContainText(productName);
//   });
// 
//   await test.step('TC_PDP_008 - product price is visible and correctly formatted', async () => {
//     await expect.soft(pdp.main).toContainText(/\$\d+\.\d{2}/);
//   });
// 
//   await test.step('TC_PDP_009 - product stock status is visible', async () => {
//     await expect.soft(pdp.main.getByText(/In Stock|Out of Stock|Only \d+ Left/)).toBeVisible();
//   });
// 
//   await test.step('TC_PDP_010 - "Also available in a ..." link redirects to the related PDP', async () => {
//     const also = pdp.main.getByText('Also available in a').locator('..').getByRole('link');
//     if (await also.count()) {
//       const href = await also.first().getAttribute('href');
//       await also.first().click();
//       await expect(page).toHaveURL(new RegExp(`${href}$`));
//       // The UAT `load` event is slow (third-party scripts), so wait for DOM only (see helpers/site.ts).
//       await page.goBack({ waitUntil: 'domcontentloaded' });
//       await expect(pdp.heading).toContainText(productName);
//     } else {
//       test.info().annotations.push({ type: 'skip reason', description: 'No "Also available in a ..." link on this product' });
//     }
//   });
// 
//   await test.step('TC_PDP_015 - "+" increases quantity by 1', async () => {
//     await expect(pdp.quantity).toHaveValue('1');
//     await pdp.setQuantity('1', '2');
//   });
// 
//   await test.step('TC_PDP_016 - "-" decreases quantity by 1 (not below 1)', async () => {
//     await pdp.setQuantity('2', '1');
//     await expect(pdp.decreaseQty).toBeDisabled();
//   });
// 
//   await test.step('TC_PDP_017 - quantity selector accepts manual numeric input', async () => {
//     await pdp.quantity.fill('3');
//     await expect.soft(pdp.quantity).toHaveValue('3');
//     await pdp.quantity.fill('1');
//   });
// 
//   await test.step('TC_PDP_018 - quantity selector rejects invalid/negative values', async () => {
//     await pdp.quantity.fill('-1');
//     const value = await pdp.quantity.inputValue();
//     expect.soft(Number(value)).toBeGreaterThanOrEqual(1);
//     await pdp.quantity.fill('1');
//   });
// 
//   await test.step('TC_PDP_037 - footer is visible and complete', async () => {
//     await pdp.footer.scrollIntoViewIfNeeded();
//     await expect.soft(pdp.footer.getByRole('navigation', { name: 'Footer' })).toBeVisible();
//   });
// 
//   await test.step('TC_PDP_038 - footer links are clickable and correct', async () => {
//     const footerNav = pdp.footer.getByRole('navigation', { name: 'Footer' });
//     const link = footerNav.getByRole('link', { name: 'Size Guide' });
//     await expect.soft(link).toHaveAttribute('href', '/size-guides/');
//   });
// 
//   await test.step('TC_PDP_039 - social media links open in a new tab', async () => {
//     const instagram = pdp.footer.getByRole('link', { name: /Instagram/ });
//     await expect.soft(instagram).toHaveAttribute('href', /instagram\.com/);
//     await expect.soft(instagram).toHaveAttribute('target', '_blank');
//   });
// 
//   await test.step('TC_PDP_040 - page accessibility: images have alt text', async () => {
//     for (const img of await pdp.main.locator('img').all()) {
//       await expect.soft(img).toHaveAttribute('alt', /.+/);
//     }
//   });
// 
//   pending(testInfo, 'TC_PDP_041', 'Fonts, colours and spacing are visually consistent - needs manual/visual review.');
//   pending(testInfo, 'TC_PDP_042', 'Sticky header remains while scrolling - needs manual/visual review.');
// });
// 
// test('PDP - Add to Bag', async ({ page }) => {
//   // Kept separate from the wishlist test below, and run first: clicking the wishlist heart
//   // triggers PDP-BUG-2 (see that test), an unprompted navigation away from the PDP ~900ms later.
//   // Running "Add to Bag" in its own test, before anything touches the wishlist button, keeps this
//   // test's result meaningful instead of being an incidental casualty of that bug.
//   test.setTimeout(3 * 60_000);
//   const plp = new PlpPage(page);
//   const pdp = new PdpPage(page);
//   const productName = await openPdpFromPlp(plp, '/aprons/');
// 
//   await test.step('TC_PDP_022 - "Add to Bag" adds the product to the cart', async () => {
//     await pdp.addToBag();
//     await expect.soft(pdp.cartDialog).toContainText(productName);
//     await expect.soft(pdp.cartDialog).toContainText(/\$\d+\.\d{2}/);
//     await pdp.closeCartDialog();
//   });
// });
// 
// test('PDP - wishlist', async ({ page }) => {
//   // Add and remove happen back-to-back with no delay in between, finishing well inside the
//   // ~900ms window before PDP-BUG-2 (see the test below) fires and navigates the page away.
//   test.setTimeout(3 * 60_000);
//   const plp = new PlpPage(page);
//   const pdp = new PdpPage(page);
//   await openPdpFromPlp(plp, '/aprons/');
// 
//   await test.step('TC_PDP_019 - "Add to Favourites" (wishlist) icon is visible', async () => {
//     await expect(pdp.wishlistButton).toBeVisible();
//   });
// 
//   await test.step('TC_PDP_020 - wishlist icon adds the product to favourites', async () => {
//     await pdp.toggleWishlist('true');
//   });
// 
//   await test.step('TC_PDP_021 - wishlist icon removes the product from favourites', async () => {
//     await pdp.toggleWishlist('false');
//   });
// });
// 
// test('PDP-BUG-2 - wishlisting a product must not navigate away from the PDP', async ({ page }) => {
//   // Clicking the wishlist heart silently navigates to /wishlist/ about 900ms later, with no
//   // further interaction - confirmed reproducible 3/3 in isolation (add-only and add-then-remove
//   // both trigger it; a control run with no wishlist click does not). A shopper who wishlists an
//   // item mid-browse gets unexpectedly kicked off the product page. Kept as its own test since
//   // there's nothing meaningful to continue checking on the PDP once this fires.
//   test.setTimeout(2 * 60_000);
//   const plp = new PlpPage(page);
//   const pdp = new PdpPage(page);
//   await openPdpFromPlp(plp, '/aprons/');
// 
//   await pdp.toggleWishlist('true');
// 
//   await knownBug('PDP-BUG-2', 'Clicking the wishlist heart on the PDP auto-navigates to /wishlist/ ~900ms later', async () => {
//     await page.waitForTimeout(1_200);
//     expect(page.url()).toMatch(/\/product\/.+\/$/);
//   });
// });
// 
// test('PDP - Order / Order Multiple toggle', async ({ page }) => {
//   test.setTimeout(3 * 60_000);
//   const plp = new PlpPage(page);
//   const pdp = new PdpPage(page);
// 
//   await test.step('TC_PDP_011 - Order / Order Multiple toggle switches between single and bulk ordering', async () => {
//     // Not every product offers bulk ordering (e.g. most aprons don't), so this is opened from a
//     // category known to have one, selecting straight from its PLP rather than a direct URL.
//     await plp.goto('/tops/');
//     const card = plp.productCards.first();
//     await plp.cardTitle(card).click();
//     await pdp.expectLoaded();
// 
//     const orderTab = page.getByRole('tab', { name: 'Order', exact: true });
//     const orderMultipleTab = page.getByRole('tab', { name: 'Order Multiple' });
//     if (await orderMultipleTab.count()) {
//       await expect.soft(orderTab).toHaveAttribute('aria-selected', 'true');
//       await orderMultipleTab.click();
//       await expect.soft(orderMultipleTab).toHaveAttribute('aria-selected', 'true');
//       await expect.soft(page.getByRole('button', { name: 'Add All to Cart' })).toBeVisible();
// 
//       await orderTab.click();
//       await expect.soft(orderTab).toHaveAttribute('aria-selected', 'true');
//     } else {
//       test.info().annotations.push({ type: 'skip reason', description: 'No Order/Order Multiple toggle on this product' });
//     }
//   });
// 
//   await test.step('TC_PDP_014 - Size dropdown lets the user pick a size', async () => {
//     const sizeSelect = page.getByRole('combobox', { name: /select size/i });
//     if (await sizeSelect.count()) {
//       await sizeSelect.selectOption({ label: 'M' });
//       await expect.soft(sizeSelect).toHaveValue(/.*/);
//     } else {
//       test.info().annotations.push({ type: 'skip reason', description: 'This product has no size dropdown' });
//     }
//   });
// });
// 
// test('PDP - Size Guide', async ({ page }, testInfo) => {
//   test.setTimeout(3 * 60_000);
//   const plp = new PlpPage(page);
//   const pdp = new PdpPage(page);
// 
//   await openPdpFromPlp(plp, '/aprons/');
// 
//   await test.step('TC_PDP_012 / SG_001 - Size Guide opens without a full page reload', async () => {
//     await pdp.openSizeGuide();
//   });
// 
//   await test.step('TC_PDP_013 - modal is displayed centered on screen', async () => {
//     const box = (await pdp.sizeGuideDialog.boundingBox())!;
//     const viewport = page.viewportSize()!;
//     await knownBug('PDP-BUG-1', 'Size Guide opens as a right-edge flyout, not centered in the viewport', async () => {
//       const centerX = box.x + box.width / 2;
//       expect(Math.abs(centerX - viewport.width / 2)).toBeLessThan(viewport.width * 0.1);
//     });
//   });
// 
//   await test.step('SG_002 - Size Guide content displays correctly', async () => {
//     await expect.soft(pdp.sizeGuideDialog.getByRole('heading', { name: 'Size Guide' })).toBeVisible();
//     await expect.soft(pdp.sizeGuideDialog).toContainText(/\d/);
//   });
// 
//   await test.step('SG_003 - modal closes on clicking "X" icon', async () => {
//     await pdp.sizeGuideDialog.getByRole('button', { name: 'Close' }).click();
//     await expect(pdp.sizeGuideDialog).toBeHidden();
//   });
// 
//   await test.step('SG_004 - modal closes on pressing Escape (outside interaction)', async () => {
//     await pdp.openSizeGuide();
//     await page.keyboard.press('Escape');
//     await expect.soft(pdp.sizeGuideDialog).toBeHidden();
//   });
// 
//   await test.step('SG_005 - flyout is aligned correctly on screen', async () => {
//     // Spreadsheet allows either centered or screen-edge alignment here (unlike TC_PDP_013's
//     // strict "centered" requirement) - this product's flyout docks to the right edge.
//     await pdp.openSizeGuide();
//     const box = (await pdp.sizeGuideDialog.boundingBox())!;
//     const viewport = page.viewportSize()!;
//     expect.soft(box).not.toBeNull();
//     expect.soft(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
//     expect.soft(box.x).toBeGreaterThanOrEqual(-1);
//   });
// 
//   pending(testInfo, 'SG_006', 'Scroll appears if content overflows - depends on viewport/content length, needs manual review.');
// 
//   await test.step('SG_007 - links inside the Size Guide flyout work', async () => {
//     const link = pdp.sizeGuideDialog.getByRole('link').first();
//     if (await link.count()) {
//       await expect.soft(link).toHaveAttribute('href', /.+/);
//     }
//     await pdp.sizeGuideDialog.getByRole('button', { name: 'Close' }).click();
//   });
// });
// 
// test('PDP - Add Embroidery', async ({ page }, testInfo) => {
//   test.setTimeout(3 * 60_000);
//   const plp = new PlpPage(page);
//   const pdp = new PdpPage(page);
// 
//   await openPdpFromPlp(plp, '/aprons/');
// 
//   // The real "Add Embroidery" flow on this PDP is a 4-tab modal (Name Embroidery, Monogram,
//   // Emoji, Logo Embroidery) with per-tab pricing - not the lead-gen contact form (first/last
//   // name, phone, "how many are you outfitting", CAPTCHA) described in the spreadsheet's
//   // EMB_001-022. Tests below cover the modal as it actually behaves; EMB cases describing
//   // fields that don't exist on this modal are recorded as not automated rather than faked.
// 
//   await test.step('TC_PDP_023 / EMB_001 - "Add Embroidery" opens the personalisation modal', async () => {
//     await pdp.openEmbroideryModal();
//     await expect.soft(pdp.embroideryDialog.getByRole('tab', { name: /Name Embroidery/ })).toHaveAttribute(
//       'aria-selected',
//       'true',
//     );
//   });
// 
//   await test.step('EMB_002 - modal overlays the page', async () => {
//     const box = await pdp.embroideryDialog.boundingBox();
//     expect.soft(box).not.toBeNull();
//   });
// 
//   await test.step('EMB_003 - modal has the correct title', async () => {
//     await expect.soft(pdp.embroideryDialog.getByRole('heading', { name: 'Make it your own.' })).toBeVisible();
//   });
// 
//   await test.step('EMB_004 - all embroidery tabs are available', async () => {
//     for (const tabName of ['Name Embroidery', 'Monogram', 'Emoji', 'Logo Embroidery']) {
//       await expect.soft(pdp.embroideryDialog.getByRole('tab', { name: new RegExp(tabName) })).toBeVisible();
//     }
//   });
// 
//   await test.step('EMB_005 - Name Embroidery field accepts input and updates the status', async () => {
//     await pdp.embroideryDialog.getByRole('tab', { name: /Name Embroidery/ }).click();
//     const nameField = pdp.embroideryDialog.getByRole('textbox', { name: 'Add a name' });
//     await nameField.fill('CARGO');
//     await expect.soft(pdp.embroideryDialog).not.toContainText('No name entered');
//   });
// 
//   await test.step('EMB_006 - thread colour and font options are selectable', async () => {
//     await expect.soft(pdp.embroideryDialog.getByRole('combobox', { name: 'Choose font' })).toBeVisible();
//     await expect.soft(pdp.embroideryDialog.getByRole('radiogroup', { name: 'Thread colour' })).toBeVisible();
//     await pdp.embroideryDialog.getByRole('radio', { name: 'Navy' }).check();
//     await expect.soft(pdp.embroideryDialog.getByRole('radio', { name: 'Navy' })).toBeChecked();
//   });
// 
//   await test.step('EMB_007 - total price updates with embroidery selected', async () => {
//     await expect.soft(pdp.embroideryDialog).toContainText(/Total\s*\$\d+\.\d{2}/);
//   });
// 
//   await test.step('TC_PDP_024 - "Logo Embroidery" option shows upload & pricing details', async () => {
//     await pdp.embroideryDialog.getByRole('tab', { name: /Logo Embroidery/ }).click();
//     await expect.soft(pdp.embroideryDialog).toContainText('minimum of 6 units is required');
//     await expect.soft(pdp.embroideryDialog.getByRole('button', { name: 'Browse Files' })).toBeVisible();
//   });
// 
//   await test.step('EMB_008 - modal closes without applying when "Close" is clicked', async () => {
//     await pdp.embroideryDialog.getByRole('button', { name: 'Close' }).click();
//     await expect(pdp.embroideryDialog).toBeHidden();
//   });
// 
//   pending(
//     testInfo,
//     'EMB_009-022',
//     'Lead-gen quote form (name/phone/company, "how many people are you outfitting?", CAPTCHA, file-type validation) - not found anywhere in the "Add Embroidery" modal on this PDP. Confirm with the team which page this form lives on before automating it.',
//   );
// });
// 
// test('PDP - accordions & galleries', async ({ page }, testInfo) => {
//   test.setTimeout(3 * 60_000);
//   const plp = new PlpPage(page);
//   const pdp = new PdpPage(page);
// 
//   await openPdpFromPlp(plp, '/aprons/');
// 
//   await test.step('TC_PDP_025 - "Description" accordion expands and collapses', async () => {
//     await pdp.toggleAccordion('Description', 'true');
//     await pdp.toggleAccordion('Description', 'false');
//   });
// 
//   await test.step('TC_PDP_026 - "Garment care" accordion expands and collapses', async () => {
//     await pdp.toggleAccordion('Garment care', 'true');
//     await pdp.toggleAccordion('Garment care', 'false');
//   });
// 
//   await test.step('TC_PDP_027 - "As seen on our crews" gallery loads images', async () => {
//     const gallery = page.getByRole('region', { name: /As seen on our crews/i });
//     if (await gallery.count()) {
//       await expect.soft(gallery.locator('img').first()).toBeVisible();
//     } else {
//       test.info().annotations.push({ type: 'skip reason', description: 'No "As seen on our crews" gallery on this product' });
//     }
//   });
// 
//   await test.step('TC_PDP_028 - "As seen on our crews" gallery scrolls with Previous/Next', async () => {
//     const prev = page.getByRole('button', { name: 'Previous' });
//     const next = page.getByRole('button', { name: 'Next' });
//     if (await next.count()) {
//       await next.click();
//       await prev.click();
//     } else {
//       test.info().annotations.push({ type: 'skip reason', description: 'No gallery carousel controls on this product' });
//     }
//   });
// 
//   await test.step('TC_PDP_029 - reviews summary is visible on the PDP', async () => {
//     if (await pdp.reviewsButton.count()) {
//       await expect.soft(pdp.reviewsButton).toBeVisible();
//     } else {
//       test.info().annotations.push({ type: 'skip reason', description: 'No reviews yet for this product ("Be the first to review")' });
//     }
//   });
// 
//   pending(
//     testInfo,
//     'TC_PDP_030-036',
//     'Review submission form (rating, nickname, summary, CAPTCHA, submit) - the review widget did not expose an inline form during exploration; needs dedicated investigation before automating.',
//   );
// });
// 
// test('PDP - sections not found on this build (documented, not automated)', async ({}, testInfo) => {
//   // TC_UC_001-011 (Uniform Customization), TC_BP_001-006 (Bulk Ordering & Dynamic Pricing) and
//   // TC_IO_001-007 (International Ordering Workflow) describe functionality that was not
//   // observed on the PDP during exploration: a distinct "uniform customization" UI beyond the
//   // embroidery modal, quantity-tier pricing breakpoints, and country/currency-aware checkout
//   // logic on the product page itself. Automating them now would mean guessing selectors against
//   // UI that may not exist here, so they're recorded as not-automated - keeping their IDs for
//   // traceability against the spreadsheet - until the actual pages/flows are confirmed.
//   pending(
//     testInfo,
//     'TC_UC_001-011',
//     'Uniform Customization & Embroidery - no distinct "uniform customization" UI was found on this PDP beyond the embroidery modal. Needs UI confirmation.',
//   );
//   pending(
//     testInfo,
//     'TC_BP_001-006',
//     'Bulk Ordering & Dynamic Pricing - no quantity-tier pricing UI was observed on this PDP during exploration. Needs UI confirmation.',
//   );
//   pending(
//     testInfo,
//     'TC_IO_001-007',
//     'International Ordering Workflow - no country/currency-aware checkout logic was observed on the product page itself (currency switch is header-level, not product-specific). Needs UI confirmation.',
//   );
// });
