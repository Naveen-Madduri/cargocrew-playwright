import { Frame, Locator, Page, expect } from '@playwright/test';

/** Escapes a string for safe use inside a `new RegExp(...)`. */
function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Checkout flow, i.e. '/checkout/' (Details step, then Payment step). */
export class CheckoutPage {
  readonly header: Locator;
  readonly logoLink: Locator;
  readonly secureCheckoutBadge: Locator;
  readonly breadcrumbNav: Locator;
  readonly cartBreadcrumbLink: Locator;
  readonly validationBanner: Locator;
  readonly loginLink: Locator;
  readonly emailInput: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly companyInput: Locator;
  readonly countrySelect: Locator;
  readonly addressInput: Locator;
  readonly addressListbox: Locator;
  readonly suburbInput: Locator;
  readonly stateSelect: Locator;
  readonly postcodeInput: Locator;
  readonly phoneInput: Locator;
  readonly deliveryNotesInput: Locator;
  readonly returnToCartLink: Locator;
  readonly continueToPaymentButton: Locator;
  readonly itemsList: Locator;
  readonly subtotalValue: Locator;
  readonly shippingValue: Locator;
  readonly gstValue: Locator;
  readonly totalValue: Locator;
  readonly termsCheckbox: Locator;
  readonly completePurchaseButton: Locator;
  readonly billingSameRadio: Locator;
  readonly billingDifferentRadio: Locator;
  readonly billingFirstNameInput: Locator;
  readonly billingLastNameInput: Locator;
  readonly billingCountrySelect: Locator;
  readonly billingAddressInput: Locator;
  readonly billingAddressListbox: Locator;
  readonly billingSuburbInput: Locator;
  readonly billingStateSelect: Locator;
  readonly billingPostcodeInput: Locator;

  constructor(readonly page: Page) {
    this.header = page.locator('header');
    // The header and breadcrumb are each duplicated for mobile (hidden on desktop), so every
    // lookup here resolves to whichever copy is actually visible at the current viewport.
    this.logoLink = this.header.getByRole('link', { name: 'Cargo Crew' }).filter({ visible: true });
    this.secureCheckoutBadge = this.header.getByText('Secure checkout').filter({ visible: true });
    this.breadcrumbNav = page.getByRole('navigation', { name: 'Checkout steps' }).filter({ visible: true });
    this.cartBreadcrumbLink = this.breadcrumbNav.getByRole('link', { name: 'Cart' });
    this.validationBanner = page.getByText('Check the highlighted fields before continuing.');
    this.loginLink = page.getByRole('link', { name: 'Log in' });
    this.emailInput = page.getByLabel('Email address', { exact: true });
    this.firstNameInput = page.getByLabel('First name', { exact: true });
    this.lastNameInput = page.getByLabel('Last name', { exact: true });
    this.companyInput = page.getByLabel('Company (optional)', { exact: true });
    this.countrySelect = page.getByLabel('Country', { exact: true });
    this.addressInput = page.getByLabel('Address', { exact: true });
    this.addressListbox = page.locator('#checkout-address-listbox');
    // AU labels these "Suburb" / "State" / "Postcode"; NZ relabels them "City" / "Region" / "Postal code".
    this.suburbInput = page.getByLabel(/^(suburb|city)$/i);
    this.stateSelect = page.getByLabel(/^(state|region)$/i);
    this.postcodeInput = page.getByLabel(/^(postcode|postal code)$/i);
    this.phoneInput = page.getByLabel(/phone/i, { exact: false });
    this.deliveryNotesInput = page.getByLabel('Delivery notes (optional)', { exact: true });
    this.returnToCartLink = page.getByRole('link', { name: /return to cart/i });
    this.continueToPaymentButton = page.getByRole('link', { name: /continue to payment/i }).or(page.getByRole('button', { name: /continue to payment/i }));
    this.itemsList = page.locator('ul').filter({ visible: true }).first();
    // The mobile order-summary accordion duplicates this whole block (hidden on desktop) - scope to
    // whichever copy is actually visible at the current viewport.
    this.subtotalValue = page.getByText('Subtotal (ex GST)', { exact: true }).filter({ visible: true }).locator('xpath=following-sibling::*[1]');
    this.shippingValue = page.getByText('Shipping (ex GST)', { exact: true }).filter({ visible: true }).locator('xpath=following-sibling::*[1]');
    this.gstValue = page.getByText('GST', { exact: true }).filter({ visible: true }).locator('xpath=following-sibling::*[1]');
    this.totalValue = page.getByText('Total', { exact: true }).filter({ visible: true }).locator('xpath=following-sibling::*[1]');
    this.termsCheckbox = page.getByRole('checkbox', { name: /accept the terms/i });
    this.completePurchaseButton = page.getByRole('button', { name: /complete purchase/i });
    this.billingSameRadio = page.getByText('Same as shipping address', { exact: true });
    this.billingDifferentRadio = page.getByText('Use a different billing address', { exact: true });
    this.billingFirstNameInput = page.locator('#billing-first-name');
    this.billingLastNameInput = page.locator('#billing-last-name');
    this.billingCountrySelect = page.locator('#billing-country');
    this.billingAddressInput = page.locator('#billing-address-line');
    this.billingAddressListbox = page.locator('#billing-address-line-listbox');
    this.billingSuburbInput = page.locator('#billing-city');
    this.billingStateSelect = page.locator('#billing-state');
    this.billingPostcodeInput = page.locator('#billing-postcode');
  }

  /** The cart line item row for a given product name, in the Order Summary. */
  itemRow(productName: string) {
    return this.itemsList.locator('li').filter({ hasText: productName });
  }

  itemPrice(productName: string) {
    return this.itemRow(productName).getByText(/^\$\d+\.\d{2}$/);
  }

  /** The error message (role="alert") associated with a field via its `aria-describedby`. */
  async fieldError(input: Locator): Promise<Locator> {
    const id = await input.getAttribute('aria-describedby');
    return id ? this.page.locator(`#${id}`) : this.page.locator('nope-no-such-id');
  }

  /**
   * Fills the Details step: contact, name and a delivery address picked from the Google Places
   * autocomplete dropdown (typing alone doesn't populate suburb/state/postcode - a suggestion
   * must be selected), then continues to the Payment step.
   */
  async fillDetails({
    email,
    firstName,
    lastName,
    addressQuery,
    phone,
    shippingMethod = 'Aust Post - Parcel Post',
  }: {
    email: string;
    firstName: string;
    lastName: string;
    addressQuery: string;
    phone: string;
    shippingMethod?: string;
  }) {
    await this.emailInput.fill(email);
    await this.firstNameInput.fill(firstName);
    await this.lastNameInput.fill(lastName);

    await this.pickAddressSuggestion(addressQuery);

    const phoneInput = this.phoneInput;
    await phoneInput.fill(phone);

    await this.selectShippingMethod(shippingMethod);

    // A hydration error observed on this step (see selectShippingMethod's comment) can wipe an
    // already-filled field when the page recovers from it, so re-check right before submitting.
    if ((await phoneInput.inputValue()) !== phone) await phoneInput.fill(phone);

    // First click can land before hydration, so retry until it navigates.
    await expect(async () => {
      if ((await phoneInput.inputValue()) !== phone) await phoneInput.fill(phone);
      await this.continueToPaymentButton.click({ timeout: 5_000 });
      await expect(this.page).toHaveURL(/step=payment/, { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
  }

  /**
   * Types into the Address field and selects the first Google Places suggestion - the only way to
   * populate suburb/state/postcode; typing alone never does.
   */
  async pickAddressSuggestion(addressQuery: string) {
    // Retries the whole type-and-wait cycle: the Places Autocomplete session can occasionally be
    // slow to (re-)initialise, e.g. right after switching country, so a single attempt's 10s wait
    // for a suggestion can time out even though retyping shortly after succeeds quickly.
    await expect(async () => {
      await this.addressInput.click();
      await this.addressInput.fill('');
      await this.addressInput.pressSequentially(addressQuery, { delay: 60 });
      await expect(this.addressListbox.getByRole('option').first()).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 30_000 });
    await this.addressListbox.getByRole('option').first().click();
  }

  /**
   * Shipping rates load async after the address is picked, so the radio starts `disabled`. The
   * radio input itself is visually hidden (sr-only) behind a styled span that intercepts pointer
   * events, so a plain/forced click lands on the span and never fires the input's change handler -
   * dispatching the click event directly on the input is what actually flips its checked state.
   *
   * Not scoped to `<main>`: a React hydration error (minified error #418) has been observed on
   * this step, which can leave `<main>` itself missing from the DOM even though its content -
   * including this radio - is still present and functional. Querying from `page` instead of
   * `this.main` keeps this working whether or not that hydration error fires.
   */
  async selectShippingMethod(name: string) {
    const radio = this.page.getByRole('radio', { name: new RegExp(escapeRegExp(name)) });
    await expect(async () => {
      expect(await radio.count()).toBe(1);
      expect(await radio.isDisabled()).toBe(false);
    }).toPass({ timeout: 60_000 });
    await radio.dispatchEvent('click');
    await expect(radio).toBeChecked();
  }

  /** A Payment-step summary row ("Contact" / "Ship to" / "Method"), with its value and "Change" link. */
  paymentSummaryRow(label: 'Contact' | 'Ship to' | 'Method') {
    const row = this.page.getByText(label, { exact: true }).locator('xpath=..');
    return {
      row,
      value: row.locator('span.min-w-0'),
      changeLink: row.getByRole('link', { name: 'Change' }),
    };
  }

  /**
   * Finds the Stripe-hosted iframe holding the card fields. Its frame id/name changes per page
   * load, and it's one of many js.stripe.com frames (Link, Google/Apple Pay, hCaptcha, ...), so
   * every frame has to be checked for the actual input rather than matched by name/URL shape.
   */
  private async cardFrame(): Promise<Frame> {
    let found: Frame | undefined;
    await expect(async () => {
      found = undefined;
      for (const f of this.page.frames()) {
        if (!f.url().includes('js.stripe.com')) continue;
        if (await f.locator('input[name="number"]').count().catch(() => 0)) {
          found = f;
          break;
        }
      }
      expect(found, 'Stripe card frame not found yet').toBeTruthy();
    }).toPass({ timeout: 20_000 });
    return found!;
  }

  /** Fills the Payment step's card fields and accepts the terms, ready for `completePurchase()`. */
  async fillCardPayment({ number, expiry, cvc }: { number: string; expiry: string; cvc: string }) {
    // The underlying checkbox is visually hidden (sr-only), so it must be checked via its label text.
    await this.page.getByText('I accept the terms and agree to be bound by them').click();
    await expect(this.termsCheckbox).toBeChecked();

    const frame = await this.cardFrame();
    await frame.locator('input[name="number"]').fill(number);
    await frame.locator('input[name="expiry"]').fill(expiry);
    await frame.locator('input[name="cvc"]').fill(cvc);
  }

  async completePurchase() {
    await this.completePurchaseButton.click();
  }
}
