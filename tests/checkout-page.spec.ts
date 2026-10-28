import { test, expect } from '@playwright/test';
import { HomePage } from './pages/HomePage';
import { PdpPage } from './pages/PdpPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { open } from './helpers/site';
import { parsePrice, fetchCart, clearCart, BackendCart } from './helpers/price';
import { knownBug } from './helpers/known-bug';

/**
 * End-to-end Checkout (Details + Payment steps) validation, as a single scenario rather than
 * independent tests, so each stage builds on the state left behind by the one before it - exactly
 * as a real shopper would experience it. Stops short of actually submitting payment (CHK01 in
 * order-placing.spec.ts already covers a full, successful purchase); this test's focus is the
 * surrounding navigation, validation and data-correctness of the Details/Payment steps themselves.
 */
test('CO-01 - checkout: logo/breadcrumb, field validation, address search, country change, shipping, totals and billing address', async ({ page }) => {
  test.setTimeout(6 * 60_000);

  const home = new HomePage(page);
  const pdp = new PdpPage(page);
  const checkout = new CheckoutPage(page);

  // The password-gate auth cookie (and therefore the backend cart it's keyed to) is shared across
  // every test run via the one `storageState` snapshot, so start from a guaranteed-empty cart.
  await clearCart(page);

  let productName = '';
  let pdpPrice = 0;

  await test.step('Add a product to the cart and go to checkout', async () => {
    await home.goto();
    const picked = await home.randomProductCard();
    await open(page, picked.href);
    await pdp.expectLoaded();

    const pdpPriceText = await pdp.main.getByText(/^\$\d+\.\d{2}$/).first().innerText();
    pdpPrice = parsePrice(pdpPriceText);
    productName = picked.name;

    await pdp.addToBag();
    await pdp.closeCartDialog();
    await open(page, '/checkout/');
    await expect(checkout.breadcrumbNav).toBeVisible();
  });

  await test.step('CO-01 - logo and breadcrumb behave correctly at the Details step', async () => {
    await expect.soft(checkout.logoLink).toHaveAttribute('href', '/');
    await expect.soft(checkout.secureCheckoutBadge).toBeVisible();

    await expect.soft(checkout.cartBreadcrumbLink).toHaveAttribute('href', '/cart/');
    await expect.soft(checkout.breadcrumbNav.getByText('Details', { exact: true })).toHaveAttribute('aria-current', 'step');
    // "Payment" is a future step not yet reached, so it's plain text, not a link.
    await expect.soft(checkout.breadcrumbNav.getByRole('link', { name: 'Payment', exact: true })).toHaveCount(0);

    await test.step('The logo navigates home, abandoning checkout (no confirmation prompt)', async () => {
      await checkout.logoLink.click();
      await expect(page).toHaveURL(/\/$/);
      // The home page keeps firing its own background navigations/prefetches for a moment after
      // landing, which can abort an immediate re-navigation away from it - give it a beat to settle.
      await page.waitForTimeout(1_500);
      await open(page, '/checkout/');
    });
  });

  await test.step('CO-02 - Order Summary at the Details step shows the item at its PDP price', async () => {
    await expect.soft(checkout.itemRow(productName)).toBeVisible();
    const checkoutPrice = parsePrice(await checkout.itemPrice(productName).innerText());
    expect.soft(checkoutPrice, 'Checkout line price should match the PDP').toBe(pdpPrice);

    const cart = await fetchCart(page);
    await expect.soft(checkout.subtotalValue).toBeVisible();
    await expect.soft(checkout.gstValue).toBeVisible();
    await expect.soft(checkout.totalValue).toBeVisible();
    expect.soft(parsePrice(await checkout.subtotalValue.innerText()), 'Subtotal (ex GST) should match the backend').toBe(cart.subtotalNet.amount);
    expect.soft(parsePrice(await checkout.gstValue.innerText()), 'GST should match the backend').toBe(cart.includedTaxes.amount);
    expect.soft(parsePrice(await checkout.totalValue.innerText()), 'Total should match the backend').toBe(cart.total.amount);
    await expect.soft(checkout.shippingValue).toHaveText('Calculated at checkout');
  });

  await test.step('CO-02b - "Return to cart" (Details step only - it does not appear on Payment) leaves the item in the cart', async () => {
    await checkout.returnToCartLink.click();
    await expect(page).toHaveURL(/\/cart\/$/);
    await expect.soft(page.getByText(productName).first()).toBeVisible();

    const cart = await fetchCart(page);
    expect.soft(cart.cartItems.some((i) => i.title === productName), 'item should still be in the cart after returning from checkout').toBe(true);

    await open(page, '/checkout/');
    await expect(checkout.itemRow(productName)).toBeVisible();
  });

  await test.step('CO-03 - field validation (negative): empty required fields and a malformed email', async () => {
    await test.step('Submitting with every field empty highlights them all', async () => {
      await checkout.continueToPaymentButton.click();
      await expect(checkout.validationBanner).toBeVisible();
      await expect(page).toHaveURL(/\/checkout\/$/); // still on Details - did not advance

      await expect.soft(await checkout.fieldError(checkout.emailInput)).toHaveText('Enter an email address');
      await expect.soft(await checkout.fieldError(checkout.firstNameInput)).toHaveText('Enter a first name');
      await expect.soft(await checkout.fieldError(checkout.lastNameInput)).toHaveText('Enter a last name');
      await expect.soft(await checkout.fieldError(checkout.addressInput)).toHaveText('Enter an address');
      await expect.soft(await checkout.fieldError(checkout.phoneInput)).toHaveText('Enter a phone number');
      await expect.soft(checkout.emailInput).toHaveAttribute('aria-invalid', 'true');
    });

    await test.step('A malformed email gets its own, more specific message', async () => {
      await checkout.emailInput.fill('not-an-email');
      await checkout.continueToPaymentButton.click();
      await expect.soft(await checkout.fieldError(checkout.emailInput)).toHaveText('Enter a valid email address');
    });
  });

  await test.step('CO-04 - AU address search returns AU addresses and populates suburb/state/postcode', async () => {
    await checkout.firstNameInput.fill('Test');
    await checkout.lastNameInput.fill('Order');
    await checkout.emailInput.fill('test.order@example.com');

    await checkout.addressInput.click();
    await checkout.addressInput.pressSequentially('1 Collins Street Melbourne', { delay: 60 });
    await expect(checkout.addressListbox.getByRole('option').first()).toBeVisible({ timeout: 10_000 });

    const suggestions = await checkout.addressListbox.getByRole('option').allInnerTexts();
    expect.soft(suggestions.length, 'should offer at least one AU suggestion').toBeGreaterThan(0);
    for (const s of suggestions) expect.soft(s, 'AU address search should only return Australian addresses').toContain('Australia');

    await checkout.addressListbox.getByRole('option').first().click();
    await expect.soft(checkout.suburbInput).not.toHaveValue('');
    await expect.soft(checkout.stateSelect).not.toHaveValue('');
    await expect.soft(checkout.postcodeInput).not.toHaveValue(/^$/);

    await checkout.phoneInput.fill('0400000000');
  });

  await test.step('CO-05 - switching country to NZ relabels fields and scopes address search to NZ', async () => {
    await checkout.countrySelect.selectOption('NZ');

    await test.step('Field labels change for NZ', async () => {
      await expect.soft(page.getByLabel('City', { exact: true })).toBeVisible();
      await expect.soft(page.getByLabel('Region', { exact: true })).toBeVisible();
      await expect.soft(page.getByLabel('Postal code', { exact: true })).toBeVisible();
      await expect.soft(page.getByLabel('Suburb', { exact: true })).toHaveCount(0);
    });

    await test.step('Address search now returns only NZ addresses', async () => {
      await checkout.addressInput.click();
      await checkout.addressInput.fill('');
      await checkout.addressInput.pressSequentially('1 Queen Street Auckland', { delay: 60 });
      await expect(checkout.addressListbox.getByRole('option').first()).toBeVisible({ timeout: 10_000 });

      const suggestions = await checkout.addressListbox.getByRole('option').allInnerTexts();
      expect.soft(suggestions.length, 'should offer at least one NZ suggestion').toBeGreaterThan(0);
      for (const s of suggestions) {
        expect.soft(s, 'NZ address search should only return New Zealand addresses').toContain('New Zealand');
        expect.soft(s, 'NZ address search should not leak AU addresses').not.toContain('Australia');
      }

      await checkout.addressListbox.getByRole('option').first().click();
      await expect.soft(checkout.suburbInput).not.toHaveValue(''); // "City" field, same locator (regex label)
      await expect.soft(checkout.postcodeInput).not.toHaveValue(/^$/);
    });

    await test.step('Switching back to AU restores the AU field labels', async () => {
      await checkout.countrySelect.selectOption('AU');
      await expect(checkout.countrySelect).toHaveValue('AU', { timeout: 2_000 });

      // Confirmed reproducible: a delayed async response from this test's earlier NZ address
      // pick/failed submits silently reverts this select back to "New Zealand" a few seconds after
      // it's switched to "AU" - a single immediate check misses it, so confirm it's still AU after
      // a longer settle too.
      await page.waitForTimeout(3_000);
      await knownBug(
        'BUG-CO-01',
        'the Country select on the Details step can silently revert back to "New Zealand" a few seconds after being switched to "Australia", following an earlier NZ address pick',
        async () => expect(await checkout.countrySelect.inputValue()).toBe('AU'),
      );
      // Defensively re-select AU regardless of the above, so the rest of this journey (which
      // assumes AU) isn't blocked by BUG-CO-01 if it reproduced on this run.
      if ((await checkout.countrySelect.inputValue()) !== 'AU') {
        await checkout.countrySelect.selectOption('AU');
        await expect(checkout.countrySelect).toHaveValue('AU');
      }

      await expect.soft(page.getByLabel('Suburb', { exact: true })).toBeVisible();
      await expect.soft(page.getByLabel('State', { exact: true })).toBeVisible();
      await expect.soft(page.getByLabel('Postcode', { exact: true })).toBeVisible();
    });
  });

  await test.step('CO-06 - shipping method selection updates the order summary, then continue to payment', async () => {
    // Re-pick an AU address (switching country cleared it) before a shipping rate can be quoted.
    await checkout.pickAddressSuggestion('1 Collins Street Melbourne');
    await checkout.phoneInput.fill('0400000000');

    await checkout.selectShippingMethod('Aust Post - Parcel Post');
    await expect.soft(checkout.shippingValue).not.toHaveText('Calculated at checkout');
    await expect.soft(checkout.shippingValue).toHaveText(/^\$\d+\.\d{2}$/);

    const totalWithShipping = parsePrice(await checkout.totalValue.innerText());

    await checkout.selectShippingMethod('Pick up CC Bundoora');
    await expect.soft(checkout.shippingValue).toHaveText('Free');
    const totalWithPickup = parsePrice(await checkout.totalValue.innerText());
    expect.soft(totalWithPickup, 'free pickup should total less than the paid shipping method').toBeLessThan(totalWithShipping);

    await checkout.selectShippingMethod('Aust Post - Parcel Post');
    await expect(async () => {
      await checkout.continueToPaymentButton.click({ timeout: 5_000 });
      await expect(page).toHaveURL(/step=payment/, { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
  });

  let paymentTotal = 0;
  let backendCart!: BackendCart;

  await test.step('CO-07 - Payment step summarises Contact/Ship to/Method, and Order Summary matches the backend', async () => {
    const contact = checkout.paymentSummaryRow('Contact');
    const shipTo = checkout.paymentSummaryRow('Ship to');
    const method = checkout.paymentSummaryRow('Method');

    await expect.soft(contact.value).toHaveText('test.order@example.com');
    await expect.soft(shipTo.value).toContainText('Collins Street');
    await expect.soft(method.value).toContainText('Aust Post - Parcel Post');
    await expect.soft(method.value).toContainText(/\$\d+\.\d{2}/);

    backendCart = await fetchCart(page);
    const subtotal = parsePrice(await checkout.subtotalValue.innerText());
    const shipping = parsePrice(await checkout.shippingValue.innerText());
    const gst = parsePrice(await checkout.gstValue.innerText());
    paymentTotal = parsePrice(await checkout.totalValue.innerText());

    expect.soft(subtotal, 'Subtotal (ex GST) should match the backend').toBe(backendCart.subtotalNet.amount);
    expect.soft(gst, 'GST should match the backend').toBe(backendCart.includedTaxes.amount);
    expect.soft(paymentTotal, 'Total should match the backend').toBe(backendCart.total.amount);
    expect.soft(Math.round((subtotal + shipping + gst) * 100) / 100, 'Subtotal + Shipping + GST should equal Total').toBe(paymentTotal);
  });

  await test.step('CO-08 - "Contact" Change navigates back to Details with every field preserved, and an edit carries through', async () => {
    await checkout.paymentSummaryRow('Contact').changeLink.click();
    await expect(page).toHaveURL(/\/checkout\/$/);

    await expect.soft(checkout.emailInput).toHaveValue('test.order@example.com');
    await expect.soft(checkout.firstNameInput).toHaveValue('Test');
    await expect.soft(checkout.addressInput).toHaveValue(/Collins Street/);
    await expect.soft(page.getByRole('radio', { name: /Aust Post/i })).toBeChecked();

    await checkout.emailInput.fill('updated.order@example.com');
    if ((await checkout.phoneInput.inputValue()) === '') await checkout.phoneInput.fill('0400000000');
    await expect(async () => {
      await checkout.continueToPaymentButton.click({ timeout: 5_000 });
      await expect(page).toHaveURL(/step=payment/, { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });

    await expect.soft(checkout.paymentSummaryRow('Contact').value).toHaveText('updated.order@example.com');
  });

  await test.step('CO-09 - "Method" Change navigates back to Details with the shipping method preserved, and switching it carries through', async () => {
    await checkout.paymentSummaryRow('Method').changeLink.click();
    await expect(page).toHaveURL(/\/checkout\/$/);
    await expect.soft(page.getByRole('radio', { name: /Aust Post/i })).toBeChecked();

    await checkout.selectShippingMethod('Pick up CC Bundoora');
    if ((await checkout.phoneInput.inputValue()) === '') await checkout.phoneInput.fill('0400000000');
    await expect(async () => {
      await checkout.continueToPaymentButton.click({ timeout: 5_000 });
      await expect(page).toHaveURL(/step=payment/, { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });

    const method = checkout.paymentSummaryRow('Method');
    await expect.soft(method.value).toContainText('Pick up CC Bundoora');
    await expect.soft(checkout.shippingValue).toHaveText('Free');

    backendCart = await fetchCart(page);
    const newTotal = parsePrice(await checkout.totalValue.innerText());
    expect.soft(newTotal, 'switching to free pickup should lower the Total').toBeLessThan(paymentTotal);
    expect.soft(newTotal, 'Total should match the backend after the method change').toBe(backendCart.total.amount);
  });

  await test.step('CO-10 - billing address: "Same as shipping" by default, revealing a full form when different', async () => {
    await expect.soft(checkout.billingAddressInput).toHaveCount(0);

    await checkout.billingDifferentRadio.click();
    await expect.soft(checkout.billingFirstNameInput).toBeVisible();
    await expect.soft(checkout.billingLastNameInput).toBeVisible();
    await expect.soft(checkout.billingCountrySelect).toBeVisible();
    await expect.soft(checkout.billingAddressInput).toBeVisible();

    await test.step('The billing address search is independent of the shipping one and also country-scoped', async () => {
      await checkout.billingCountrySelect.selectOption('AU');
      await checkout.billingAddressInput.click();
      await checkout.billingAddressInput.pressSequentially('1 Collins Street Melbourne', { delay: 60 });
      await expect(checkout.billingAddressListbox.getByRole('option').first()).toBeVisible({ timeout: 10_000 });
      const suggestions = await checkout.billingAddressListbox.getByRole('option').allInnerTexts();
      for (const s of suggestions) expect.soft(s).toContain('Australia');
      await checkout.billingAddressListbox.getByRole('option').first().click();
      await expect.soft(checkout.billingSuburbInput).not.toHaveValue('');
    });

    await test.step('Switching back to "Same as shipping address" hides the billing form again', async () => {
      await checkout.billingSameRadio.click();
      await expect.soft(checkout.billingAddressInput).toHaveCount(0);
    });
  });
});
