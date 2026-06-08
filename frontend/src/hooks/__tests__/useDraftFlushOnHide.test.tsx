// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const { flush, getActiveSessionId } = vi.hoisted(() => {
  let activeSessionId: string | null = null;
  return {
    flush: vi.fn(() => Promise.resolve()),
    getActiveSessionId: {
      get: () => activeSessionId,
      set: (v: string | null) => {
        activeSessionId = v;
      },
    },
  };
});

vi.mock("@/store/draftAutosave.ts", () => ({ flush }));
vi.mock("@/store/sessionStore.ts", () => ({
  useSessionStore: { getState: () => ({ activeSessionId: getActiveSessionId.get() }) },
}));

import { useDraftFlushOnHide } from "../useDraftFlushOnHide.ts";

function Harness() {
  useDraftFlushOnHide();
  return null;
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  flush.mockClear();
  getActiveSessionId.set("sid-1");
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
});

describe("useDraftFlushOnHide", () => {
  it("flushes the active draft on visibilitychange→hidden", () => {
    render(<Harness />);

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("sid-1");
  });

  it("does NOT flush on visibilitychange→visible", () => {
    render(<Harness />);

    act(() => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(flush).not.toHaveBeenCalled();
  });

  it("flushes the active draft on pagehide", () => {
    render(<Harness />);

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("sid-1");
  });

  it("is a no-op when there is no active session", () => {
    getActiveSessionId.set(null);
    render(<Harness />);

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(flush).not.toHaveBeenCalled();
  });

  it("removes both listeners on unmount (no leak)", () => {
    const { unmount } = render(<Harness />);
    unmount();

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(flush).not.toHaveBeenCalled();
  });
});
