import { test, expect } from '@playwright/test';
import { PlpPage } from './pages/PlpPage';
import { open } from './helpers/site';
import { knownBug } from './helpers/known-bug';
import { fetchPlpProducts, fetchPlpResult } from './helpers/plp';

const PAGE_SIZE = 24;

const isSorted = (values: number[], dir: 'asc' | 'desc') =>
  values.every((v, i) => i === 0 || (dir === 'asc' ? values[i - 1] <= v : values[i - 1] >= v));

test('PLP - Aprons', async ({ page }) => {
  // All scenarios run in one test, so give it room.
  test.setTimeout(15 * 60_000);
  const plp = new PlpPage(page);

  /* ---------------- Page content ---------------- */

  await test.step('PLP01 - page title, heading and breadcrumb are correct', async () => {
    await plp.goto('/aprons/');

    await expect.soft(page).toHaveTitle(/Aprons/);
    await expect.soft(plp.heading).toHaveText('Aprons');
    await expect.soft(plp.breadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect.soft(plp.breadcrumb.locator('[aria-current="page"]')).toHaveText('Aprons');
  });

  await test.step('PLP02 - total styles count is shown', async () => {
    await expect.soft(plp.styleCount).toBeVisible();
    expect.soft(await plp.totalStyles()).toBeGreaterThan(0);
  });

  await test.step('PLP02b - total styles count matches the server\'s own hit count (API-backed)', async () => {
    // There is no listing REST API on this site - the closest equivalent is the page's own React
    // Server Component (RSC) payload, which embeds `nbHits` (Algolia's own total-hit count, what
    // "N Styles" is sourced from) alongside the product array the server computed (see
    // `fetchPlpResult`). Comparing against it is real backend validation, not UI-vs-UI.
    const [uiTotal, backendResult] = await Promise.all([plp.totalStyles(), fetchPlpResult(page, '/aprons/')]);
    expect.soft(uiTotal, '"N Styles" label should match the backend\'s nbHits').toBe(backendResult.nbHits);
  });

  await test.step('PLP03 - category description expands with Read more / Read less', async () => {
    await expect(plp.readMore).toHaveText('Read more');
    await plp.readMore.click();
    await expect.soft(plp.readMore).toHaveText('Read less');
    await expect.soft(plp.readMore).toHaveAttribute('aria-expanded', 'true');
    await plp.readMore.click();
    await expect.soft(plp.readMore).toHaveText('Read more');
  });

  await test.step('PLP04 - breadcrumb Home link goes to home page', async () => {
    await plp.breadcrumb.getByRole('link', { name: 'Home' }).click();
    await expect.soft(page).toHaveURL(/\/$/);
  });

  /* ---------------- Product grid ---------------- */

  await test.step('PLP05 - first page shows 24 products', async () => {
    await plp.goto('/aprons/');
    await expect.soft(plp.productCards).toHaveCount(PAGE_SIZE);
  });

  await test.step('PLP06 - every product card has image, name, price and actions', async () => {
    for (const card of await plp.productCards.all()) {
      await expect.soft(card.locator('img').first()).toHaveAttribute('alt', /.+/);
      await expect.soft(plp.cardTitle(card)).toHaveText(/.+/);
      await expect.soft(plp.cardTitle(card)).toHaveAttribute('href', /^\/product\/.+/);
      await expect.soft(card).toContainText(/\$\d+\.\d{2}/);
      await expect.soft(card.getByRole('button', { name: /to wishlist$/ })).toBeAttached();
      await expect.soft(card.getByRole('button', { name: /^Quick buy/ })).toBeAttached();
    }
  });

  await test.step('PLP06b - card prices match the server\'s own price for each product (API-backed)', async () => {
    const [cardHrefs, cardPrices, backendProducts] = await Promise.all([plp.cardHrefs(), plp.cardPrices(), fetchPlpProducts(page, '/aprons/')]);
    for (let i = 0; i < cardHrefs.length; i++) {
      const href = cardHrefs[i];
      const backendProduct = backendProducts.find((p) => href?.startsWith(p.href));
      expect.soft(backendProduct, `backend should know product at "${href}"`).toBeTruthy();
      if (backendProduct) expect.soft(cardPrices[i], `card price for "${href}" should match the backend`).toBe(backendProduct.price);
    }
  });

  await test.step('PLP06b - merchandising badges, star ratings and colour counts render correctly when present', async () => {
    for (const card of await plp.productCards.all()) {
      const badge = plp.cardBadge(card);
      if (await badge.count()) await expect.soft(badge.first()).toBeVisible();

      const rating = plp.cardRating(card);
      if (await rating.count()) {
        await expect.soft(rating.first()).toHaveAttribute('aria-label', /^Rated \d+(\.\d+)? out of 5 from \d+ reviews?$/);
      }

      const colourCount = plp.cardColourCount(card);
      if (await colourCount.count()) {
        await expect.soft(colourCount.first()).toHaveText(/^\d+ colours?$/);
        await expect.soft(colourCount.first()).toHaveAttribute('href', /^\/product\/.+/);
      }
    }
  });

  await test.step('PLP07 - product images are loaded', async () => {
    const img = plp.productCards.first().locator('img').first();
    await img.scrollIntoViewIfNeeded();
    await expect
      .soft.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
  });

  await test.step('PLP08 - clicking a product opens its PDP', async () => {
    const title = plp.cardTitle(plp.productCards.first());
    const name = (await title.innerText()).trim();
    const href = await title.getAttribute('href');

    await title.click();

    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect.soft(page.getByRole('heading', { level: 1 }).first()).toContainText(name);
  });

  /* ---------------- Category tabs ---------------- */

  await test.step('PLP09 - "Shop All" tab is selected by default', async () => {
    await plp.goto('/aprons/');
    await expect.soft(plp.categoryTabs.first()).toHaveText('Shop All');
    await expect.soft(plp.categoryTabs.first()).toHaveAttribute('aria-selected', 'true');
  });

  await test.step('PLP10 - sub-category tab opens a narrower listing', async () => {
    const total = await plp.totalStyles();

    // First click can land before hydration, so retry until it navigates.
    await expect(async () => {
      await plp.categoryTabs.filter({ hasText: /^Bib$/ }).click();
      await expect(page).toHaveURL(/\/aprons\/bib\/$/, { timeout: 5_000 });
    }).toPass();
    await expect.soft(plp.heading).toHaveText('Bib Aprons');
    await expect(plp.productCards.first()).toBeVisible();
    expect.soft(await plp.totalStyles()).toBeLessThan(total);
  });

  for (const { label, slug } of [
    { label: 'Neck Strap', slug: 'neck-strap' },
    { label: 'Canvas', slug: 'canvas' },
    { label: 'Chef Fit', slug: 'chef-fit' },
    { label: 'Cross-Back', slug: 'cross-back' },
  ]) {
    await test.step(`PLP10b - "${label}" tab opens a narrower listing`, async () => {
      await plp.goto('/aprons/');
      const total = await plp.totalStyles();

      // First click can land before hydration, so retry until it navigates.
      await expect(async () => {
        await plp.categoryTabs.filter({ hasText: new RegExp(`^${label}$`) }).click();
        await expect(page).toHaveURL(new RegExp(`/aprons/${slug}/$`), { timeout: 5_000 });
      }).toPass();
      await expect.soft(plp.heading).toHaveText(`${label} Aprons`);
      await expect(plp.productCards.first()).toBeVisible();
      expect.soft(await plp.totalStyles()).toBeLessThan(total);
    });
  }

  /* ---------------- Sort ---------------- */

  await test.step('PLP11 - sort menu lists all options with Featured as default', async () => {
    await plp.goto('/aprons/');
    await expect(async () => {
      if ((await plp.sortButton.getAttribute('aria-expanded')) !== 'true') await plp.sortButton.click();
      await expect(plp.sortButton).toHaveAttribute('aria-expanded', 'true', { timeout: 2_000 });
    }).toPass();
    for (const opt of ['Featured', 'Price: Low to High', 'Price: High to Low', 'Newest']) {
      await expect.soft(page.getByRole('radio', { name: opt })).toBeAttached();
    }
    await expect.soft(page.getByRole('radio', { name: 'Featured' })).toBeChecked();
  });

  await test.step('PLP12 - sort Price: Low to High orders products ascending', async () => {
    await plp.goto('/aprons/');
    await plp.sortBy('Price: Low to High');
    await expect(page).toHaveURL(/sort=price-asc/);

    await expect(plp.productCards.first()).toBeVisible();
    await knownBug('BUG-1', 'Sort is ignored by the server - products keep Featured order', async () => {
      await expect
        .poll(async () => isSorted(await plp.cardPrices(), 'asc'), { message: 'prices should be low → high', timeout: 10_000 })
        .toBe(true);
    });

    // API-backed: fetching the server's own RSC payload for this exact URL - bypassing the rendered
    // page entirely - confirms this isn't just a frontend rendering gap: the server computes the
    // same (unsorted) order no matter the `sort` query param, so BUG-1 is a backend defect.
    await knownBug('BUG-1', "the server's own product order for ?sort=price-asc is identical to Featured order, not ascending", async () => {
      const backendPrices = (await fetchPlpProducts(page, '/aprons/?sort=price-asc')).map((p) => p.price);
      expect(isSorted(backendPrices, 'asc'), 'backend product order should be price low → high').toBe(true);
    });
  });

  await test.step('PLP13 - sort Price: High to Low orders products descending', async () => {
    await plp.goto('/aprons/');
    await plp.sortBy('Price: High to Low');
    await expect(page).toHaveURL(/sort=price-desc/);

    await expect(plp.productCards.first()).toBeVisible();
    await knownBug('BUG-1', 'Sort is ignored by the server - products keep Featured order', async () => {
      await expect
        .poll(async () => isSorted(await plp.cardPrices(), 'desc'), { message: 'prices should be high → low', timeout: 10_000 })
        .toBe(true);
    });

    await knownBug('BUG-1', "the server's own product order for ?sort=price-desc is identical to Featured order, not descending", async () => {
      const backendPrices = (await fetchPlpProducts(page, '/aprons/?sort=price-desc')).map((p) => p.price);
      expect(isSorted(backendPrices, 'desc'), 'backend product order should be price high → low').toBe(true);
    });
  });

  await test.step('PLP14 - sort selection is kept after reload', async () => {
    await plp.goto('/aprons/');
    await plp.sortBy('Newest');
    await expect(page).toHaveURL(/sort=newest/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(plp.productCards.first()).toBeVisible();
    await plp.sortButton.click();
    await expect.soft(page.getByRole('radio', { name: 'Newest' })).toBeChecked();
  });

  /* ---------------- Pagination ---------------- */

  await test.step('PLP15 - pagination: first page has Previous disabled', async () => {
    await plp.goto('/aprons/');
    await expect.soft(plp.pagination.getByRole('link', { name: '1', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect.soft(plp.pagination.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  await test.step('PLP16 - pagination: go to page 2 shows different products', async () => {
    const page1 = await plp.cardHrefs();

    await plp.pagination.getByRole('link', { name: '2', exact: true }).click();

    await expect(page).toHaveURL(/[?&]p=2/);
    await expect.soft(plp.pagination.getByRole('link', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect.soft(plp.productCards).toHaveCount(PAGE_SIZE);
    await expect.soft.poll(() => plp.cardHrefs()).not.toEqual(page1);
  });

  await test.step('PLP17 - pagination: Next and Previous work', async () => {
    await plp.pagination.getByRole('link', { name: 'Next page' }).click();
    await expect.soft(page).toHaveURL(/[?&]p=3/);

    await plp.pagination.getByRole('link', { name: 'Previous page' }).click();
    await expect.soft(page).toHaveURL(/[?&]p=2/);
  });

  await test.step('PLP18 - pagination: last page has Next disabled and remaining products', async () => {
    await plp.goto('/aprons/');
    const lastPage = Math.ceil((await plp.totalStyles()) / PAGE_SIZE);

    await plp.goto(`/aprons/?p=${lastPage}`);

    await expect.soft(plp.pagination.getByRole('button', { name: 'Next page' })).toBeDisabled();
    const count = await plp.productCards.count();
    expect.soft(count).toBeGreaterThan(0);
    expect.soft(count).toBeLessThanOrEqual(PAGE_SIZE);
  });

  await test.step('PLP19 - View All shows every style on one page', async () => {
    await plp.goto('/aprons/');
    const total = await plp.totalStyles();

    await plp.viewAll.click();

    await expect(page).toHaveURL(/view=all/);
    await knownBug('BUG-2', '"N Styles" count is higher than the products actually listed (147 shown vs 140 real)', async () => {
      await expect(plp.productCards, `"${total} Styles" label should match products listed`).toHaveCount(total, { timeout: 10_000 });
    });

    // API-backed: compares the label against the server's own figures for this exact URL, not the
    // rendered cards - pinning down whether BUG-2 is the backend's nbHits disagreeing with its own
    // product array (a backend data bug) or the array being right but the frontend under-rendering
    // it (a frontend bug).
    const backendResult = await fetchPlpResult(page, '/aprons/?view=all');
    await knownBug(
      'BUG-2',
      `"${total} Styles" label does not match the server's own nbHits (${backendResult.nbHits}) and/or product array length (${backendResult.products.length})`,
      async () => {
        expect(backendResult.nbHits, 'backend nbHits should match the "N Styles" label').toBe(total);
        expect(backendResult.products.length, "backend's own product array should contain nbHits products").toBe(backendResult.nbHits);
      },
    );
  });

  /* ---------------- Quick buy & wishlist ---------------- */

  await test.step('PLP20 - Quick buy opens product dialog and closes', async () => {
    await plp.goto('/aprons/');
    const card = plp.productCards.first();
    const name = (await plp.cardTitle(card).innerText()).trim();

    await card.hover();
    await card.getByRole('button', { name: /^Quick buy/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Quick buy' });
    await expect(dialog).toBeVisible();
    await expect.soft(dialog.getByRole('heading', { level: 2, name: new RegExp(name) })).toBeVisible();
    await expect.soft(dialog).toContainText(/\$\d+\.\d{2}/);
    await expect.soft(dialog.getByRole('list', { name: 'Choose Colour' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Close quick buy' }).click();
    await expect.soft(dialog).toBeHidden();
  });

  await test.step('PLP21 - adding a product to wishlist', async () => {
    const card = plp.productCards.first();
    const name = (await plp.cardTitle(card).innerText()).trim();

    await card.hover();
    await card.getByRole('button', { name: /to wishlist$/ }).click();
    await expect.soft(card.getByRole('button', { name: /from wishlist$/ })).toHaveAttribute('aria-pressed', 'true');

    await open(page, '/wishlist/');
    await expect.soft(page.locator('main')).toContainText(name);
  });

  /* ---------------- Filters ---------------- */

  await test.step('FLT01 - filter panel opens with all filter groups and closes', async () => {
    await plp.goto('/aprons/');
    await plp.openFilter();
    for (const group of ['Colour', 'Gender', 'Garment Length', 'Material', 'Pattern']) {
      await expect.soft(plp.filterDialog.getByRole('button', { name: group, exact: true })).toBeVisible();
    }
    await expect.soft(plp.filterDialog.getByRole('link', { name: 'Apply Filters' })).toBeVisible();
    await expect.soft(plp.clearFiltersLink(0)).toBeVisible();

    await plp.filterDialog.getByRole('button', { name: 'Close' }).click();
    await expect.soft(plp.filterDialog).toBeHidden();
  });

  await test.step('FLT02 - Escape key closes the filter panel', async () => {
    await plp.openFilter();
    await page.keyboard.press('Escape');
    await expect.soft(plp.filterDialog).toBeHidden();
  });

  await test.step('FLT03 - filter groups expand and every option shows a product count', async () => {
    await plp.openFilter();
    for (const group of ['Colour', 'Gender', 'Garment Length', 'Material', 'Pattern']) {
      await plp.expandFilterGroup(group);
    }

    const options = plp.filterDialog.locator('a[data-facet-key]');
    expect.soft(await options.count()).toBeGreaterThan(0);
    for (const option of await options.all()) {
      expect.soft(await plp.filterOptionCount(option)).toBeGreaterThan(0);
      await expect.soft(option).toHaveAttribute('href', /^\/aprons\/.+\/$/);
    }
  });

  await test.step('FLT04 - colour filter shows only that colour with matching count', async () => {
    await plp.goto('/aprons/');
    await plp.openFilter();
    const option = await plp.selectFilter('Colour', 'Black');
    const expected = await plp.filterOptionCount(option);
    await expect.soft(plp.clearFiltersLink(1)).toBeVisible();

    await plp.applyFilters();

    await expect(page).toHaveURL(/\/aprons\/black\/$/);
    await expect.soft(plp.heading).toHaveText('Black Aprons');
    expect.soft(await plp.totalStyles()).toBe(expected);

    await test.step('API-backed: the backend\'s own hit count and product data agree with the filtered UI', async () => {
      const backendResult = await fetchPlpResult(page, '/aprons/black/');
      expect.soft(backendResult.nbHits, 'backend nbHits for the filtered URL should match the UI count').toBe(expected);
      for (const product of backendResult.products) {
        expect.soft(product.colour, `product "${product.title}" returned for the Black filter should actually be Black`).toMatch(/black/i);
      }
    });
  });

  // One option from each remaining filter group: check URL, heading and count.
  // `slugClash`: option links to a category page with the same URL, so the filter is never applied (BUG-3).
  for (const { group, label, slug, slugClash } of [
    { group: 'Gender', label: 'Mens', slug: 'mens', slugClash: false },
    { group: 'Garment Length', label: 'Waist', slug: 'waist', slugClash: true },
    { group: 'Material', label: 'Denim', slug: 'denim', slugClash: true },
    { group: 'Pattern', label: 'Stripe', slug: 'stripe', slugClash: false },
  ]) {
    await test.step(`FLT05 - ${group} filter "${label}" shows matching products`, async () => {
      await plp.goto('/aprons/');
      await plp.openFilter();
      const option = await plp.selectFilter(group, label);
      const expected = await plp.filterOptionCount(option);

      await plp.applyFilters();

      await expect(page).toHaveURL(new RegExp(`/aprons/${slug}/$`));
      await expect.soft(plp.heading).toHaveText(`${label} Aprons`);

      const checkCounts = async () => {
        expect(await plp.totalStyles(), `"${label} (${expected})" in filter should match results`).toBe(expected);
        await expect(plp.productCards).toHaveCount(Math.min(expected, PAGE_SIZE), { timeout: 5_000 });
      };
      if (slugClash) {
        await knownBug('BUG-3', `"${label}" filter opens the /aprons/${slug}/ category page instead of filtering`, checkCounts);
      } else {
        await checkCounts();
      }
    });
  }

  await test.step('FLT06 - clicking a selected option again deselects it', async () => {
    await plp.goto('/aprons/');
    await plp.openFilter();
    const option = await plp.selectFilter('Colour', 'Black');
    await expect.soft(plp.clearFiltersLink(1)).toBeVisible();

    await option.click();

    await expect.soft(option).toHaveAttribute('aria-pressed', 'false');
    await expect.soft(plp.clearFiltersLink(0)).toBeVisible();
  });

  await test.step('FLT07 - two colours combine with OR (results add up)', async () => {
    await plp.goto('/aprons/');
    await plp.openFilter();
    const black = await plp.selectFilter('Colour', 'Black');
    const blackCount = await plp.filterOptionCount(black);
    const navy = await plp.selectFilter('Colour', 'Navy');
    const navyCount = await plp.filterOptionCount(navy);
    const expected = blackCount + navyCount;
    await expect.soft(plp.clearFiltersLink(2)).toBeVisible();

    await plp.applyFilters();

    await expect(page).toHaveURL(/\/aprons\/black_navy\/$/);
    expect.soft(await plp.totalStyles()).toBe(expected);
  });

  await test.step('FLT08 - filters from different groups combine with AND (results narrow)', async () => {
    await plp.goto('/aprons/');
    await plp.openFilter();
    const black = await plp.selectFilter('Colour', 'Black');
    const blackCount = await plp.filterOptionCount(black);
    await plp.selectFilter('Material', 'Canvas');

    await test.step('FLT09 - selected filters are listed with Remove links', async () => {
      await expect.soft(plp.clearFiltersLink(2)).toBeVisible();
      await expect.soft(plp.filterDialog.getByRole('link', { name: 'Remove filter Colour: Black' })).toBeVisible();
      await expect.soft(plp.filterDialog.getByRole('link', { name: 'Remove filter Material: Canvas' })).toBeVisible();
    });

    await plp.applyFilters();

    await expect(page).toHaveURL(/\/aprons\/black_canvas\/$/);
    await expect.soft(plp.heading).toHaveText('Black Canvas Aprons');
    const total = await plp.totalStyles();
    expect.soft(total).toBeGreaterThan(0);
    expect.soft(total).toBeLessThan(blackCount);
  });

  await test.step('FLT10 - removing one filter keeps the others', async () => {
    await plp.goto('/aprons/black_canvas/');
    await plp.openFilter();
    await expect.soft(plp.clearFiltersLink(2)).toBeVisible();

    await plp.filterDialog.getByRole('link', { name: 'Remove filter Colour: Black' }).click();
    await expect.soft(plp.clearFiltersLink(1)).toBeVisible();
    await plp.applyFilters();

    await expect.soft(page).toHaveURL(/\/aprons\/canvas\/$/);
    await expect.soft(plp.heading).toHaveText('Canvas Aprons');
  });

  await test.step('FLT11 - Clear Filters removes all applied filters', async () => {
    await plp.goto('/aprons/black/');
    await plp.openFilter();
    await expect.soft(plp.filterDialog.getByRole('link', { name: 'Remove filter Colour: Black' })).toBeVisible();

    await plp.clearFiltersLink(1).click();

    await expect.soft(page).toHaveURL(/\/aprons\/$/);
    await expect.soft(plp.heading).toHaveText('Aprons');
  });

  await test.step('FLT12 - closing the panel without Apply does not change results', async () => {
    await plp.goto('/aprons/');
    const total = await plp.totalStyles();
    await plp.openFilter();
    await plp.selectFilter('Colour', 'Black');

    await plp.filterDialog.getByRole('button', { name: 'Close' }).click();

    await expect.soft(plp.filterDialog).toBeHidden();
    await expect.soft(page).toHaveURL(/\/aprons\/$/);
    expect.soft(await plp.totalStyles()).toBe(total);
  });

  await test.step('FLT13 - filtered URL opened directly keeps the filter applied', async () => {
    await plp.goto('/aprons/black_navy/');

    await expect.soft(plp.heading).toHaveText('Black Navy Aprons');
    await plp.openFilter();
    await expect.soft(plp.clearFiltersLink(2)).toBeVisible();
    await expect.soft(plp.filterDialog.getByRole('link', { name: 'Remove filter Colour: Black' })).toBeVisible();
    await expect.soft(plp.filterDialog.getByRole('link', { name: 'Remove filter Colour: Navy' })).toBeVisible();
  });

  await test.step('FLT14 - filter and sort work together', async () => {
    await plp.goto('/aprons/black/');
    const total = await plp.totalStyles();

    await plp.sortBy('Price: Low to High');

    await expect.soft(page).toHaveURL(/\/aprons\/black\/\?sort=price-asc/);
    await expect.soft(plp.heading).toHaveText('Black Aprons');
    expect.soft(await plp.totalStyles()).toBe(total);
  });

  await test.step('FLT15 - small filtered result has no pagination', async () => {
    await plp.goto('/aprons/mens/');
    const total = await plp.totalStyles();
    expect.soft(total).toBeLessThanOrEqual(PAGE_SIZE);

    await expect.soft(plp.productCards).toHaveCount(total);
    await expect.soft(plp.pagination).toHaveCount(0);
  });

  await test.step('FLT16 - large filtered result is paginated with a full first page', async () => {
    await plp.goto('/aprons/canvas/');
    expect.soft(await plp.totalStyles()).toBeGreaterThan(PAGE_SIZE);

    await knownBug('BUG-2', 'Pages list fewer than 24 products - /aprons/canvas/ page 1 shows 23 (46 counted, 42 listed)', async () => {
      await expect(plp.productCards).toHaveCount(PAGE_SIZE, { timeout: 10_000 });
    });
    await plp.pagination.getByRole('link', { name: '2', exact: true }).click();
    await expect.soft(page).toHaveURL(/\/aprons\/canvas\/\?p=2/);
    await expect.soft(plp.heading).toHaveText('Canvas Aprons');
  });

  /* ---------------- Promo banner ---------------- */

  await test.step('PLP22 - category promo banner links to its own collection', async () => {
    await plp.goto('/aprons/');
    const banner = page.locator('main').getByRole('link', { name: /^Shop .+ Aprons$/ });
    await expect.soft(banner).toBeVisible();
    await expect.soft(banner).toHaveAttribute('href', /^\/aprons\/.+/);

    const href = await banner.getAttribute('href');
    await banner.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(plp.productCards.first()).toBeVisible();
  });

  /* ---------------- Mobile ---------------- */

  await test.step('MOB01 - grid and filter work on mobile', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await plp.goto('/aprons/');

    await expect.soft(plp.heading).toBeVisible();
    await expect.soft(plp.sortButton).toBeVisible();
    await expect.soft(plp.productCards).toHaveCount(PAGE_SIZE);

    // Two cards per row on mobile.
    const [a, b] = await Promise.all([plp.productCards.nth(0).boundingBox(), plp.productCards.nth(1).boundingBox()]);
    expect.soft(Math.abs(a!.y - b!.y)).toBeLessThan(5);

    await plp.openFilter();
    await plp.selectFilter('Colour', 'Black');
    await plp.applyFilters();

    await expect.soft(page).toHaveURL(/\/aprons\/black\/$/);
    await expect.soft(plp.heading).toHaveText('Black Aprons');
  });
});
