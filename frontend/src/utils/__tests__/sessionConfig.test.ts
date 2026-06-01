import { describe, it, expect, beforeEach } from "vitest";
import { buildDefaultSessionConfig } from "../sessionConfig.ts";
import { useSettingsStore } from "@/store/settingsStore.ts";

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
      },
    });

    const cfg = await buildDefaultSessionConfig();
    expect(cfg.model).toBe("claude-haiku-4-5");
    expect(cfg.effort).toBe("low");
    expect(cfg.permissionMode).toBe("acceptEdits");
    expect(cfg.streamText).toBe(true);
  });

  it("passes effort='auto' through (the neutral default)", async () => {
    useSettingsStore.setState({
      sessionDefaults: {
        model: "claude-opus-4-7",
        permissionMode: "default",
        effort: "auto",
      },
    });
    const cfg = await buildDefaultSessionConfig();
    expect(cfg.effort).toBe("auto");
  });

  it("carries runtime flags into the draft config", async () => {
    useSettingsStore.setState({
      sessionDefaults: {
        model: "claude-opus-4-8",
        permissionMode: "default",
        effort: "auto",
        flags: { context1m: false },
      },
    });
    const cfg = await buildDefaultSessionConfig();
    expect(cfg.flags).toEqual({ context1m: false });
  });

  it("defaults flags to an empty object when absent", async () => {
    useSettingsStore.setState({
      sessionDefaults: {
        model: "claude-opus-4-8",
        permissionMode: "default",
        effort: "auto",
      },
    });
    const cfg = await buildDefaultSessionConfig();
    expect(cfg.flags).toEqual({});
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
