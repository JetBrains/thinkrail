import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  noteInput,
  flush,
  cancel,
  setCommitFn,
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
} from "../draftAutosave.ts";

describe("draftAutosave", () => {
  let commit: ReturnType<typeof vi.fn<(bonsaiSid: string) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    commit = vi.fn<(bonsaiSid: string) => void>();
    setCommitFn(commit);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires commit on the trailing timer 750 ms after the last noteInput", () => {
    noteInput("a");

    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(commit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("a");
  });

  it("re-arms the trailing timer on each noteInput", () => {
    noteInput("a");
    vi.advanceTimersByTime(500);
    noteInput("a");
    vi.advanceTimersByTime(500);
    // 1000 ms total elapsed, but only 500 ms since the last noteInput.
    expect(commit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("forces a commit via max-wait under continuous noteInput", () => {
    // Re-arm the trailing timer every 500 ms so it never fires on its own.
    for (let elapsed = 0; elapsed < AUTOSAVE_MAX_WAIT_MS; elapsed += 500) {
      noteInput("a");
      vi.advanceTimersByTime(500);
    }
    // ~5 s of sustained typing: the max-wait timer must have forced one commit.
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("a");
  });

  it("flush commits immediately and clears timers (no later duplicate)", async () => {
    noteInput("a");
    await flush("a");
    expect(commit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(AUTOSAVE_MAX_WAIT_MS * 2);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("flush returns the in-flight commit promise", async () => {
    let resolveCommit: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveCommit = resolve;
    });
    setCommitFn(() => pending);

    let settled = false;
    const flushed = flush("a").then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveCommit();
    await flushed;
    expect(settled).toBe(true);
  });

  it("cancel drops timers with no commit", () => {
    noteInput("a");
    cancel("a");

    vi.advanceTimersByTime(AUTOSAVE_MAX_WAIT_MS * 2);
    expect(commit).not.toHaveBeenCalled();
  });

  it("isolates timers per bonsaiSid", () => {
    noteInput("a");
    vi.advanceTimersByTime(500);
    noteInput("b");

    // Trailing fires for "a" at 750 ms; "b" was armed 250 ms later.
    vi.advanceTimersByTime(250);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith("a");

    vi.advanceTimersByTime(500);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith("b");
  });

  it("cancel of one id does not affect another", () => {
    noteInput("a");
    noteInput("b");
    cancel("a");

    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("b");
  });

  it("starts a fresh window after a trailing commit", () => {
    noteInput("a");
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    expect(commit).toHaveBeenCalledTimes(1);

    noteInput("a");
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
