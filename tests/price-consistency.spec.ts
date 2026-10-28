import { test, expect } from '@playwright/test';
import { HomePage } from './pages/HomePage';
import { PdpPage } from './pages/PdpPage';
import { CartPage } from './pages/CartPage';
import { open } from './helpers/site';
import { parsePrice, readOrderSummary } from './helpers/price';

/** `readOrderSummary` can transiently miss a value while the summary panel is still laying out. */
async function readOrderSummaryStable(page: Parameters<typeof readOrderSummary>[0]) {
  let summary!: Awaited<ReturnType<typeof readOrderSummary>>;
  await expect(async () => {
    summary = await readOrderSummary(page);
  }).toPass({ timeout: 10_000 });
  return summary;
}

/**
 * Picks a random product (a different one on every run, deliberately - this guards against the
 * price pipeline breaking for some products but not others, which a single hardcoded product
 * could never catch) and follows its price across every page that shows it, cross-checking the
 * final figures against `/api/cart/` - the backend's own source of truth, not just more UI text.
 */
test('PRICE01 - a product price is consistent across Home, PDP, Cart, Checkout and the cart API', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const home = new HomePage(page);
  const pdp = new PdpPage(page);
  const cart = new CartPage(page);

  let productName = '';
  let homePrice = 0;
  let pdpPrice = 0;

  await test.step('Pick a random product from the home page', async () => {
    await home.goto();
    const picked = await home.randomProductCard();
    productName = picked.name;
    homePrice = picked.price;
    console.log(`Tracking "${productName}" at $${homePrice} from the home page`);

    await open(page, picked.href);
    await pdp.expectLoaded();
  });

  await test.step('PDP price matches the home page', async () => {
    const pdpPriceText = await pdp.main.getByText(/^\$\d+\.\d{2}$/).first().innerText();
    pdpPrice = parsePrice(pdpPriceText);
    expect.soft(pdpPrice, 'PDP price should match the home page card').toBe(homePrice);
  });

  let cartDialogPrice = 0;
  await test.step('Cart drawer price matches the PDP', async () => {
    await pdp.addToBag();
    await expect(pdp.cartDialog).toBeVisible();
    // The drawer also shows unrelated prices (a free-shipping threshold, "add a little extra"
    // suggestions), so read the price immediately following this product's own name rather than
    // the first "$X.XX" found anywhere in the drawer.
    const afterName = (await pdp.cartDialog.innerText()).split(productName)[1];
    cartDialogPrice = parsePrice(afterName);
    expect.soft(cartDialogPrice, 'Cart drawer price should match the PDP').toBe(pdpPrice);
  });

  let backendCart: any;
  await test.step('Backend cart API agrees with the UI', async () => {
    const response = await page.request.get('/api/cart/');
    backendCart = await response.json();
    const item = backendCart.cartItems.find((i: { title: string }) => i.title === productName);
    expect(item, `backend cart should contain "${productName}"`).toBeTruthy();
    expect.soft(item.unitPrice.amount, 'Backend unit price should match the PDP/cart-drawer price').toBe(pdpPrice);
  });

  await test.step('Cart page price matches the backend and earlier pages', async () => {
    await cart.goto();
    const backendItem = backendCart.cartItems.find((i: { title: string }) => i.title === productName);

    const unitPrice = parsePrice(await cart.itemUnitPrice(productName).innerText());
    const lineTotal = parsePrice(await cart.itemTotal(productName).innerText());
    expect.soft(unitPrice, 'Cart page unit price should match the PDP').toBe(pdpPrice);
    expect.soft(lineTotal, 'Cart page line total should match the backend line total').toBe(backendItem.totalPrice.amount);

    const summary = await readOrderSummaryStable(page);
    expect.soft(summary.subtotalExGst, 'Cart page Subtotal (ex GST) should match the backend').toBe(backendCart.subtotalNet.amount);
    expect.soft(summary.gst, 'Cart page GST should match the backend').toBe(backendCart.includedTaxes.amount);
    expect.soft(summary.total, 'Cart page Total should match the backend').toBe(backendCart.total.amount);
  });

  await test.step('Checkout order summary matches the backend', async () => {
    await open(page, '/checkout/');
    await expect(page.getByRole('heading', { name: 'Order Summary' })).toBeVisible();

    const summary = await readOrderSummaryStable(page);
    expect.soft(summary.subtotalExGst, 'Checkout Subtotal (ex GST) should match the backend').toBe(backendCart.subtotalNet.amount);
    expect.soft(summary.gst, 'Checkout GST should match the backend').toBe(backendCart.includedTaxes.amount);
    expect.soft(summary.total, 'Checkout Total should match the backend').toBe(backendCart.total.amount);
  });
});
