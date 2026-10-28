import { Page } from '@playwright/test';

/** A single product entry as the server computes it for a PLP listing. */
export interface PlpProduct {
  id: string;
  handle: string;
  href: string;
  title: string;
  price: number;
  badge?: string;
  category: string;
  colour?: string;
  rating?: { value: number; count: number };
}

/**
 * Extracts a balanced JSON value (object or array) starting at the first occurrence of `keyStart`
 * (e.g. `"products":[`), by counting brackets while skipping over quoted strings. Used because the
 * RSC payload isn't plain JSON end-to-end - it's React's "Flight" wire format, a sequence of
 * `<id>:<value>` lines - but the specific value this app embeds for `products` is itself ordinary,
 * unescaped JSON, so it can be sliced out once its start and end are found.
 */
export function extractBalanced(text: string, keyStart: string): string {
  const start = text.indexOf(keyStart);
  if (start === -1) throw new Error(`"${keyStart}" not found in RSC payload`);
  let i = start + keyStart.length - 1;
  const openChar = text[i];
  const closeChar = openChar === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) depth++;
    if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(i, j + 1);
    }
  }
  throw new Error(`Unbalanced brackets reading "${keyStart}" from RSC payload`);
}

/** A PLP listing result as the server actually computed it - products plus the true total hit count. */
export interface PlpResult {
  products: PlpProduct[];
  /** The search backend's (Algolia's) own total hit count for this query - the real "N Styles" source, independent of how many products were actually returned/rendered. */
  nbHits: number;
}

/**
 * Fetches a PLP's actual server-computed listing result for `path` (e.g. '/aprons/',
 * '/aprons/?sort=price-asc', '/aprons/?view=all') by requesting its React Server Component (RSC)
 * payload directly - the `rsc: 1` request header makes Next.js return the same data it renders the
 * page from as a Flight payload, rather than a full HTML document. This is the closest thing this
 * site has to a listing API: there is no separate REST/JSON endpoint for product listings, and the
 * client never calls Algolia (or any other search index) directly - everything is rendered
 * server-side. The payload embeds the exact product order, prices, ratings, badges and `nbHits`
 * (Algolia's own total-hit count - what the "N Styles" label is sourced from) the server computed,
 * independent of whatever the page then renders - so it's the real ground truth to validate the UI
 * against, and can also tell a backend defect (wrong data here) apart from a frontend one (right
 * data here, rendered wrong).
 */
export async function fetchPlpResult(page: Page, path: string): Promise<PlpResult> {
  const response = await page.request.get(path, { headers: { rsc: '1' } });
  const text = await response.text();
  const products = JSON.parse(extractBalanced(text, '"products":[')) as PlpProduct[];
  const nbHitsMatch = text.match(/"nbHits":(\d+)/);
  if (!nbHitsMatch) throw new Error('"nbHits" not found in RSC payload');
  return { products, nbHits: parseInt(nbHitsMatch[1], 10) };
}

/** Convenience wrapper for callers that only need the product array (e.g. price/order checks). */
export async function fetchPlpProducts(page: Page, path: string): Promise<PlpProduct[]> {
  return (await fetchPlpResult(page, path)).products;
}
