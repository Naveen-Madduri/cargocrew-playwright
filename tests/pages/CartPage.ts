import { Locator, Page, expect } from '@playwright/test';
import { open } from '../helpers/site';

/** Cart page, i.e. '/cart/'. */
export class CartPage {
  readonly main: Locator;
  readonly orderSummary: Locator;
  readonly header: Locator;
  readonly continueShoppingLink: Locator;
  readonly itemCountText: Locator;
  readonly clearCartButton: Locator;
  readonly clearCartConfirmPanel: Locator;
  readonly clearCartCancelButton: Locator;
  readonly clearCartConfirmButton: Locator;
  readonly emptyHeading: Locator;
  readonly startShoppingLink: Locator;
  readonly itemsList: Locator;
  readonly freeShippingSection: Locator;
  readonly freeShippingMessage: Locator;
  readonly freeShippingProgressBar: Locator;
  readonly addALittleExtraSection: Locator;
  readonly shippingCountrySelect: Locator;
  readonly stateRegionInput: Locator;
  readonly postcodeInput: Locator;
  readonly deliveryOptionsPrompt: Locator;
  readonly discountToggle: Locator;
  readonly discountInput: Locator;
  readonly discountApplyButton: Locator;
  readonly discountError: Locator;
  readonly subtotalValue: Locator;
  readonly shippingValue: Locator;
  readonly gstValue: Locator;
  readonly totalValue: Locator;
  readonly checkoutSecurelyLink: Locator;
  readonly embroideryDialog: Locator;

  constructor(readonly page: Page) {
    this.main = page.locator('main');
    // Scopes everything in the "Order Summary" panel (shipping/country/discount/totals) away from
    // the item list, which also contains its own per-line "Total" column header etc. with the same
    // exact text.
    this.orderSummary = this.main.locator('aside[aria-labelledby="order-summary-heading"]');
    this.header = page.locator('header');
    this.continueShoppingLink = this.header.getByRole('link', { name: /continue shopping/i });
    this.itemCountText = this.main.getByText(/^\d+ items?$/);
    this.clearCartButton = this.main.getByRole('button', { name: 'Clear cart' });
    this.clearCartConfirmPanel = page.locator('#cart-clear-confirm');
    this.clearCartCancelButton = this.clearCartConfirmPanel.getByRole('button', { name: 'Cancel' });
    this.clearCartConfirmButton = this.clearCartConfirmPanel.getByRole('button', { name: 'Yes, clear cart' });
    this.emptyHeading = this.main.getByText('Your bag is empty', { exact: true });
    this.startShoppingLink = this.main.getByRole('link', { name: 'Start shopping' });
    this.itemsList = this.main.locator('ul').first();
    this.freeShippingSection = this.main.locator('section[aria-label="Free shipping progress"]');
    this.freeShippingMessage = this.freeShippingSection.locator('p');
    this.freeShippingProgressBar = this.freeShippingSection.getByRole('progressbar');
    this.addALittleExtraSection = this.main.locator('section').filter({ hasText: 'Add a little extra' });
    this.shippingCountrySelect = this.orderSummary.locator('#shipping-country');
    this.stateRegionInput = this.orderSummary.getByLabel(/state\s*\/\s*region/i);
    this.postcodeInput = this.orderSummary.getByLabel(/postcode/i);
    this.deliveryOptionsPrompt = this.orderSummary.getByText('Enter your state/region and postcode to see delivery options.');
    this.discountToggle = this.orderSummary.getByRole('button', { name: 'Apply discount code' });
    this.discountInput = this.orderSummary.getByPlaceholder(/promo code/i);
    this.discountApplyButton = this.orderSummary.getByRole('button', { name: 'Apply', exact: true });
    this.discountError = this.orderSummary.getByText("That promo code isn't recognised.");
    this.subtotalValue = this.orderSummary.getByText('Subtotal (ex GST)', { exact: true }).locator('xpath=following-sibling::*[1]');
    this.shippingValue = this.orderSummary.getByText('Shipping (ex GST)', { exact: true }).locator('xpath=following-sibling::*[1]');
    this.gstValue = this.orderSummary.getByText('GST', { exact: true }).locator('xpath=following-sibling::*[1]');
    this.totalValue = this.orderSummary.getByText('Total', { exact: true }).locator('xpath=following-sibling::*[1]');
    this.checkoutSecurelyLink = this.main.getByRole('link', { name: /checkout securely/i });
    this.embroideryDialog = page.getByRole('dialog', { name: 'Make it your own.' });
  }

  async goto() {
    await open(this.page, '/cart/');
    await expect(this.page.getByRole('heading', { name: 'Your Cart' })).toBeVisible();
  }

  /** Any Order Summary row's value, by its exact label - e.g. "Subtotal" and "GST" vanish/simplify for a country (NZ) with no GST line. */
  summaryValue(label: string) {
    return this.orderSummary.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]');
  }

  /** The cart line item row for a given product name. */
  itemRow(productName: string) {
    return this.itemsList.locator('li').filter({ hasText: productName });
  }

  removeButton(productName: string) {
    return this.itemRow(productName)
      .getByRole('button', { name: new RegExp(`^Remove ${escapeRegExp(productName)} from cart$`) })
      .filter({ visible: true });
  }

  /** Quantity/stepper controls are duplicated (a mobile-inline copy and a desktop-column copy); resolve to whichever is actually rendered. */
  quantityInput(productName: string) {
    return this.itemRow(productName).getByRole('spinbutton', { name: 'Quantity' }).filter({ visible: true });
  }

  increaseQtyButton(productName: string) {
    return this.itemRow(productName).getByRole('button', { name: 'Increase quantity' }).filter({ visible: true });
  }

  decreaseQtyButton(productName: string) {
    return this.itemRow(productName).getByRole('button', { name: 'Decrease quantity' }).filter({ visible: true });
  }

  /** The "Price (inc GST)" unit price shown on a line item - the desktop column, not the mobile summary. */
  itemUnitPrice(productName: string) {
    return this.itemRow(productName).getByText('Price (inc GST)', { exact: true }).locator('xpath=following-sibling::span[1]');
  }

  /** The line item's own "Total" (unit price x quantity), as opposed to the cart-wide Order Summary total. */
  itemTotal(productName: string) {
    return this.itemRow(productName).getByText('Total', { exact: true }).locator('xpath=following-sibling::span[1]');
  }

  addEmbroideryButton(productName: string) {
    return this.itemRow(productName).getByRole('button', { name: 'Add embroidery' });
  }

  /** Once embroidery has been added, its own "Edit" control (replacing "Add embroidery"). */
  editEmbroideryButton(productName: string) {
    return this.itemRow(productName).getByRole('button', { name: 'Edit' }).filter({ visible: true });
  }

  /**
   * The Name/Font/Thread summary block shown once embroidery has been saved to a line. "Name:",
   * "Font:" and "Thread:" are each their own sibling <p>, so this resolves to their shared parent
   * rather than just the "Name:" paragraph itself.
   */
  embroideryDetails(productName: string) {
    return this.itemRow(productName)
      .getByText(/^Name:/)
      .filter({ visible: true })
      .locator('xpath=..');
  }

  /** Elements on the embroidery dialog's "Name Embroidery" tab (shared shape with the PDP's dialog, but "Save to item" instead of "Add to Bag"). */
  nameEmbroidery() {
    const dialog = this.embroideryDialog;
    return {
      tab: dialog.getByRole('tab', { name: /Name Embroidery/ }),
      nameField: dialog.getByRole('textbox', { name: 'Add a name' }),
      fontSelect: dialog.getByRole('combobox', { name: /choose font/i }),
      resetButton: dialog.getByRole('button', { name: 'Reset' }),
      totalPrice: dialog.getByText(/^\$\d+\.\d{2}$/),
      saveButton: dialog.getByRole('button', { name: /save to item/i }),
    };
  }

  /**
   * Opens the "Add embroidery" (or "Edit") dialog for a line and fills + saves a name. Explicitly
   * selects the "BLOCK" font: the dialog does not always default to it (it can retain whatever font
   * was last picked), so callers that assert on the saved font need a deterministic choice.
   */
  async addNameEmbroidery(productName: string, name: string) {
    const button = (await this.editEmbroideryButton(productName).count()) ? this.editEmbroideryButton(productName) : this.addEmbroideryButton(productName);
    await expect(async () => {
      if (!(await this.embroideryDialog.isVisible())) await button.click({ timeout: 5_000 });
      await expect(this.embroideryDialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    const { nameField, fontSelect, saveButton } = this.nameEmbroidery();
    await nameField.fill(name);
    await fontSelect.selectOption({ label: 'BLOCK (UPPERCASE only)' });
    // Match on the URL only, not `.ok()` - see the same note on `applyDiscountCode`/`selectCountry`;
    // this endpoint has likewise been observed to respond non-2xx in at least one run.
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.url().endsWith('/api/cart/embroidery/'), { timeout: 10_000 }),
      saveButton.click({ timeout: 5_000 }),
    ]);
    await expect(this.embroideryDialog).toBeHidden({ timeout: 10_000 });
    return response.json();
  }

  /** An "Add a little extra" upsell suggestion, by product name. */
  extraItem(productName: string) {
    return this.addALittleExtraSection.locator('li').filter({ hasText: productName });
  }

  extraItemPrice(productName: string) {
    return this.extraItem(productName).getByText(/^\$\d+\.\d{2}$/);
  }

  /** Adds an "Add a little extra" suggestion. First click can land before hydration, so retry until the line appears. */
  async addExtraItem(productName: string) {
    const button = this.main.getByRole('button', { name: `Add ${productName} to cart` });
    await expect(async () => {
      const [response] = await Promise.all([
        this.page.waitForResponse((r) => r.url().endsWith('/api/cart/add/') && r.ok(), { timeout: 5_000 }),
        button.click({ timeout: 5_000 }),
      ]);
      await expect(this.itemRow(productName)).toBeVisible({ timeout: 2_000 });
      return response;
    }).toPass({ timeout: 20_000 });
  }

  /** Removes a line item. First click can land before hydration, so retry until the row is gone. */
  async removeItem(productName: string) {
    const row = this.itemRow(productName);
    await expect(async () => {
      await this.removeButton(productName).click({ timeout: 5_000 });
      await expect(row).toHaveCount(0, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }

  /**
   * Moves a line's quantity stepper from `from` to `to` (one step). Waits for both the stepper
   * input and the line's own "Total" column to reflect the new quantity - the two can briefly
   * disagree right after the update response lands, since they re-render independently.
   */
  async setQuantity(productName: string, from: string, to: string) {
    const button = Number(to) > Number(from) ? this.increaseQtyButton(productName) : this.decreaseQtyButton(productName);
    const input = this.quantityInput(productName);
    await expect(async () => {
      const [response] = await Promise.all([
        this.page.waitForResponse((r) => r.url().endsWith('/api/cart/update/') && r.ok(), { timeout: 5_000 }),
        button.click({ timeout: 5_000 }),
      ]);
      await expect(input).toHaveValue(to, { timeout: 2_000 });

      const body = await response.json();
      const line = body.cartSummary?.cartItems?.find((i: { title: string }) => i.title === productName);
      if (line) await expect(this.itemTotal(productName)).toHaveText(`$${line.totalPrice.amount.toFixed(2)}`, { timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
  }

  /** "Clear cart" -> "Yes, clear cart". First click can land before hydration, so retry until the confirm panel opens. */
  async clearCart() {
    await expect(async () => {
      if (!(await this.clearCartConfirmPanel.isVisible())) await this.clearCartButton.click({ timeout: 5_000 });
      await expect(this.clearCartConfirmPanel).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(async () => {
      await this.clearCartConfirmButton.click({ timeout: 5_000 });
      await expect(this.emptyHeading).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
  }

  shippingMethodRadio(name: string) {
    return this.orderSummary.getByRole('radio', { name: new RegExp(escapeRegExp(name)) });
  }

  /**
   * Selects a shipping method, waiting for the resulting `/api/cart/shipping` request to settle.
   * Uses a plain click rather than `.check()`: the radio's checked state appears to be fully
   * controlled by the app rather than toggled natively on click, which makes Playwright's `.check()`
   * (which verifies the native `checked` property flipped) report "did not change its state" even
   * though the click's own request/response round-trip completes correctly.
   */
  async selectShippingMethod(name: string) {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.url().endsWith('/api/cart/shipping/'), { timeout: 10_000 }),
      this.shippingMethodRadio(name).click({ timeout: 5_000 }),
    ]);
    return response;
  }

  /**
   * Switches the "Shipping to" country, waiting for the page to re-render for the new country.
   * Reverting away from NZ after an unquotable address can apparently respond non-2xx - match on
   * the URL only, not `.ok()` (see the same note on `applyDiscountCode`).
   */
  async selectCountry(code: 'AU' | 'NZ') {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.url().endsWith('/api/cart/shipping/'), { timeout: 10_000 }),
      this.shippingCountrySelect.selectOption(code),
    ]);
    return response;
  }

  async applyDiscountCode(code: string) {
    await expect(async () => {
      if (!(await this.discountInput.isVisible())) await this.discountToggle.click({ timeout: 5_000 });
      await expect(this.discountInput).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    await this.discountInput.fill(code);
    await expect(async () => {
      // An unrecognised code legitimately responds 400, not 2xx - match on the URL only, not `.ok()`.
      await Promise.all([
        this.page.waitForResponse((r) => r.url().endsWith('/api/cart/discount/'), { timeout: 5_000 }),
        this.discountApplyButton.click({ timeout: 5_000 }),
      ]);
    }).toPass({ timeout: 20_000 });
  }
}

/** Escapes a string for safe use inside a `new RegExp(...)`. */
function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
