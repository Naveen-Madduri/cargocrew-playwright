import { Locator, Page, expect } from '@playwright/test';
import { open } from '../helpers/site';
import { parsePrice } from '../helpers/price';

/** Home page, i.e. '/'. */
export class HomePage {
  readonly header: Locator;
  readonly logo: Locator;
  readonly searchInput: Locator;
  readonly wishlistLink: Locator;
  readonly accountLink: Locator;
  readonly cartLink: Locator;
  readonly createAccountDialog: Locator;

  constructor(readonly page: Page) {
    this.header = page.locator('header');
    this.logo = this.header.getByRole('link', { name: 'Cargo Crew' });
    this.searchInput = this.header.locator('input');
    this.wishlistLink = this.header.locator('a[href="/wishlist/"]').first();
    this.accountLink = this.header.locator('a[href="/account/"]').first();
    this.cartLink = this.header.locator('a[href="/cart/"]').first();
    this.createAccountDialog = page.getByRole('dialog', { name: 'Create account' });
  }

  async goto() {
    await open(this.page, '/');
    await expect(this.logo).toBeVisible();
  }

  /** Top nav link, e.g. "Tops", "Bottoms", "Aprons". */
  navLink(name: string) {
    return this.header.getByRole('link', { name, exact: true }).first();
  }

  /**
   * First click can land before hydration, so retry until the URL actually changes. Checks
   * whether we're already there before each retry's click: this nav link is a mega-menu trigger
   * (aria-haspopup), and re-clicking it after a click that already landed on the destination page
   * doesn't trigger a fresh navigation, which would otherwise hang the click waiting for one.
   */
  async goToCategory(name: string) {
    const link = this.navLink(name);
    const href = await link.getAttribute('href');
    const urlPattern = new RegExp(`${href}$`);
    await expect(async () => {
      if (!urlPattern.test(this.page.url())) await link.click({ timeout: 5_000 });
      await expect(this.page).toHaveURL(urlPattern, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }

  /**
   * Opens the "Create account" flyout from the header's account icon (not the same as navigating
   * to /account/ directly, which instead redirects to the separate OTP sign-in flow for existing
   * accounts). First click can land before hydration, so retry until the dialog opens.
   */
  async openCreateAccount() {
    await expect(async () => {
      if (!(await this.createAccountDialog.isVisible())) await this.accountLink.click({ timeout: 5_000 });
      await expect(this.createAccountDialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }

  /**
   * Fills and submits the "Create account" flyout as an Individual, returning the email used and
   * the registration API's response so callers can decide how to treat failure (see BUG-4).
   */
  async submitCreateAccount({
    email,
    firstName = 'Test',
    lastName = 'Account',
    phone = '412345678',
  }: {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  }) {
    await this.openCreateAccount();
    const dialog = this.createAccountDialog;

    // "Business" is selected by default; its underlying radio input is visually hidden (sr-only)
    // behind a styled label, so it must be selected by clicking the label text, not the input.
    await dialog.getByText('Individual', { exact: true }).click();
    await expect(dialog.getByRole('radio', { name: /^Individual/ })).toBeChecked();

    await dialog.locator('#reg-first-name').fill(firstName);
    await dialog.locator('#reg-last-name').fill(lastName);
    await dialog.locator('#reg-email').fill(email);
    await dialog.locator('#reg-phone').fill(phone);

    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes('/api/auth/register/'), { timeout: 20_000 }),
      dialog.getByRole('button', { name: /create account/i }).click(),
    ]);
    return { dialog, response };
  }

  /**
   * Picks a random product card from anywhere on the home page (not just the first one, so
   * repeated runs exercise different products/categories rather than one hardcoded item).
   * Scoped to `article` cards with a visible price, since the home page also links to products
   * from non-card contexts (e.g. a promo banner) that don't carry a comparable price.
   */
  async randomProductCard(): Promise<{ card: Locator; name: string; href: string; price: number }> {
    const cards = this.page
      .locator('main')
      .locator('article')
      .filter({ has: this.page.locator('a[href^="/product/"]') })
      // Gift cards/bundles don't carry a single comparable unit price the way a normal product
      // does, and some home sections (e.g. a social/UGC "shop the look" strip) link to a product
      // without showing its price at all - both are unusable for a price comparison.
      .filter({ hasNotText: /gift card|bundle/i })
      .filter({ hasText: /\$\d+\.\d{2}/ });
    const all = await cards.all();
    const visible: Locator[] = [];
    for (const c of all) if (await c.isVisible()) visible.push(c);
    if (visible.length === 0) throw new Error('No visible product cards found on the home page');

    const card = visible[Math.floor(Math.random() * visible.length)];
    await card.scrollIntoViewIfNeeded();
    const href = (await card.locator('a[href^="/product/"]').first().getAttribute('href'))!;

    // Card text is a fixed shape - an optional badge line, then the name, then the price (then an
    // optional colour count) - so the name is reliably whatever line sits right before the price,
    // which is more robust than assuming which of the card's several links wraps the title text.
    const lines = (await card.innerText()).split('\n').map((l) => l.trim());
    const priceLineIndex = lines.findIndex((l) => /^\$\d+\.\d{2}$/.test(l));
    if (priceLineIndex < 1) throw new Error(`Could not find a product name before the price in card text: ${lines.join(' | ')}`);
    const name = lines[priceLineIndex - 1];
    const price = parsePrice(lines[priceLineIndex]);
    return { card, name, href, price };
  }
}
