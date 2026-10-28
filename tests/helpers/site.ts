import { Page, expect } from '@playwright/test';

export const SITE_PASSWORD = process.env.SITE_PASSWORD ?? 'Pleaseletmein';

/** The UAT `load` event is slow (third-party scripts), so wait for DOM only. */
export async function open(page: Page, path: string) {
  return page.goto(path, { waitUntil: 'domcontentloaded' });
}

/** Fills the Vercel password gate and waits for the real site to render. */
export async function unlock(page: Page, password = SITE_PASSWORD) {
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page).toHaveTitle(/Cargo Crew/, { timeout: 60_000 });
}
