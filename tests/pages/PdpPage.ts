import { Locator, Page, expect } from '@playwright/test';

/** Product Detail Page, e.g. /product/boston-distressed-denim-bib-apron-light-blue/ */
export class PdpPage {
  readonly main: Locator;
  readonly heading: Locator;
  readonly breadcrumb: Locator;
  readonly wishlistButton: Locator;
  readonly reviewsButton: Locator;
  readonly colourSwatches: Locator;
  readonly quantity: Locator;
  readonly increaseQty: Locator;
  readonly decreaseQty: Locator;
  readonly sizeGuideButton: Locator;
  readonly sizeGuideDialog: Locator;
  readonly addToBagButton: Locator;
  readonly addEmbroideryButton: Locator;
  readonly embroideryDialog: Locator;
  readonly imageViewerDialog: Locator;
  readonly footer: Locator;
  readonly cartDialog: Locator;
  readonly orderTab: Locator;
  readonly orderMultipleTab: Locator;
  readonly addAllToCartButton: Locator;
  readonly strapSelect: Locator;

  constructor(readonly page: Page) {
    this.main = page.locator('main');
    this.heading = page.getByRole('heading', { level: 1 });
    this.breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    // The "More Great Wears" / "As seen on our crews" recommendations grid reuses the PLP card
    // component (an <article> per item), each with its own "Add ... to wishlist" button, so a
    // plain role lookup across the whole page matches dozens of unrelated cards. Scoping out
    // anything inside an <article> isolates this product's own wishlist button.
    this.wishlistButton = this.main.getByRole('button', { name: /to wishlist$/ }).and(page.locator(':not(article *)'));
    this.reviewsButton = this.main.getByRole('button', { name: /reviews$/i });
    this.colourSwatches = page.getByRole('list', { name: 'Choose Colour' });
    this.quantity = this.main.getByRole('spinbutton', { name: 'Quantity', exact: true });
    this.increaseQty = this.main.getByRole('button', { name: 'Increase quantity' }).first();
    this.decreaseQty = this.main.getByRole('button', { name: 'Decrease quantity' }).first();
    this.sizeGuideButton = this.main.getByRole('button', { name: 'Size Guide' });
    this.sizeGuideDialog = page.getByRole('dialog', { name: 'Size Guide' });
    this.addToBagButton = this.main.getByRole('button', { name: 'Add to Bag' });
    this.addEmbroideryButton = this.main.getByRole('button', { name: 'Add Embroidery' });
    this.embroideryDialog = page.getByRole('dialog', { name: 'Make it your own.' });
    this.imageViewerDialog = page.getByRole('dialog', { name: 'Product image viewer' });
    this.footer = page.locator('contentinfo, footer');
    this.cartDialog = page.getByRole('dialog', { name: /Your Cart/i });
    this.orderTab = page.getByRole('tab', { name: 'Order', exact: true });
    this.orderMultipleTab = page.getByRole('tab', { name: 'Order Multiple' });
    this.addAllToCartButton = this.main.getByRole('button', { name: 'Add All to Cart' });
    // Some aprons (e.g. Tom Bib Apron) offer changeable/adjustable straps as their own "Choose your
    // strap" <select>, separate from colour. Scoped to role=combobox, not a plain getByLabel: one
    // of this product's own gallery images is captioned "Choose Your Strap Range", whose
    // aria-label also matches "choose your strap" and would otherwise collide in strict mode.
    this.strapSelect = page.getByRole('combobox', { name: /choose your strap/i });
  }

  /** Enlarge buttons for the main gallery thumbnails/images. */
  galleryEnlargeButtons() {
    return this.main.getByRole('button', { name: /enlarged$/ });
  }

  /** Accordion section, e.g. "Description", "Garment care", "Logo Embroidery", "Name embroidery". */
  accordion(name: string) {
    const heading = this.main.getByRole('heading', { name });
    return { heading, toggle: heading.getByRole('button', { name }) };
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
    await expect(this.main).toContainText(/\$\d+(\.\d{2})?/);
  }

  /** Asserts every enlargeable gallery image has alt text and has actually finished loading. */
  async expectGalleryImagesLoaded() {
    const images = this.galleryEnlargeButtons().locator('img');
    const count = await images.count();
    expect.soft(count, 'expected at least one product image').toBeGreaterThan(0);
    for (const img of await images.all()) {
      await expect.soft(img).toHaveAttribute('alt', /.+/);
      await expect
        .soft.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
        .toBe(true);
    }
  }

  /**
   * First click can land before hydration, so retry until the dialog opens. Bounded, rather than
   * left to retry for the rest of the test's time budget - if "Add to Bag" never opens the cart
   * after repeated clicks, that's a real failure (e.g. a slow/failed add-to-cart request) that
   * should surface quickly, not swallow 5 minutes of an unrelated test.
   */
  private async openDialog(button: Locator, dialog: Locator) {
    await expect(async () => {
      if (!(await dialog.isVisible())) await button.click({ timeout: 5_000 });
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    // The dialog slides in (CSS transition, duration-300), so give it time to settle before
    // anything (e.g. a boundingBox check) reads its layout mid-animation.
    await this.page.waitForTimeout(400);
  }

  async openSizeGuide() {
    await this.openDialog(this.sizeGuideButton, this.sizeGuideDialog);
  }

  async openEmbroideryModal() {
    await this.openDialog(this.addEmbroideryButton, this.embroideryDialog);
  }

  /** Elements on the "Add Embroidery" modal's "Name Embroidery" tab. */
  nameEmbroidery() {
    const dialog = this.embroideryDialog;
    return {
      tab: dialog.getByRole('tab', { name: /Name Embroidery/ }),
      nameField: dialog.getByRole('textbox', { name: 'Add a name' }),
      resetButton: dialog.getByRole('button', { name: 'Reset' }),
      threadColour: (name: string) => dialog.getByRole('radiogroup', { name: 'Thread colour' }).getByRole('radio', { name, exact: true }),
      fontSelect: dialog.getByRole('combobox', { name: /choose font/i }),
      totalPrice: dialog.getByText(/^\$\d+\.\d{2}$/),
      validationMessage: dialog.getByText('Add a name first.'),
      addToBagButton: dialog.getByRole('button', { name: 'Add to Bag' }),
    };
  }

  /**
   * Clicks an embroidery modal "Add to Bag"/"Continue" button. Unlike the main PDP's button, these
   * can legitimately fail to open the cart or advance (e.g. clicking Name Embroidery's Add to Bag
   * with no name entered), so the caller decides what that means - this just performs a single
   * bounded-retry click.
   */
  async submitEmbroideryModal(button: Locator = this.nameEmbroidery().addToBagButton) {
    await expect(async () => {
      await button.click({ timeout: 5_000 });
    }).toPass({ timeout: 10_000 });
    await this.page.waitForTimeout(500);
  }

  /**
   * Elements on the "Add Embroidery" modal's "Logo Embroidery" tab, step 1 ("Artwork & file").
   * `artworkSelect` and `postPurchaseCheckboxLabel` only exist on this step; once "Continue" is
   * clicked the panel is replaced by step 2's elements (see `logoEmbroideryStep2`).
   */
  logoEmbroidery() {
    const dialog = this.embroideryDialog;
    return {
      tab: dialog.getByRole('tab', { name: /Logo Embroidery/ }),
      artworkSelect: dialog.getByRole('combobox'),
      // The underlying <input type="checkbox"> is visually hidden (sr-only, styled via its label),
      // so it must be checked by clicking the label text, not the input itself.
      postPurchaseCheckboxLabel: dialog.getByText('I will email my logo post-purchase'),
      postPurchaseCheckbox: dialog.getByRole('checkbox'),
      continueButton: dialog.getByRole('button', { name: 'Continue' }),
    };
  }

  /** Elements on the Logo Embroidery tab's step 2 ("Placement & quantity"), after "Continue". */
  logoEmbroideryStep2() {
    const dialog = this.embroideryDialog;
    return {
      locationSelect: dialog.getByRole('combobox'),
      quantity: dialog.getByRole('spinbutton', { name: 'Logo quantity' }),
      totalPrice: dialog.getByText(/^\$\d+\.\d{2}$/),
      addToBagButton: dialog.getByRole('button', { name: 'Add to Bag' }),
    };
  }

  /**
   * Picks the first real size if this product requires one before it can be added to the bag
   * (e.g. shirts). A no-op for products without a size selector (e.g. most aprons).
   */
  async selectSizeIfRequired() {
    const sizeSelect = this.page.getByRole('combobox', { name: /select size/i });
    if (await sizeSelect.count()) await sizeSelect.selectOption({ index: 1 });
  }

  async addToBag() {
    await this.selectSizeIfRequired();
    await this.openDialog(this.addToBagButton, this.cartDialog);
  }

  async openImageViewer() {
    await this.openDialog(this.galleryEnlargeButtons().first(), this.imageViewerDialog);
  }

  async addAllToCart() {
    await this.openDialog(this.addAllToCartButton, this.cartDialog);
  }

  /** First click can land before hydration, so retry until the tab actually becomes selected. */
  async selectTab(tab: Locator) {
    await expect(async () => {
      await tab.click({ timeout: 5_000 });
      await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }

  /** One per-size quantity field on the "Order Multiple" tab, e.g. "Quantity for size 32". */
  orderMultipleRows() {
    return this.main.getByRole('spinbutton', { name: /^Quantity for size /i });
  }

  /**
   * Increases the Nth "Order Multiple" row's quantity by one. First click can land before
   * hydration, so retry until the value actually changes.
   */
  async increaseOrderMultipleQuantity(index: number) {
    const quantity = this.orderMultipleRows().nth(index);
    const increase = this.main.getByRole('button', { name: 'Increase quantity' }).nth(index);
    await expect(async () => {
      await increase.click({ timeout: 5_000 });
      await expect(quantity).not.toHaveValue('0', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }

  /** This product's own "remove from wishlist" button - see the comment on `wishlistButton`. */
  private get wishlistRemoveButton() {
    return this.main.getByRole('button', { name: /from wishlist$/ }).and(this.page.locator(':not(article *)'));
  }

  /** First click can land before hydration, so retry until the pressed state actually flips. */
  async toggleWishlist(pressedAfter: 'true' | 'false') {
    const button = pressedAfter === 'true' ? this.wishlistButton : this.wishlistRemoveButton;
    await expect(async () => {
      await button.click({ timeout: 5_000 });
      await expect(pressedAfter === 'true' ? this.wishlistRemoveButton : this.wishlistButton).toHaveAttribute(
        'aria-pressed',
        pressedAfter,
        { timeout: 2_000 },
      );
    }).toPass({ timeout: 20_000 });
  }

  /** First click can land before hydration, so retry until the value actually changes. */
  async setQuantity(from: string, to: string) {
    const button = to > from ? this.increaseQty : this.decreaseQty;
    await expect(async () => {
      await button.click({ timeout: 5_000 });
      await expect(this.quantity).toHaveValue(to, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }

  /**
   * First click can land before hydration, so retry until the expanded state actually flips. The
   * panel's expand/collapse is an animated height transition, so other elements below it (e.g. a
   * size selector further down the page) keep shifting position for a moment after the attribute
   * flips - settle before anything else interacts with the page.
   */
  async toggleAccordion(name: string, expandedAfter: 'true' | 'false') {
    const { toggle } = this.accordion(name);
    await expect(async () => {
      await toggle.click({ timeout: 5_000 });
      await expect(toggle).toHaveAttribute('aria-expanded', expandedAfter, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await this.page.waitForTimeout(350);
  }

  /**
   * The cart drawer's Close button can stay unstable for a few seconds while recommended
   * products ("Add a little extra") finish loading and shift layout, so a bare click() can hang
   * on Playwright's built-in actionability retry (which has no timeout of its own) for the rest
   * of the test's budget. Bound it and retry the click instead.
   */
  async closeCartDialog() {
    await expect(async () => {
      await this.cartDialog.getByRole('button', { name: 'Close' }).click({ timeout: 5_000 });
      await expect(this.cartDialog).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }
}
