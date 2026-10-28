import { Locator, Page, expect } from '@playwright/test';
import { open } from '../helpers/site';

/** Product Listing Page, e.g. /aprons/ */
export class PlpPage {
  readonly heading: Locator;
  readonly breadcrumb: Locator;
  readonly styleCount: Locator;
  readonly viewAll: Locator;
  readonly sortButton: Locator;
  readonly filterButton: Locator;
  readonly filterDialog: Locator;
  readonly categoryTabs: Locator;
  readonly productCards: Locator;
  readonly pagination: Locator;
  readonly readMore: Locator;

  constructor(readonly page: Page) {
    const main = page.locator('main');
    this.heading = page.getByRole('heading', { level: 1 });
    this.breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    this.styleCount = main.getByText(/^\d+ Styles?$/);
    this.viewAll = main.getByRole('link', { name: 'View All' });
    this.sortButton = page.getByRole('button', { name: 'Sort products' });
    this.filterButton = page.getByRole('button', { name: 'Filter', exact: true });
    this.filterDialog = page.getByRole('dialog', { name: 'Filter' });
    this.categoryTabs = main.getByRole('tablist').getByRole('tab');
    this.productCards = main.locator('article');
    this.pagination = page.getByRole('navigation', { name: 'Pagination' });
    this.readMore = main.getByRole('button', { name: /^Read (more|less)$/ });
  }

  /** Merchandising badge on a card, e.g. "Best Seller", "New In", "Sustainable", "Last Run". */
  cardBadge(card: Locator) {
    return card.locator('span', { hasText: /^(Best Seller|New In|Sustainable|Last Run)$/ });
  }

  /** Star-rating element on a card, e.g. aria-label "Rated 4.9 out of 5 from 97 reviews". */
  cardRating(card: Locator) {
    return card.locator('[role="img"][aria-label^="Rated"]');
  }

  /** "N colours" link on a card. */
  cardColourCount(card: Locator) {
    return card.getByRole('link', { name: /colours?$/ });
  }

  async goto(path = '/aprons/') {
    await open(this.page, path);
    await expect(this.productCards.first()).toBeVisible();
  }

  async totalStyles(): Promise<number> {
    return parseInt(await this.styleCount.innerText(), 10);
  }

  /** Product link (title, not the image) inside a card. */
  cardTitle(card: Locator) {
    return card.getByRole('link').nth(1);
  }

  /** PDP link of every card on the page. */
  async cardHrefs(): Promise<(string | null)[]> {
    return this.productCards.evaluateAll((cards) =>
      cards.map((c) => c.querySelector('a[href^="/product/"]')?.getAttribute('href') ?? null),
    );
  }

  /** Price of every card on the page, as numbers. */
  async cardPrices(): Promise<number[]> {
    const texts = await this.productCards.allInnerTexts();
    return texts.map((t) => {
      const m = t.match(/\$(\d+(?:\.\d{2})?)/);
      if (!m) throw new Error(`No price in card: ${t}`);
      return parseFloat(m[1]);
    });
  }

  /** Cards that look like a normal purchasable garment, excluding gift cards/bundles/accessories by name when identifiable. */
  eligibleProductCards() {
    return this.productCards.filter({ hasNotText: /gift card|bundle|accessory|accessories/i });
  }

  /** Picks a random eligible card and returns its name and PDP href, for scenarios that need "any normal product". */
  async pickRandomEligibleProduct(): Promise<{ card: Locator; name: string; href: string }> {
    const cards = this.eligibleProductCards();
    const count = await cards.count();
    if (count === 0) throw new Error('No eligible products found on this PLP');
    const card = cards.nth(Math.floor(Math.random() * count));
    const name = (await this.cardTitle(card).innerText()).trim();
    const href = await card.locator('a[href^="/product/"]').first().getAttribute('href');
    if (!href) throw new Error(`Could not find a PDP link for card "${name}"`);
    return { card, name, href };
  }

  async sortBy(option: 'Featured' | 'Price: Low to High' | 'Price: High to Low' | 'Newest') {
    // First click can land before hydration, so retry until the menu opens.
    await expect(async () => {
      if ((await this.sortButton.getAttribute('aria-expanded')) !== 'true') await this.sortButton.click();
      await expect(this.sortButton).toHaveAttribute('aria-expanded', 'true', { timeout: 2_000 });
    }).toPass();
    await this.page.getByRole('radio', { name: option }).click({ force: true });
  }

  async openFilter() {
    // First click can land before hydration, so retry until the panel opens.
    await expect(async () => {
      if (!(await this.filterDialog.isVisible())) await this.filterButton.click();
      await expect(this.filterDialog).toBeVisible({ timeout: 2_000 });
    }).toPass();
  }

  /** Expands a filter group (Colour, Gender, Garment Length, Material, Pattern). */
  async expandFilterGroup(group: string) {
    const button = this.filterDialog.getByRole('button', { name: group, exact: true });
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
  }

  /** Filter option link, e.g. "Black (17)". */
  filterOption(label: string) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    return this.filterDialog.getByRole('link', { name: new RegExp(`^${escaped} \\(\\d+\\)$`) });
  }

  /** Product count shown next to a filter option. */
  async filterOptionCount(option: Locator): Promise<number> {
    const label = (await option.getAttribute('aria-label')) ?? (await option.textContent()) ?? '';
    return parseInt(label.match(/\((\d+)\)\s*$/)![1], 10);
  }

  /** Selects an option inside a group (does not apply). */
  async selectFilter(group: string, label: string) {
    await this.expandFilterGroup(group);
    const option = this.filterOption(label);
    await option.click();
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    return option;
  }

  clearFiltersLink(count: number) {
    return this.filterDialog.getByRole('link', { name: `Clear Filters (${count})` });
  }

  async applyFilters() {
    await this.filterDialog.getByRole('link', { name: 'Apply Filters' }).click();
    await expect(this.filterDialog).toBeHidden();
    await expect(this.productCards.first()).toBeVisible();
  }
}
