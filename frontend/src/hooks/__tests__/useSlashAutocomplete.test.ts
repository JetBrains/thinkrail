// @vitest-environment jsdom
/**
 * Unit tests for `useSlashAutocomplete` and `extractSlashToken`.
 * Covers the bullets in design-doc §8.2:
 *   - extractSlashToken: start, after-whitespace, mid-URL (negative),
 *     mid-word (negative), caret-at-end vs caret-mid-token.
 *   - Filtering: empty query → all; substring → narrows.
 *   - Grouping: bonsai first, runtime second; dedup hides collisions.
 *   - Keyboard nav crosses group boundary; wraps.
 *   - acceptSelected: correct replacement range + caretAfter.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  extractSlashToken,
  useSlashAutocomplete,
} from "../useSlashAutocomplete.ts";
import { useSettingsStore, type RuntimeModels } from "@/store/settingsStore.ts";
import type { Skill } from "@/constants/skills.ts";
import type { RuntimeSkillInfo, RuntimeType } from "@/types/agent.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────

const BONSAI_SKILLS: Skill[] = [
  { id: "spec-status", icon: "S", name: "Status", description: "Show status", group: "Review" },
  { id: "spec-next", icon: "N", name: "Next", description: "Suggest next", group: "Review" },
  { id: "task-spec", icon: "T", name: "Task", description: "Task spec", group: "Creation" },
];

const RUNTIME_SKILLS: RuntimeSkillInfo[] = [
  { id: "review", name: "Review", description: "Review PR", source: "builtin" },
  { id: "init", name: "Init", description: "Init", source: "builtin" },
  // Will be deduped (collides with bonsai)
  { id: "spec-status", name: "Status (runtime)", description: "from runtime", source: "user" },
];

const CLAUDE_RUNTIME_META: RuntimeModels = {
  runtimeType: "claude",
  displayName: "Claude Code",
  models: [],
};

function seedStore({
  bonsai = BONSAI_SKILLS,
  runtimeSkills = RUNTIME_SKILLS,
  runtime = "claude" as RuntimeType,
  runtimeMeta = [CLAUDE_RUNTIME_META],
}: {
  bonsai?: Skill[];
  runtimeSkills?: RuntimeSkillInfo[];
  runtime?: RuntimeType;
  runtimeMeta?: RuntimeModels[];
} = {}) {
  useSettingsStore.setState({
    skills: bonsai,
    runtimes: runtimeMeta,
    runtimeSkills: new Map<RuntimeType, RuntimeSkillInfo[]>([[runtime, runtimeSkills]]),
  });
}

function fakeKey(key: string): ReactKeyboardEvent {
  // Minimal stand-in — only `key` and `preventDefault` are used by the hook.
  return {
    key,
    preventDefault: vi.fn(),
  } as unknown as ReactKeyboardEvent;
}

beforeEach(() => {
  useSettingsStore.setState({
    skills: [],
    runtimes: null,
    runtimeSkills: new Map(),
  });
});

// ── extractSlashToken ─────────────────────────────────────────────────────

describe("extractSlashToken", () => {
  it("matches a `/` at the very start of the text", () => {
    const t = extractSlashToken("/spec", 5);
    expect(t).toEqual({ start: 0, end: 5, query: "spec" });
  });

  it("matches a `/` right after whitespace", () => {
    const text = "hello /spec";
    const t = extractSlashToken(text, text.length);
    expect(t).toEqual({ start: 6, end: 11, query: "spec" });
  });

  it("matches a `/` right after a newline", () => {
    const text = "first line\n/spec";
    const t = extractSlashToken(text, text.length);
    expect(t).toEqual({ start: 11, end: 16, query: "spec" });
  });

  it("does NOT match a `/` inside a URL (preceded by non-whitespace)", () => {
    const text = "see https://example.com/path";
    // Caret somewhere inside `/path`
    expect(extractSlashToken(text, text.length)).toBeNull();
    expect(extractSlashToken(text, 24)).toBeNull();
  });

  it("does NOT match when the caret is mid-word with no leading `/`", () => {
    expect(extractSlashToken("hello world", 5)).toBeNull();
    expect(extractSlashToken("normalword", 4)).toBeNull();
  });

  it("returns null when caret is outside the active token", () => {
    const text = "abc /spec def";
    // Caret in `abc` (before the `/`)
    expect(extractSlashToken(text, 2)).toBeNull();
    // Caret in `def` (after the whitespace following the token)
    expect(extractSlashToken(text, 12)).toBeNull();
  });

  it("matches with the caret at the end of the token", () => {
    const text = "hi /spec";
    const t = extractSlashToken(text, 8);
    expect(t).toEqual({ start: 3, end: 8, query: "spec" });
  });

  it("matches with the caret in the middle of the token", () => {
    const text = "hi /spec-status more";
    // caret right after `/spe`
    const t = extractSlashToken(text, 7);
    expect(t).toEqual({ start: 3, end: 15, query: "spec-status" });
  });

  it("lowercases the query", () => {
    const t = extractSlashToken("/SPEC", 5);
    expect(t?.query).toBe("spec");
  });

  it("treats just `/` as an empty query (matches all)", () => {
    const t = extractSlashToken("/", 1);
    expect(t).toEqual({ start: 0, end: 1, query: "" });
  });

  it("returns null for out-of-range caret positions", () => {
    expect(extractSlashToken("/spec", -1)).toBeNull();
    expect(extractSlashToken("/spec", 6)).toBeNull();
  });
});

// ── useSlashAutocomplete ──────────────────────────────────────────────────

describe("useSlashAutocomplete", () => {
  const onInsert = vi.fn();

  beforeEach(() => {
    onInsert.mockClear();
    seedStore();
  });

  it("returns empty groups when the caret isn't on an active /token", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "hello", caret: 5, runtime: "claude", onInsert }),
    );
    expect(result.current.groups).toEqual([]);
    expect(result.current.flatItems).toEqual([]);
  });

  it("returns all suggestions when the query is empty (just `/`)", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/", caret: 1, runtime: "claude", onInsert }),
    );
    // Bonsai group has all 3 bonsai skills; runtime group has the 2 non-colliding ones.
    expect(result.current.groups.map((g) => g.label)).toEqual(["Bonsai", "Claude Code"]);
    expect(result.current.groups[0].items.map((i) => i.id)).toEqual([
      "spec-status",
      "spec-next",
      "task-spec",
    ]);
    expect(result.current.groups[1].items.map((i) => i.id)).toEqual(["review", "init"]);
  });

  it("substring-filters by the lowercased query in both groups", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/spec-st", caret: 8, runtime: "claude", onInsert }),
    );
    // Only one bonsai item matches "spec-st"; runtime section is hidden.
    expect(result.current.groups.map((g) => g.label)).toEqual(["Bonsai"]);
    expect(result.current.groups[0].items.map((i) => i.id)).toEqual(["spec-status"]);
  });

  it("substring-matches any position in the id (e.g. `spe` matches `task-spec`)", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/spe", caret: 4, runtime: "claude", onInsert }),
    );
    expect(result.current.groups.map((g) => g.label)).toEqual(["Bonsai"]);
    // All three bonsai ids contain "spe": spec-status, spec-next, task-spec.
    expect(result.current.groups[0].items.map((i) => i.id)).toEqual([
      "spec-status",
      "spec-next",
      "task-spec",
    ]);
  });

  it("dedupes runtime skills whose id collides with a bonsai id", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/", caret: 1, runtime: "claude", onInsert }),
    );
    const runtimeGroup = result.current.groups.find((g) => g.label === "Claude Code");
    const ids = runtimeGroup?.items.map((i) => i.id) ?? [];
    expect(ids).not.toContain("spec-status");
    expect(ids).toEqual(["review", "init"]);
  });

  it("orders flatItems with bonsai entries first, then runtime", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/", caret: 1, runtime: "claude", onInsert }),
    );
    expect(result.current.flatItems.map((i) => `${i.source}:${i.id}`)).toEqual([
      "bonsai:spec-status",
      "bonsai:spec-next",
      "bonsai:task-spec",
      "runtime:review",
      "runtime:init",
    ]);
  });

  it("omits the runtime section when its skill list is empty", () => {
    seedStore({ runtimeSkills: [] });
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/", caret: 1, runtime: "claude", onInsert }),
    );
    expect(result.current.groups.map((g) => g.label)).toEqual(["Bonsai"]);
  });

  it("falls back to the runtime type as label when no displayName is registered", () => {
    seedStore({ runtimeMeta: [] });
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/", caret: 1, runtime: "claude", onInsert }),
    );
    const labels = result.current.groups.map((g) => g.label);
    expect(labels).toContain("claude");
  });

  it("defaults to runtime=\"claude\" when undefined is passed", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/", caret: 1, runtime: undefined, onInsert }),
    );
    expect(result.current.groups.map((g) => g.label)).toEqual(["Bonsai", "Claude Code"]);
  });

  it("ArrowDown wraps across the section boundary then back to the start", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/", caret: 1, runtime: "claude", onInsert }),
    );
    // flatItems = [3 bonsai, 2 runtime] = 5 items total.
    expect(result.current.flatItems).toHaveLength(5);
    expect(result.current.selectedIndex).toBe(0);

    // Walk down: 0 → 1 → 2 → (cross into runtime) 3 → 4 → (wrap) 0
    for (const expected of [1, 2, 3, 4, 0]) {
      act(() => {
        result.current.onKeyDown(fakeKey("ArrowDown"));
      });
      expect(result.current.selectedIndex).toBe(expected);
    }
  });

  it("ArrowUp wraps from the start back to the last item", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/", caret: 1, runtime: "claude", onInsert }),
    );
    expect(result.current.selectedIndex).toBe(0);
    act(() => {
      result.current.onKeyDown(fakeKey("ArrowUp"));
    });
    expect(result.current.selectedIndex).toBe(4); // last of 5
  });

  it("onKeyDown returns true only when the popup is open and the key is consumed", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/", caret: 1, runtime: "claude", onInsert }),
    );
    expect(result.current.onKeyDown(fakeKey("ArrowDown"))).toBe(true);
    expect(result.current.onKeyDown(fakeKey("x"))).toBe(false); // unhandled key
  });

  it("onKeyDown returns false when the popup is closed", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "hello", caret: 5, runtime: "claude", onInsert }),
    );
    expect(result.current.onKeyDown(fakeKey("ArrowDown"))).toBe(false);
  });

  it("acceptSelected emits the correct replacement range and caretAfter", () => {
    // Mid-textarea token: "abc /spec def"  (token is at [4, 9))
    const text = "abc /spec def";
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text, caret: 9, runtime: "claude", onInsert }),
    );
    expect(result.current.selectedIndex).toBe(0);
    expect(result.current.flatItems[0].id).toBe("spec-status");

    act(() => {
      result.current.acceptSelected();
    });

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith({
      start: 4,
      end: 9,
      replacement: "/spec-status ",
      caretAfter: 4 + "/spec-status ".length, // 4 + 13 = 17
    });
    // Hook closes itself after accept.
    expect(result.current.groups).toEqual([]);
  });

  it("Tab and Enter both trigger acceptSelected", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({
        text: "/spec",
        caret: 5,
        runtime: "claude",
        onInsert,
      }),
    );

    act(() => {
      result.current.onKeyDown(fakeKey("Tab"));
    });
    expect(onInsert).toHaveBeenCalledTimes(1);

    // Re-open the popup imperatively (rerender with the same props doesn't
    // re-run the sync effect because the deps are unchanged).
    act(() => {
      result.current.onTextChange("/spec", 5);
    });
    act(() => {
      result.current.onKeyDown(fakeKey("Enter"));
    });
    expect(onInsert).toHaveBeenCalledTimes(2);
  });

  it("Escape closes the popup", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/", caret: 1, runtime: "claude", onInsert }),
    );
    expect(result.current.groups.length).toBeGreaterThan(0);
    act(() => {
      result.current.onKeyDown(fakeKey("Escape"));
    });
    expect(result.current.groups).toEqual([]);
  });

  it("recomputes the token when text/caret props change", () => {
    const { result, rerender } = renderHook(
      (props: { text: string; caret: number }) =>
        useSlashAutocomplete({
          text: props.text,
          caret: props.caret,
          runtime: "claude",
          onInsert,
        }),
      { initialProps: { text: "hello", caret: 5 } },
    );
    expect(result.current.groups).toEqual([]);

    rerender({ text: "hello /spec", caret: "hello /spec".length });
    expect(result.current.groups.length).toBeGreaterThan(0);
    expect(result.current.flatItems.map((i) => i.id)).toContain("spec-status");
  });

  it("onTextChange recomputes the token imperatively", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "hello", caret: 5, runtime: "claude", onInsert }),
    );
    expect(result.current.groups).toEqual([]);

    act(() => {
      result.current.onTextChange("hello /spec", "hello /spec".length);
    });
    expect(result.current.groups.length).toBeGreaterThan(0);
  });

  it("clamps selectedIndex when the filtered list shrinks", () => {
    const { result, rerender } = renderHook(
      (props: { text: string; caret: number }) =>
        useSlashAutocomplete({
          text: props.text,
          caret: props.caret,
          runtime: "claude",
          onInsert,
        }),
      { initialProps: { text: "/", caret: 1 } },
    );
    // Move selection to the 5th item (index 4) — last in the union.
    act(() => {
      result.current.setSelectedIndex(4);
    });
    expect(result.current.selectedIndex).toBe(4);

    // Narrow to "spec-st" — only `spec-status` matches, so index 4 is OOR.
    rerender({ text: "/spec-st", caret: 8 });
    expect(result.current.flatItems.length).toBe(1);
    expect(result.current.selectedIndex).toBe(0);
  });

  it("close() empties the groups and resets the selection", () => {
    const { result } = renderHook(() =>
      useSlashAutocomplete({ text: "/", caret: 1, runtime: "claude", onInsert }),
    );
    act(() => {
      result.current.setSelectedIndex(2);
      result.current.close();
    });
    expect(result.current.groups).toEqual([]);
    expect(result.current.flatItems).toEqual([]);
    expect(result.current.selectedIndex).toBe(0);
  });
});
