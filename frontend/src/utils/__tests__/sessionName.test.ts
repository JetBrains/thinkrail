import { describe, it, expect } from "vitest";
import {
  deriveSessionName,
  nonWs,
  resolveDraftName,
  DEFAULT_SESSION_NAME,
  NAME_MAX,
  SAVE_THRESHOLD,
} from "../sessionName.ts";

describe("deriveSessionName", () => {
  it("returns short input (≤ NAME_MAX) as-is", () => {
    expect(deriveSessionName("fix login")).toBe("fix login");
  });

  it("returns exactly NAME_MAX chars as-is", () => {
    const fifteen = "Refactor stores"; // 15 chars
    expect(fifteen.length).toBe(NAME_MAX);
    expect(deriveSessionName(fifteen)).toBe(fifteen);
  });

  it("truncates >NAME_MAX to first 14 chars + ellipsis", () => {
    expect(deriveSessionName("Refactor   the\nsession store")).toBe(
      "Refactor the s…",
    );
  });

  it("keeps the label ≤ NAME_MAX including the ellipsis", () => {
    const out = deriveSessionName("a".repeat(100));
    expect(out.length).toBe(NAME_MAX);
    expect(out.endsWith("…")).toBe(true);
  });

  it("collapses internal whitespace/newline runs to single spaces", () => {
    expect(deriveSessionName("a\t\n  b")).toBe("a b");
  });

  it("trims leading/trailing whitespace", () => {
    expect(deriveSessionName("   hello   ")).toBe("hello");
  });

  it("returns DEFAULT_SESSION_NAME for empty input", () => {
    expect(deriveSessionName("")).toBe(DEFAULT_SESSION_NAME);
  });

  it("returns DEFAULT_SESSION_NAME for whitespace-only input", () => {
    expect(deriveSessionName("   \n\t  ")).toBe(DEFAULT_SESSION_NAME);
  });
});

describe("resolveDraftName", () => {
  it("keeps a manual rename that differs from the derived name and freezes derivation", () => {
    expect(resolveDraftName("WIP", "fix the login flow")).toEqual({
      name: "WIP",
      nameManuallySet: true,
    });
  });

  it("derives when the persisted name equals what derivation would produce", () => {
    const derived = deriveSessionName("fix the login flow");
    expect(resolveDraftName(derived, "fix the login flow")).toEqual({
      name: derived,
      nameManuallySet: false,
    });
  });

  it("derives when the persisted name is the default", () => {
    expect(resolveDraftName(DEFAULT_SESSION_NAME, "fix the login flow")).toEqual({
      name: deriveSessionName("fix the login flow"),
      nameManuallySet: false,
    });
  });

  it("derives when there is no persisted name", () => {
    expect(resolveDraftName(null, "fix the login flow")).toEqual({
      name: deriveSessionName("fix the login flow"),
      nameManuallySet: false,
    });
  });
});

describe("nonWs", () => {
  it("counts non-whitespace characters only", () => {
    expect(nonWs("a b\tc\nd")).toBe(4);
  });

  it("returns 0 for whitespace-only input", () => {
    expect(nonWs("  \n\t ")).toBe(0);
  });

  it("SAVE_THRESHOLD is 5", () => {
    expect(SAVE_THRESHOLD).toBe(5);
  });
});
