import { test, expect } from '@playwright/test';

/**
 * Runs a check that is currently expected to fail because of a known site bug.
 * - Still failing  → adds a "known bug" annotation to the report, test carries on green.
 * - Now passing    → soft-fails so you know the bug is fixed and can remove this wrapper.
 *
 * Use plain (non-soft) expects inside `check` so the failure is caught here.
 */
export async function knownBug(id: string, description: string, check: () => Promise<void>) {
  try {
    await check();
  } catch {
    test.info().annotations.push({ type: 'known bug', description: `${id}: ${description}` });
    return;
  }
  expect.soft(false, `${id} looks FIXED - remove knownBug() wrapper. (${description})`).toBe(true);
}
