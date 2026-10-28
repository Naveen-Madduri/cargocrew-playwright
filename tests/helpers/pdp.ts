import { Page } from '@playwright/test';
import { extractBalanced } from './plp';

/** Stock state as the server reports it, per product and per size. */
export type StockState = 'in-stock' | 'low' | 'out';

/** The subset of a PDP's server-side `product` object that the UI renders and tests check. */
export interface PdpProduct {
  id: string;
  title: string;
  productSku: string;
  price: number;
  currency: string;
  stock: StockState;
  breadcrumbs: Array<{ label: string; href?: string }>;
  sizes: Array<{ label: string; value: string; sku: string; variantId: number; stock: StockState }>;
  images: Array<{ src: string; alt: string }>;
  colour?: { selectedLabel: string; selectedValue: string; options: Array<{ label: string; value: string }> };
  rating?: { value: number; count: number } | null;
}

/**
 * Fetches a PDP's server-computed `product` data for `path` (e.g. '/product/boston-.../') from its
 * React Server Component payload - same approach and rationale as `fetchPlpResult` in ./plp: there
 * is no separate product JSON endpoint, so this payload is the ground truth the page renders from.
 */
export async function fetchPdpProduct(page: Page, path: string): Promise<PdpProduct> {
  const response = await page.request.get(path, { headers: { rsc: '1' } });
  const text = await response.text();
  // `"product":{"id"` rather than just `"product":{` - other components in the payload (e.g.
  // recommendation cards) also carry a `product` key, but only the PDP's own one starts with `id`.
  const start = text.indexOf('"product":{"id"');
  if (start === -1) throw new Error(`PDP "product" data not found in RSC payload for ${path}`);
  return JSON.parse(extractBalanced(text.slice(start), '"product":{')) as PdpProduct;
}

/** The `/api/cart/add/` 409 message shown when the requested quantity exceeds available stock. */
export const OVER_STOCK_MESSAGE = /^Sorry, the quantity you've added is more than we currently have available\. Please enter a quantity of (\d+) or less\.$/;
