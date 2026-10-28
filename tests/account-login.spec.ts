import { test, expect } from '@playwright/test';
import { HomePage } from './pages/HomePage';
import { open } from './helpers/site';
import { waitForMailsacCode } from './helpers/mailsac';

/**
 * Logs in to a freshly created account via the emailed one-time code. Creates the account itself
 * first (same as account-creation.spec.ts/ACC01) rather than depending on that test's account,
 * since each run uses its own disposable @mailsac.com address and tests shouldn't depend on another
 * test's side effects to pass.
 *
 * Account creation is currently broken server-side (BUG-4: POST /api/auth/register/ returns 502),
 * so there is no real account for a login flow to exercise yet - this skips itself with that reason
 * until BUG-4 is fixed, at which point it starts actually validating the OTP login end to end.
 */
test('ACC02 - log in to a newly created account via the emailed one-time code', async ({ page, context }) => {
  test.setTimeout(3 * 60_000);
  const home = new HomePage(page);
  await home.goto();

  const email = `cc-playwright-login-${Date.now()}@mailsac.com`;
  const { response } = await home.submitCreateAccount({ email });

  test.skip(
    response.status() >= 300,
    `BUG-4: account creation returned ${response.status()}, so there's no account yet to log into (see account-creation.spec.ts)`,
  );

  await open(page, '/account/');
  await expect(page).toHaveURL(/auth\.cargocrew\.com\.au/);

  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send Code' }).click();
  await expect(page.getByText('No account found with this email')).toBeHidden();

  const code = await waitForMailsacCode(context, email);
  const codeInput = page
    .getByLabel(/code/i)
    .or(page.locator('input[inputmode="numeric"], input[type="tel"], input[type="text"]'))
    .first();
  await codeInput.fill(code);

  const submitButton = page.getByRole('button', { name: /verify|continue|sign in|log in/i });
  if (await submitButton.count()) await submitButton.click();

  // A successful login should land back on the storefront's own account page, not leave us stuck
  // on the external auth domain or show an invalid-code error.
  await expect(page).toHaveURL(/cargocrew-2026-uat\.vercel\.app\/account\//, { timeout: 20_000 });
  await expect(page.getByText(/invalid code|incorrect code/i)).toBeHidden();
});
