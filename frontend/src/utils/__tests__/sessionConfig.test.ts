import { describe, it, expect, beforeEach } from "vitest";
import { buildDefaultSessionConfig, PERMISSION_MODES } from "../sessionConfig.ts";
import { useSettingsStore } from "@/store/settingsStore.ts";

describe("PERMISSION_MODES", () => {
  it("matches the agent-side enum exactly", () => {
    expect(PERMISSION_MODES).toEqual([
      "default",
      "acceptEdits",
      "bypassPermissions",
      "plan",
    ]);
  });
});

describe("buildDefaultSessionConfig", () => {
  beforeEach(() => {
    useSettingsStore.setState({ sessionDefaults: null });
  });

  it("returns the user-scoped sessionDefaults verbatim when present", async () => {
    useSettingsStore.setState({
      sessionDefaults: {
        model: "claude-haiku-4-5",
        permissionMode: "acceptEdits",
        effort: "low",
        maxTurns: 20,
      },
    });

    const cfg = await buildDefaultSessionConfig();
    expect(cfg.model).toBe("claude-haiku-4-5");
    expect(cfg.effort).toBe("low");
    expect(cfg.permissionMode).toBe("acceptEdits");
    expect(cfg.maxTurns).toBe(20);
    expect(cfg.streamText).toBe(true);
  });

  it("passes effort=null through (the 'auto' state)", async () => {
    useSettingsStore.setState({
      sessionDefaults: {
        model: "claude-opus-4-7",
        permissionMode: "default",
        effort: null,
        maxTurns: 50,
      },
    });
    const cfg = await buildDefaultSessionConfig();
    expect(cfg.effort).toBeNull();
  });

  it("throws when the backend fetch resolves to null", async () => {
    // No client wired in the test harness → fetchSessionDefaults will
    // throw internally and leave the store at ``null``. The helper has
    // no frontend fallback, so it must surface this rather than silently
    // produce a guessed config.
    await expect(buildDefaultSessionConfig()).rejects.toThrow(
      /Session defaults unavailable/i,
    );
  });
});
