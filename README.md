# cargocrew-playwright

End-to-end [Playwright](https://playwright.dev) tests for the Cargo Crew storefront. By default they run against the password-protected UAT site at `https://cargocrew-2026-uat.vercel.app`.

## Setup

Requires Node.js (LTS).

```bash
npm install
npx playwright install --with-deps
```

## Running tests

```bash
npx playwright test                          # all tests, all browsers
npx playwright test --project=chromium       # one browser
npx playwright test tests/cart-page.spec.ts  # one file
npx playwright test -g "PDP-003"             # by test ID / title
npx playwright test --ui                     # interactive UI mode
npx playwright show-report                   # open the last HTML report
```

### Environment variables

| Variable        | Default                                   | Purpose                                                       |
| --------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `BASE_URL`      | `https://cargocrew-2026-uat.vercel.app`   | Site under test                                               |
| `SITE_PASSWORD` | UAT password (see `tests/helpers/site.ts`) | Unlocks the Vercel password gate                              |
| `CI`            | unset                                     | When set: 2 retries, 1 worker, and `test.only` fails the run |

There's no `.env` loading, so pass variables inline, for example `BASE_URL=https://... npx playwright test`.

## How it works

- **Password gate**: the `setup` project (`tests/auth.setup.ts`) unlocks the Vercel password page once and saves the cookie to `playwright/.auth/site.json`. The `chromium`, `firefox` and `webkit` projects depend on it and reuse that saved state.
- **Timeouts**: the UAT site is slow to fire `load`, so pages are opened with `waitUntil: 'domcontentloaded'`. Each test gets 90s, `expect` gets 15s and navigation gets 60s.
- **Artifacts**: an HTML report is always generated. Screenshots are captured on failure and traces on the first retry.

## Project structure

```
tests/
  auth.setup.ts          # unlocks the password gate, saves storage state
  *.spec.ts              # test suites (see below)
  pages/                 # page objects: HomePage, PlpPage, PdpPage, MiniCartPage, CartPage, CheckoutPage
  helpers/
    site.ts              # open() + unlock() for the password gate
    known-bug.ts         # knownBug() wrapper for checks that fail because of a known site bug
    mailsac.ts           # reads one-time codes from public mailsac.com inboxes
    pdp.ts, plp.ts, price.ts  # page-specific utilities
.github/workflows/playwright.yml  # CI
```

## Test suites

| File                         | IDs                 | Covers                                                                                       |
| ---------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `open-website.spec.ts`       | —                   | Smoke test: the site loads                                                                    |
| `plp.spec.ts`                | PLP                 | Aprons product listing page                                                                  |
| `pdp-validation.spec.ts`     | PDP-001 – PDP-005   | Random-product PDP checks; apron colour/strap variants; name and logo embroidery; inventory limits |
| `pdp.spec.ts`                | —                   | Older PDP tests, currently commented out                                                    |
| `mini-cart.spec.ts`          | MC-01               | Mini-cart flyout: empty state, free shipping, quantity, delete, upsell, totals               |
| `cart-page.spec.ts`          | CP-01               | Cart page: quantity, embroidery, upsell, order summary, shipping, country                    |
| `checkout-page.spec.ts`      | CO-01               | Checkout: field validation, address search, shipping, totals, billing address                |
| `price-consistency.spec.ts`  | PRICE01             | Same price shown on Home, PDP, Cart, Checkout and the cart API                               |
| `order-placing.spec.ts`      | CHK01               | Full order paid with a Stripe test card (test mode, so no real charge)                       |
| `account-creation.spec.ts`   | ACC01               | Create an individual account with a disposable `@mailsac.com` address                       |
| `account-login.spec.ts`      | ACC02               | Log in with the emailed one-time code (skips itself while account creation is broken) |

## Known bugs

Checks that are expected to fail because of a known site bug are wrapped in `knownBug(id, description, check)`:

- While the bug is still present, the test passes and the report gets a `known bug` annotation.
- Once the bug is fixed, the test soft-fails with a "looks FIXED" message. That tells you to remove the wrapper.

For example, BUG-4 (`POST /api/auth/register/` returns 502) blocks account creation. Because of it, ACC02 skips itself.

## CI

GitHub Actions (`.github/workflows/playwright.yml`) runs the full suite on every push and pull request to `main`/`master`. It uploads `playwright-report/` as an artifact, which is kept for 30 days.
