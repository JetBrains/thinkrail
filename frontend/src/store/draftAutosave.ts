/** Module-scoped autosave controller for draft-on-type sessions: a 750 ms
 *  trailing debounce with a 5 s max-wait, keyed by thinkrailSid. Survives
 *  component unmounts; the commit target is injected by sessionStore. */

export const AUTOSAVE_DEBOUNCE_MS = 750;
export const AUTOSAVE_MAX_WAIT_MS = 5000;

type CommitFn = (thinkrailSid: string) => void | Promise<void>;

interface Timers {
  trailingTimer: ReturnType<typeof setTimeout> | null;
  maxWaitTimer: ReturnType<typeof setTimeout> | null;
}

const timers = new Map<string, Timers>();

let commit: CommitFn = () => {};

export function setCommitFn(fn: CommitFn): void {
  commit = fn;
}

function clearTimers(thinkrailSid: string): void {
  const entry = timers.get(thinkrailSid);
  if (!entry) return;
  if (entry.trailingTimer !== null) clearTimeout(entry.trailingTimer);
  if (entry.maxWaitTimer !== null) clearTimeout(entry.maxWaitTimer);
  timers.delete(thinkrailSid);
}

function fireCommit(thinkrailSid: string): Promise<void> {
  clearTimers(thinkrailSid);
  return Promise.resolve(commit(thinkrailSid));
}

export function noteInput(thinkrailSid: string): void {
  const existing = timers.get(thinkrailSid);
  const entry: Timers = existing ?? { trailingTimer: null, maxWaitTimer: null };

  if (entry.trailingTimer !== null) clearTimeout(entry.trailingTimer);
  entry.trailingTimer = setTimeout(() => {
    void fireCommit(thinkrailSid);
  }, AUTOSAVE_DEBOUNCE_MS);

  if (entry.maxWaitTimer === null) {
    entry.maxWaitTimer = setTimeout(() => {
      void fireCommit(thinkrailSid);
    }, AUTOSAVE_MAX_WAIT_MS);
  }

  timers.set(thinkrailSid, entry);
}

export function flush(thinkrailSid: string): Promise<void> {
  return fireCommit(thinkrailSid);
}

export function cancel(thinkrailSid: string): void {
  clearTimers(thinkrailSid);
}
