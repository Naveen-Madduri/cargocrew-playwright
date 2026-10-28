import { test, expect } from '@playwright/test';
import { HomePage } from './pages/HomePage';
import { knownBug } from './helpers/known-bug';

/**
 * Creates a personal ("Individual") account from the header's "Create account" flyout, using a
 * disposable @mailsac.com address (a public inbox, readable at mailsac.com/inbox/<address> with
 * no login needed - fine for throwaway test data, never for anything real).
 */
test('ACC01 - create an individual account from the header flyout', async ({ page }) => {
  const home = new HomePage(page);
  await home.goto();

  const email = `cc-playwright-${Date.now()}@mailsac.com`;
  const { dialog, response } = await home.submitCreateAccount({ email });

  await knownBug(
    'BUG-4',
    'POST /api/auth/register/ returns 502 {"code":"registration_failed"} - account creation always fails',
    async () => {
      expect(response.status(), `expected a successful response, got ${response.status()}`).toBeLessThan(300);
      await expect(dialog.getByText(/something went wrong creating your account/i)).toBeHidden();
    },
  );
});
