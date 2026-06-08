/** Module-scoped autosave controller for draft-on-type sessions: a 750 ms
 *  trailing debounce with a 5 s max-wait, keyed by bonsaiSid. Survives
 *  component unmounts; the commit target is injected by sessionStore. */

export const AUTOSAVE_DEBOUNCE_MS = 750;
export const AUTOSAVE_MAX_WAIT_MS = 5000;

type CommitFn = (bonsaiSid: string) => void | Promise<void>;

interface Timers {
  trailingTimer: ReturnType<typeof setTimeout> | null;
  maxWaitTimer: ReturnType<typeof setTimeout> | null;
}

const timers = new Map<string, Timers>();

let commit: CommitFn = () => {};

export function setCommitFn(fn: CommitFn): void {
  commit = fn;
}

function clearTimers(bonsaiSid: string): void {
  const entry = timers.get(bonsaiSid);
  if (!entry) return;
  if (entry.trailingTimer !== null) clearTimeout(entry.trailingTimer);
  if (entry.maxWaitTimer !== null) clearTimeout(entry.maxWaitTimer);
  timers.delete(bonsaiSid);
}

function fireCommit(bonsaiSid: string): Promise<void> {
  clearTimers(bonsaiSid);
  return Promise.resolve(commit(bonsaiSid));
}

export function noteInput(bonsaiSid: string): void {
  const existing = timers.get(bonsaiSid);
  const entry: Timers = existing ?? { trailingTimer: null, maxWaitTimer: null };

  if (entry.trailingTimer !== null) clearTimeout(entry.trailingTimer);
  entry.trailingTimer = setTimeout(() => {
    void fireCommit(bonsaiSid);
  }, AUTOSAVE_DEBOUNCE_MS);

  if (entry.maxWaitTimer === null) {
    entry.maxWaitTimer = setTimeout(() => {
      void fireCommit(bonsaiSid);
    }, AUTOSAVE_MAX_WAIT_MS);
  }

  timers.set(bonsaiSid, entry);
}

export function flush(bonsaiSid: string): Promise<void> {
  return fireCommit(bonsaiSid);
}

export function cancel(bonsaiSid: string): void {
  clearTimers(bonsaiSid);
}
