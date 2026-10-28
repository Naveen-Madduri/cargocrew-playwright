import { test as setup } from '@playwright/test';
import { AUTH_FILE } from '../playwright.config';
import { open, unlock } from './helpers/site';

setup('unlock password-protected site', async ({ page }) => {
  await open(page, '/');
  await unlock(page);
  await page.context().storageState({ path: AUTH_FILE });
});
