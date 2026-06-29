/**
 * File-system mutex for global AppStore mutations.
 *
 * Several specs call `seedSessionDefaults` / `setAnalyticsConsent`, which
 * write to the shared `~/.tr/tr.db` AppStore — not to the per-test tempProject.
 * With workers > 1, two such specs can land on different workers and stomp each
 * other's seeded state mid-test. Acquiring this lock in `beforeEach` and
 * releasing it in `afterEach` serialises all AppStore-touching tests while
 * letting every other spec run freely in parallel.
 *
 * Stale-lock detection: if the lock file is older than LOCK_EXPIRY_MS (longer
 * than the configured test timeout of 90s), it is treated as abandoned and
 * cleared so the next test is not stuck forever.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK_FILE = join(tmpdir(), "thinkrail-e2e-appstore.lock");
const LOCK_EXPIRY_MS = 120_000;
const POLL_INTERVAL_MS = 100;
const ACQUIRE_TIMEOUT_MS = 30_000;

export async function acquireAppStoreLock(): Promise<void> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (!existsSync(LOCK_FILE)) {
      try {
        writeFileSync(LOCK_FILE, String(Date.now()), { flag: "wx" });
        return;
      } catch {
        // Another worker won the race — fall through to poll.
      }
    } else {
      try {
        const acquiredAt = parseInt(readFileSync(LOCK_FILE, "utf8"), 10);
        if (Number.isFinite(acquiredAt) && Date.now() - acquiredAt > LOCK_EXPIRY_MS) {
          unlinkSync(LOCK_FILE);
        }
      } catch {
        // Lock was cleared by another worker between existsSync and readFileSync — fine.
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `acquireAppStoreLock: could not acquire within ${ACQUIRE_TIMEOUT_MS / 1000}s — ` +
      `another worker may have crashed holding the lock at ${LOCK_FILE}`,
  );
}

export function releaseAppStoreLock(): void {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // Ignore — lock may already be cleared (e.g. stale-lock eviction by next waiter).
  }
}
