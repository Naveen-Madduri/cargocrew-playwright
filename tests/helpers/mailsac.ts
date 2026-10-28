import { BrowserContext } from '@playwright/test';

/**
 * Polls a mailsac.com public inbox (readable at mailsac.com/inbox/<address> with no login or API
 * key - fine for throwaway @mailsac.com test addresses, never for anything real) until a message
 * arrives, opens it, and returns the first run of `digits` consecutive digits found in its body -
 * the one-time code.
 *
 * Unverified against a real message: every account-creation attempt this suite has made against
 * this site so far has failed server-side (see BUG-4 in account-creation.spec.ts) before any email
 * was sent, so the message-opening step below has not been exercised against a real mailsac email
 * yet. If mailsac's inbox markup doesn't match the assumptions here, this will need adjusting once
 * BUG-4 is fixed and a real code email can be inspected.
 */
export async function waitForMailsacCode(
  context: BrowserContext,
  email: string,
  { digits = 6, timeoutMs = 60_000, pollMs = 3_000 }: { digits?: number; timeoutMs?: number; pollMs?: number } = {},
): Promise<string> {
  const inbox = await context.newPage();
  try {
    await inbox.goto(`https://mailsac.com/inbox/${email}`, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const noMail = await inbox.getByText('No mail!').isVisible().catch(() => false);
      if (!noMail) {
        // Mailsac lists messages as table rows; the row/subject is a link into the rendered message.
        await inbox.locator('table a').first().click();
        await inbox.waitForTimeout(1_000);
        const body = await inbox.locator('body').innerText();
        const match = body.match(new RegExp(`\\b(\\d{${digits}})\\b`));
        if (match) return match[1];
      }
      await inbox.waitForTimeout(pollMs);
      await inbox.reload({ waitUntil: 'domcontentloaded' });
    }
    throw new Error(`No email with a ${digits}-digit code arrived for ${email} within ${timeoutMs}ms`);
  } finally {
    await inbox.close();
  }
}
