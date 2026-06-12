// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Capture the props passed to RpcProvider so we can inspect the WS URL.
const rpcProviderCalls = vi.hoisted(() => [] as { url: string }[]);

vi.mock("@/api/index.ts", () => ({
  RpcProvider: ({ url, children }: { url: string; children: React.ReactNode }) => {
    rpcProviderCalls.push({ url });
    return <div data-testid="rpc-provider">{children}</div>;
  },
}));

// Stub App so it doesn't pull half the codebase into the test runtime.
vi.mock("../App.tsx", () => ({
  App: ({ projectPath }: { projectPath: string }) => (
    <div data-testid="app">app-{projectPath}</div>
  ),
}));

// ProjectPicker stub — kept minimal but recognizable.
vi.mock("@/components/ProjectPicker/ProjectPicker.tsx", () => ({
  ProjectPicker: () => <div data-testid="project-picker">picker</div>,
}));

// serverInfoStore.fetchInfo() runs in an effect — stub to a no-op.
vi.mock("@/store/serverInfoStore.ts", () => ({
  useServerInfoStore: {
    getState: () => ({ fetchInfo: vi.fn() }),
  },
}));

// fileStore / sessionStore / uiStore are touched by handleSelect; not exercised
// in these tests but the imports must resolve.
vi.mock("@/store/fileStore.ts", () => ({
  useFileStore: { getState: () => ({ unload: vi.fn() }) },
}));
vi.mock("@/store/sessionStore.ts", () => ({
  useSessionStore: { getState: () => ({ unload: vi.fn() }) },
}));
vi.mock("@/store/uiStore.ts", () => ({
  useUiStore: { getState: () => ({ setProjectState: vi.fn() }) },
}));

// Import Root after the mocks are registered. Root.tsx has no module-level
// side effects (no createRoot mount), so we can import it cleanly.
import { Root } from "../Root.tsx";

describe("Root", () => {
  beforeEach(() => {
    rpcProviderCalls.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders ProjectPicker synchronously at the root path", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Root />
      </MemoryRouter>,
    );
    // No null/loading detour — picker is in the DOM on first render.
    expect(container.querySelector('[data-testid="project-picker"]')).not.toBeNull();
    // No login/setup screens (those modules are deleted; this asserts the new flow).
    expect(container.querySelector('[data-testid="rpc-provider"]')).toBeNull();
  });

  it("WS URL has no token segment when entering a workspace route", () => {
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: "/my-project/workspace", state: { projectPath: "/tmp/my-project" } },
        ]}
      >
        <Root />
      </MemoryRouter>,
    );
    expect(rpcProviderCalls.length).toBeGreaterThan(0);
    const { url } = rpcProviderCalls[0];
    expect(url).toMatch(/^ws(s)?:\/\/.+\/ws\?project=.+$/);
    expect(url).not.toContain("&token=");
    expect(url).not.toContain("?token=");
  });

  it("does not read thinkrail_token from localStorage on mount", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Root />
      </MemoryRouter>,
    );
    const tokenReads = getItemSpy.mock.calls.filter(
      (args) => args[0] === "thinkrail_token",
    );
    expect(tokenReads).toHaveLength(0);
  });
});
