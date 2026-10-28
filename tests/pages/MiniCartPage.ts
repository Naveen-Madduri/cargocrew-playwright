import { Locator, Page, expect } from '@playwright/test';
import { BackendCart } from '../helpers/price';

/** Escapes a string for safe use inside a `new RegExp(...)`. */
function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The mini-cart flyout ("Your Cart" dialog), opened either from the header cart icon or
 * automatically after an "Add to Bag" / "Add to cart" action elsewhere on the site.
 */
export class MiniCartPage {
  readonly header: Locator;
  readonly cartIcon: Locator;
  readonly cartBadge: Locator;
  readonly dialog: Locator;
  readonly closeButton: Locator;
  readonly emptyHeading: Locator;
  readonly startShoppingLink: Locator;
  // The items list is the first <ul> in the dialog - the "Add a little extra" suggestions render
  // in their own <ul> further down, after this one, and only once at least one real item exists.
  readonly itemsList: Locator;
  readonly freeShippingSection: Locator;
  readonly freeShippingMessage: Locator;
  readonly freeShippingProgressBar: Locator;
  readonly addALittleExtraSection: Locator;
  readonly subtotalValue: Locator;
  readonly shippingValue: Locator;
  readonly gstValue: Locator;
  readonly totalValue: Locator;
  readonly viewCartButton: Locator;

  constructor(readonly page: Page) {
    this.header = page.locator('header');
    this.cartIcon = this.header.locator('a[href="/cart/"]').first();
    this.cartBadge = this.cartIcon.getByTestId('header-cart-badge');
    this.dialog = page.getByRole('dialog', { name: /Your Cart/i });
    this.closeButton = this.dialog.getByRole('button', { name: 'Close' });
    this.emptyHeading = this.dialog.getByText('Your bag is empty', { exact: true });
    this.startShoppingLink = this.dialog.getByRole('link', { name: 'Start shopping' });
    this.itemsList = this.dialog.locator('ul').first();
    this.freeShippingSection = this.dialog.locator('section[aria-label="Free shipping progress"]');
    this.freeShippingMessage = this.freeShippingSection.locator('p');
    this.freeShippingProgressBar = this.freeShippingSection.getByRole('progressbar');
    this.addALittleExtraSection = this.dialog.locator('section').filter({ hasText: 'Add a little extra' });
    this.subtotalValue = this.dialog.getByText('Subtotal (ex GST)', { exact: true }).locator('xpath=following-sibling::*[1]');
    this.shippingValue = this.dialog.getByText('Shipping (ex GST)', { exact: true }).locator('xpath=following-sibling::*[1]');
    this.gstValue = this.dialog.getByText('GST', { exact: true }).locator('xpath=following-sibling::*[1]');
    this.totalValue = this.dialog.getByText('Total', { exact: true }).locator('xpath=following-sibling::*[1]');
    this.viewCartButton = this.dialog.getByRole('link', { name: /view cart/i });
  }

  /**
   * Opens the flyout from the header cart icon. First click can land before hydration, so retry
   * until the dialog opens.
   */
  async openFromHeader() {
    await expect(async () => {
      if (!(await this.dialog.isVisible())) await this.cartIcon.click({ timeout: 5_000 });
      await expect(this.dialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    // The drawer slides in (CSS transition), so give it time to settle before reading layout.
    await this.page.waitForTimeout(400);
  }

  async close() {
    await expect(async () => {
      await this.closeButton.click({ timeout: 5_000 });
      await expect(this.dialog).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }

  /** The cart line item row for a given product name. */
  itemRow(productName: string) {
    return this.itemsList.locator('li').filter({ hasText: productName });
  }

  removeButton(productName: string) {
    return this.dialog.getByRole('button', { name: new RegExp(`^Remove ${escapeRegExp(productName)} from cart$`) });
  }

  quantityInput(productName: string) {
    return this.itemRow(productName).getByRole('spinbutton', { name: 'Quantity' });
  }

  increaseQtyButton(productName: string) {
    return this.itemRow(productName).getByRole('button', { name: 'Increase quantity' });
  }

  decreaseQtyButton(productName: string) {
    return this.itemRow(productName).getByRole('button', { name: 'Decrease quantity' });
  }

  /** The line's unit price badge - this does NOT scale with quantity, only the order summary does. */
  unitPrice(productName: string) {
    return this.itemRow(productName).getByText(/^\$\d+\.\d{2}$/);
  }

  /**
   * Moves a line's quantity stepper from `from` to `to` (one step). First click can land before
   * hydration, so retry until the input actually reflects the new value. Returns the
   * `cartSummary` the backend sent back with the update, so callers can assert against the exact
   * figures the UI is about to render instead of racing a separate `GET /api/cart/`.
   */
  async setQuantity(productName: string, from: string, to: string): Promise<BackendCart> {
    const button = Number(to) > Number(from) ? this.increaseQtyButton(productName) : this.decreaseQtyButton(productName);
    const input = this.quantityInput(productName);
    let summary!: BackendCart;
    await expect(async () => {
      const [response] = await Promise.all([
        this.page.waitForResponse((r) => r.url().endsWith('/api/cart/update/') && r.ok(), { timeout: 5_000 }),
        button.click({ timeout: 5_000 }),
      ]);
      summary = (await response.json()).cartSummary;
      await expect(input).toHaveValue(to, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    return summary;
  }

  /**
   * Removes a line item. First click can land before hydration, so retry until the row is gone.
   * Returns the backend's post-removal `cartSummary`.
   */
  async removeItem(productName: string): Promise<BackendCart> {
    const row = this.itemRow(productName);
    let summary!: BackendCart;
    await expect(async () => {
      const [response] = await Promise.all([
        this.page.waitForResponse((r) => r.url().endsWith('/api/cart/remove/') && r.ok(), { timeout: 5_000 }),
        this.removeButton(productName).click({ timeout: 5_000 }),
      ]);
      summary = (await response.json()).cartSummary;
      await expect(row).toHaveCount(0, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    return summary;
  }

  /** An "Add a little extra" upsell suggestion, by product name. */
  extraItem(productName: string) {
    return this.addALittleExtraSection.locator('li').filter({ hasText: productName });
  }

  extraItemPrice(productName: string) {
    return this.extraItem(productName).getByText(/^\$\d+\.\d{2}$/);
  }

  /**
   * Adds an "Add a little extra" suggestion to the cart. First click can land before hydration, so
   * retry until the product's own line item appears in the main list. Returns the backend's
   * post-add `cartSummary`.
   */
  async addExtraItem(productName: string): Promise<BackendCart> {
    const button = this.dialog.getByRole('button', { name: `Add ${productName} to cart` });
    let summary!: BackendCart;
    await expect(async () => {
      const [response] = await Promise.all([
        this.page.waitForResponse((r) => r.url().endsWith('/api/cart/add/') && r.ok(), { timeout: 5_000 }),
        button.click({ timeout: 5_000 }),
      ]);
      summary = (await response.json()).cartSummary;
      await expect(this.itemRow(productName)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    return summary;
  }

  /**
   * Reads an "Add a little extra" suggestion row's name (from its image alt text, not its
   * mixed-content text) and price in one DOM evaluation. The suggestions panel re-renders after
   * every cart mutation, so two separate round-trip reads (name, then a later price lookup keyed
   * on that name) can straddle a re-render and end up describing two different products; reading
   * both atomically off the same element avoids that.
   */
  async extraItemInfo(row: Locator): Promise<{ name: string; price: number }> {
    return row.evaluate((el) => {
      const name = el.querySelector('img')?.getAttribute('alt') ?? '';
      const priceMatch = el.textContent?.match(/\$\d+\.\d{2}/);
      return { name, price: priceMatch ? parseFloat(priceMatch[0].slice(1)) : NaN };
    });
  }

  /**
   * Same as `extraItemInfo`, but polls until two reads a moment apart agree. The suggestion's name
   * and price appear to be populated by independent updates (e.g. name from an immediately
   * available props list, price from a slightly-lagging per-item lookup), so a single read can
   * observe a transiently mismatched pair - most visibly right after a string of cart mutations.
   */
  async extraItemInfoStable(row: Locator): Promise<{ name: string; price: number }> {
    let previous = await this.extraItemInfo(row);
    for (let i = 0; i < 10; i++) {
      await this.page.waitForTimeout(150);
      const current = await this.extraItemInfo(row);
      if (current.name === previous.name && current.price === previous.price) return current;
      previous = current;
    }
    return previous;
  }
}
