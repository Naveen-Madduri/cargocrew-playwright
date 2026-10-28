import { Locator, Page } from '@playwright/test';

/** Parses the first "$X.XX" price found in a string of text. */
export function parsePrice(text: string): number {
  const match = text.match(/\$(\d+(?:\.\d{2})?)/);
  if (!match) throw new Error(`No price found in "${text}"`);
  return parseFloat(match[1]);
}

/**
 * Reads the "Subtotal (ex GST)" / "GST" / "Total" figures out of the Order Summary block shown on
 * the Cart and Checkout (Details step) pages. The two pages render this visually-identical block
 * with different markup (one uses <dt>/<dd>, the other plain <div>s), so the label's value is
 * read from its next sibling element rather than via a tag- or role-specific query.
 */
export async function readOrderSummary(page: Page) {
  // Checkout additionally renders a second, hidden-on-desktop copy of this whole block for mobile
  // (#checkout-mobile-summary), so every lookup below picks whichever matching element is actually
  // visible rather than assuming there's only one.
  const visibleText = async (locator: Locator) => {
    for (const el of await locator.all()) if (await el.isVisible()) return el.innerText();
    throw new Error('No visible match found');
  };
  const valueAfterLabel = (label: string) => visibleText(page.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]'));

  const [subtotalExGst, gst, totalText] = await Promise.all([
    valueAfterLabel('Subtotal (ex GST)'),
    valueAfterLabel('GST'),
    visibleText(page.getByText(/\$\d+\.\d{2}\s*AUD/)),
  ]);

  return {
    subtotalExGst: parsePrice(subtotalExGst),
    gst: parsePrice(gst),
    total: parsePrice(totalText),
  };
}

/** The `/api/cart/` response shape relevant to UI price assertions. */
export interface BackendCart {
  cartCount: number;
  cartItems: Array<{
    title: string;
    quantity: number;
    unitPrice: { amount: number };
    totalPrice: { amount: number };
  }>;
  subtotalNet: { amount: number };
  includedTaxes: { amount: number };
  total: { amount: number };
  summaryCartValueIncTax: { amount: number };
  summaryShippingIsFree: boolean;
}

/** Reads the backend's own cart state - the source of truth to cross-check mini-cart UI figures against. */
export async function fetchCart(page: Page): Promise<BackendCart> {
  const response = await page.request.get('/api/cart/');
  return response.json();
}

/**
 * Empties the backend cart via the API. The password-gate auth cookie is shared across every test
 * (one `storageState` snapshot), and the backend cart is tied to that same session - so without
 * this, items added by one test are still sitting in the cart when the next test starts.
 */
export async function clearCart(page: Page) {
  const cart = await fetchCart(page);
  for (const item of cart.cartItems as Array<{ lineItemId: string; quantity: number }>) {
    await page.request.post('/api/cart/remove/', { data: { lineItemId: item.lineItemId, quantity: item.quantity } });
  }
}
