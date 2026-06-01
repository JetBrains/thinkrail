/**
 * `useSlashAutocomplete` — slash-command autocomplete hook for the chat
 * composer.
 *
 * Implements the mid-input trigger + grouped (Bonsai + active runtime)
 * suggestions described in
 * `.bonsai/runtime-skills-autocomplete/design-doc.md` §6.1–6.4.
 *
 * Responsibilities:
 *  - Detect the active `/token` at the caret (§6.2).
 *  - Build two groups — Bonsai first, runtime second — with dedup so
 *    Bonsai's skill ids win over any colliding runtime skill (§6.3).
 *  - Expose keyboard navigation that wraps across the group boundary
 *    and inserts the chosen suggestion at the caret (§6.4).
 *
 * The hook is intentionally storage-agnostic on the consumer side: it
 * reads bonsai skills + per-runtime skill caches from `useSettingsStore`
 * and only asks the caller for `text`, `caret`, `runtime`, and an
 * `onInsert` callback.
 */

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSettingsStore } from "@/store/settingsStore.ts";
import { useRuntimeCapsStore } from "@/store/runtimeCapsStore.ts";
import type { Skill } from "@/constants/skills.ts";
import type { RuntimeSkillInfo, RuntimeType } from "@/types/agent.ts";

// ─── Public interfaces — verbatim from design doc §6.1 ───────────────────────

export interface SkillSuggestion {
  id: string;
  name: string;
  description: string;
  icon?: string;
  source: "bonsai" | "runtime";
}

export interface SuggestionGroup {
  /** "Bonsai" or the runtime's displayName (e.g. "Claude Code"). */
  label: string;
  items: SkillSuggestion[];
}

export interface UseSlashAutocompleteResult {
  /** Empty when the popup is closed (no active /token at caret). */
  groups: SuggestionGroup[];
  /** Bonsai items first, then runtime items — same order keyboard nav uses. */
  flatItems: SkillSuggestion[];
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  close: () => void;
  /** Apply the highlighted suggestion via the caller's `onInsert`. */
  acceptSelected: () => void;
  /**
   * Convenience handler for the caller's textarea — re-runs token
   * extraction with the supplied text/caret. The hook also recomputes
   * whenever `opts.text` / `opts.caret` change, so wiring this is
   * optional.
   */
  onTextChange: (text: string, caret: number) => void;
  /** Returns `true` when the event was consumed (caller should not propagate). */
  onKeyDown: (e: React.KeyboardEvent) => boolean;
}

export interface UseSlashAutocompleteOpts {
  text: string;
  caret: number;
  /** Hook defaults to "claude" if undefined (see design doc §6.5). */
  runtime: RuntimeType | undefined;
  onInsert: (payload: {
    start: number;
    end: number;
    replacement: string;
    caretAfter: number;
  }) => void;
}

// ─── Token extraction (design doc §6.2) ──────────────────────────────────────

const WHITESPACE_RE = /[ \t\n\r]/;

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && WHITESPACE_RE.test(ch);
}

export interface SlashToken {
  /** Index of the leading `/` in `text`. */
  start: number;
  /** Exclusive end — first whitespace/newline after the token, or `text.length`. */
  end: number;
  /** Lowercased query (i.e. `token.slice(1).toLowerCase()`). */
  query: string;
}

/**
 * Returns the active /token under the caret, or `null` if the caret isn't
 * inside one.
 *
 * A `/` is *active* iff its preceding character is whitespace, newline, or
 * the start of the text. The token extends from that `/` up to (but not
 * including) the next whitespace/newline or end-of-text.
 */
export function extractSlashToken(text: string, caretPos: number): SlashToken | null {
  if (caretPos < 0 || caretPos > text.length) return null;

  // Walk backwards from the caret to the start of the contiguous
  // non-whitespace run. The active `/` (if any) must sit at the leading
  // edge of that run.
  let i = caretPos;
  while (i > 0 && !isWhitespace(text[i - 1])) {
    i--;
  }
  if (i >= text.length || text[i] !== "/") return null;

  const start = i;
  let end = start;
  while (end < text.length && !isWhitespace(text[end])) {
    end++;
  }

  // Caret must lie inside `[start, end]` (inclusive at both ends so the
  // popup stays open when the caret is at the trailing edge of the token).
  if (caretPos < start || caretPos > end) return null;

  const query = text.slice(start + 1, end).toLowerCase();
  return { start, end, query };
}

// ─── Filtering, grouping, dedup (design doc §6.3) ────────────────────────────

function filterByQuery<T extends { id: string }>(items: readonly T[], query: string): T[] {
  if (query.length === 0) return [...items];
  return items.filter((s) => s.id.toLowerCase().includes(query));
}

function bonsaiSkillToSuggestion(s: Skill): SkillSuggestion {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    icon: s.icon,
    source: "bonsai",
  };
}

function runtimeSkillToSuggestion(s: RuntimeSkillInfo): SkillSuggestion {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    source: "runtime",
  };
}

// ─── Hook implementation ─────────────────────────────────────────────────────

const DEFAULT_RUNTIME: RuntimeType = "claude";
const BONSAI_LABEL = "Bonsai";

export function useSlashAutocomplete(
  opts: UseSlashAutocompleteOpts,
): UseSlashAutocompleteResult {
  const { text, caret, runtime, onInsert } = opts;
  const effectiveRuntime: RuntimeType = runtime ?? DEFAULT_RUNTIME;

  // Subscribe to the bonsai skills + per-runtime skill cache + runtime
  // metadata. Using selectors keeps re-renders narrow.
  const bonsaiSkills = useSettingsStore((s) => s.skills);
  const runtimeSkillsMap = useSettingsStore((s) => s.runtimeSkills);
  const runtimes = useRuntimeCapsStore((s) => s.runtimes);

  const runtimeDisplayName = useMemo(() => {
    const entry = runtimes?.find((r) => r.runtimeType === effectiveRuntime);
    return entry?.displayName ?? effectiveRuntime;
  }, [runtimes, effectiveRuntime]);

  const runtimeSkills = useMemo<readonly RuntimeSkillInfo[]>(() => {
    return runtimeSkillsMap?.get(effectiveRuntime) ?? [];
  }, [runtimeSkillsMap, effectiveRuntime]);

  // The active /token under the caret. Recomputes on every text/caret
  // change (and when `onTextChange` is called explicitly).
  const [token, setToken] = useState<SlashToken | null>(() =>
    extractSlashToken(text, caret),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Keep `token` in sync with `text` / `caret` props.
  useEffect(() => {
    setToken(extractSlashToken(text, caret));
  }, [text, caret]);

  // Build groups + flatItems whenever the token or its inputs change.
  const { groups, flatItems } = useMemo(() => {
    if (token === null) {
      return { groups: [] as SuggestionGroup[], flatItems: [] as SkillSuggestion[] };
    }

    const query = token.query;
    const bonsaiIds = new Set(bonsaiSkills.map((s) => s.id));
    const runtimeDeduped = runtimeSkills.filter((s) => !bonsaiIds.has(s.id));

    const bonsaiItems = filterByQuery(bonsaiSkills, query).map(bonsaiSkillToSuggestion);
    const runtimeItems = filterByQuery(runtimeDeduped, query).map(runtimeSkillToSuggestion);

    const built: SuggestionGroup[] = [];
    if (bonsaiItems.length > 0) {
      built.push({ label: BONSAI_LABEL, items: bonsaiItems });
    }
    if (runtimeItems.length > 0) {
      built.push({ label: runtimeDisplayName, items: runtimeItems });
    }
    const flat = built.flatMap((g) => g.items);
    return { groups: built, flatItems: flat };
  }, [token, bonsaiSkills, runtimeSkills, runtimeDisplayName]);

  // Clamp selectedIndex when the result set shrinks (e.g. user narrows
  // the query mid-typing).
  useEffect(() => {
    if (flatItems.length === 0) {
      if (selectedIndex !== 0) setSelectedIndex(0);
      return;
    }
    if (selectedIndex >= flatItems.length) {
      setSelectedIndex(0);
    }
  }, [flatItems.length, selectedIndex]);

  const close = useCallback(() => {
    setToken(null);
    setSelectedIndex(0);
  }, []);

  const acceptSelected = useCallback(() => {
    if (token === null || flatItems.length === 0) return;
    const idx = Math.min(Math.max(selectedIndex, 0), flatItems.length - 1);
    const chosen = flatItems[idx];
    const replacement = `/${chosen.id} `;
    onInsert({
      start: token.start,
      end: token.end,
      replacement,
      caretAfter: token.start + replacement.length,
    });
    setToken(null);
    setSelectedIndex(0);
  }, [token, flatItems, selectedIndex, onInsert]);

  const onTextChange = useCallback((nextText: string, nextCaret: number) => {
    setToken(extractSlashToken(nextText, nextCaret));
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (token === null || flatItems.length === 0) return false;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % flatItems.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + flatItems.length) % flatItems.length);
        return true;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        acceptSelected();
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return true;
      }
      return false;
    },
    [token, flatItems.length, acceptSelected, close],
  );

  return {
    groups,
    flatItems,
    selectedIndex,
    setSelectedIndex,
    close,
    acceptSelected,
    onTextChange,
    onKeyDown,
  };
}
