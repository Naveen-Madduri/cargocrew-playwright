import { test, expect } from '@playwright/test';
import { open, unlock } from './helpers/site';

// Start without the saved cookie so the password gate is shown.
test.use({ storageState: { cookies: [], origins: [] } });

test('Open website', async ({ page }) => {
  await test.step('TC01 - shows the password page before login', async () => {
    await open(page, '/');

    await expect(page).toHaveTitle('Protected Page');
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible();
  });

  await test.step('TC02 - empty password cannot be submitted', async () => {
    await page.getByRole('button', { name: 'Unlock' }).click();

    const isValid = await page.getByLabel('Password').evaluate((el: HTMLInputElement) => el.checkValidity());
    expect.soft(isValid).toBe(false);
    await expect(page).toHaveTitle('Protected Page');
  });

  await test.step('TC03 - wrong password keeps the user on the gate', async () => {
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Unlock' }).click();

    await expect.soft(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveTitle('Protected Page');
  });

  await test.step('TC04 - correct password opens the home page', async () => {
    await open(page, '/');
    await unlock(page);

    await expect(page).toHaveTitle(/Cargo Crew \| The Modern Uniform/);
    await expect(page.getByLabel('Password')).toHaveCount(0);
  });

  const header = page.locator('header');

  await test.step('TC05 - home page loads with logo, header and footer', async () => {
    await expect.soft(header.getByRole('link', { name: 'Cargo Crew' })).toBeVisible();
    await expect.soft(page.locator('main')).toBeVisible();
    await expect.soft(page.locator('footer')).toBeAttached();
  });

  await test.step('TC06 - main navigation menu items are visible', async () => {
    for (const item of ['Tops', 'Bottoms', 'Aprons', 'Chef', 'Health', 'Corporate']) {
      await expect.soft(header.getByRole('link', { name: item, exact: true }).first()).toBeVisible();
    }
  });

  await test.step('TC07 - header icons link to wishlist, account and cart', async () => {
    for (const href of ['/wishlist/', '/account/', '/cart/']) {
      await expect.soft(header.locator(`a[href="${href}"]`).first()).toBeVisible();
    }
  });

  await test.step('TC08 - skip to main content link exists for accessibility', async () => {
    await expect.soft(page.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main-content');
  });

  await test.step('TC09 - clicking a nav item opens its listing page', async () => {
    await header.getByRole('link', { name: 'Aprons', exact: true }).first().click();

    await expect(page).toHaveURL(/\/aprons\/$/);
    await expect.soft(page.getByRole('heading', { level: 1 })).toHaveText('Aprons');
  });

  await test.step('TC10 - logo returns to the home page', async () => {
    await header.getByRole('link', { name: 'Cargo Crew' }).click();

    await expect(page).toHaveURL(/\/$/);
  });

  await test.step('TC11 - unknown URL returns a 404', async () => {
    const response = await open(page, '/this-page-does-not-exist-xyz/');
    expect.soft(response?.status()).toBe(404);
  });
});
