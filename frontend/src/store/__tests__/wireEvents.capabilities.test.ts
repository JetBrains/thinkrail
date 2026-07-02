import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchCapabilities = vi.fn();
vi.mock("@/store/runtimeCapsStore.ts", () => ({
  useRuntimeCapsStore: { getState: () => ({ fetchCapabilities }) },
}));

import { wireEvents } from "@/store/wireEvents.ts";

describe("wireEvents — capabilitiesChanged", () => {
  beforeEach(() => {
    fetchCapabilities.mockClear();
  });

  it("re-fetches the named runtime's capabilities", () => {
    // wireEvents(client) registers handlers on the PASSED client — capture them.
    const handlers = new Map<string, (p: unknown) => void>();
    const fakeClient = {
      on: (method: string, h: (p: unknown) => void) => {
        handlers.set(method, h);
        return () => handlers.delete(method);
      },
    };
    wireEvents(fakeClient as never);
    const handler = handlers.get("runtimes/capabilitiesChanged");
    expect(handler).toBeTypeOf("function");
    handler!({ runtimeType: "claude" });
    expect(fetchCapabilities).toHaveBeenCalledWith("claude");
  });
});
