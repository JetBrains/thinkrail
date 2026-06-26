// @vitest-environment jsdom
/**
 * The model picker must be locked while a turn is in flight (Running/Waiting).
 * Switching the model mid-turn that needs a restart blocks `session/restart` on
 * the draining turn and trips the 30s RPC timeout — so we only allow a switch
 * when the session is idle (where the restart is near-instant). Permission mode
 * (live) and effort (staged) stay usable; only the model picker is gated.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { SessionStatusLine } from "../SessionStatusLine.tsx";
import { useRuntimeCapsStore } from "@/store/runtimeCapsStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { SessionStatus } from "@/constants/status.ts";
import type { SessionMetrics } from "@/types/session.ts";
import type { RuntimeCapabilities } from "@/types/rpc-methods.ts";

const CAPS: RuntimeCapabilities = {
  permissionModes: [{ value: "default", label: "default" }],
  effortLevels: [
    { value: "auto", label: "auto" },
    { value: "high", label: "high" },
  ],
  models: [
    { value: "claude-opus-4-8", label: "Opus 4.8" },
    { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  ],
  flags: [],
  modelCapabilities: [
    { model: "claude-opus-4-8", effortLevels: ["auto", "high"], flags: [] },
    { model: "claude-sonnet-4-6", effortLevels: ["auto", "high"], flags: [] },
  ],
};

// contextMax: 0 skips the context-bar block (which reads metrics.contextUsage),
// so we don't need a full ContextUsage fixture here.
const METRICS = {
  costUsd: 0,
  turns: 0,
  toolCalls: 0,
  contextTokens: 0,
  contextMax: 0,
  durationMs: 0,
  filesChanged: {},
} as SessionMetrics;

function renderLine(status: SessionStatus) {
  return render(
    <SessionStatusLine
      model="claude-opus-4-8"
      permissionMode="default"
      effort="high"
      metrics={METRICS}
      status={status}
      disabled={false}
      onChangeModel={() => {}}
      onChangePermissionMode={() => {}}
    />,
  );
}

const modelBtn = () => screen.getByRole("button", { name: /Opus 4\.8/ }) as HTMLButtonElement;
const permBtn = () => screen.getByRole("button", { name: /^default$/ }) as HTMLButtonElement;

beforeEach(() => {
  useRuntimeCapsStore.setState({ capsByRuntime: { claude: CAPS } } as never);
  useUiStore.setState({
    chatCategoryVisibility: { dialog: true, tools: true, system: true },
  } as never);
});

afterEach(() => cleanup());

describe("SessionStatusLine — model picker gating during a turn", () => {
  it("locks the model picker while Running", () => {
    renderLine(SessionStatus.Running);
    expect(modelBtn().disabled).toBe(true);
  });

  it("locks the model picker while Waiting (mid-turn tool/permission)", () => {
    renderLine(SessionStatus.Waiting);
    expect(modelBtn().disabled).toBe(true);
  });

  it("allows the model picker when Idle", () => {
    renderLine(SessionStatus.Idle);
    expect(modelBtn().disabled).toBe(false);
  });

  it("keeps the permission picker usable while Running (lock is model-only)", () => {
    renderLine(SessionStatus.Running);
    expect(permBtn().disabled).toBe(false);
  });
});
