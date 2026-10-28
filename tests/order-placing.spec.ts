import { test, expect } from '@playwright/test';
import { HomePage } from './pages/HomePage';
import { PdpPage } from './pages/PdpPage';
import { CheckoutPage } from './pages/CheckoutPage';

/**
 * End-to-end order: pick a product from the home page, add it to the bag and pay with a card.
 * Uses Stripe's standard test card - the checkout's Payment Element loads with a `pk_test_...`
 * publishable key, confirming this is Stripe test mode and no real charge occurs.
 */
test('CHK01 - place an order from the home page with a credit card', async ({ page }) => {
  test.setTimeout(5 * 60_000);

  const home = new HomePage(page);
  const pdp = new PdpPage(page);
  const checkout = new CheckoutPage(page);

  const productLink = page.locator('main').locator('a[href^="/product/"]').first();

  await test.step('Pick a product from the home page', async () => {
    await home.goto();
    await expect(productLink).toBeVisible();
    const href = await productLink.getAttribute('href');
    await productLink.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await pdp.expectLoaded();
  });

  const productName = (await pdp.heading.innerText()).trim();

  await test.step('Add it to the bag and go to checkout', async () => {
    await pdp.addToBag();
    await expect(pdp.cartDialog).toBeVisible();
    await expect.soft(pdp.cartDialog).toContainText(productName);

    // First click can land before hydration, so retry until it navigates.
    await expect(async () => {
      await pdp.cartDialog.getByRole('link', { name: /checkout/i }).click({ timeout: 5_000 });
      await expect(page).toHaveURL(/\/cart\/$/, { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });

    await expect(async () => {
      await page.getByRole('link', { name: /checkout securely/i }).click({ timeout: 5_000 });
      await expect(page).toHaveURL(/\/checkout\//, { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
  });

  await test.step('Fill delivery details and continue to payment', async () => {
    await checkout.fillDetails({
      email: 'test.order@example.com',
      firstName: 'Test',
      lastName: 'Order',
      addressQuery: '1 Collins Street Melbourne',
      phone: '0400000000',
    });
  });

  await test.step('Pay with a test credit card', async () => {
    await checkout.fillCardPayment({ number: '4242424242424242', expiry: '12/34', cvc: '123' });
    await checkout.completePurchase();
  });

  await test.step('Order is confirmed', async () => {
    await expect(page).toHaveURL(/\/checkout\/confirmation\//, { timeout: 30_000 });
    await expect(page.getByText(/your order is placed/i)).toBeVisible();

    const orderNumber = page.getByText(/^AU-\d+$/).first();
    await expect(orderNumber).toBeVisible();
    console.log(`Order placed: ${await orderNumber.innerText()}`);

    await expect.soft(page.getByText(productName).first()).toBeVisible();
  });
});
