import { describe, it, expect } from "vitest";
import { findStaleSpecIds, isSkillValid, findStaleSessionIds } from "../staleRefs.ts";

describe("findStaleSpecIds", () => {
  const liveSpecs = [
    { id: "spec-a", type: "module", path: "a", title: "A", status: "active", covers: [], tags: [], created: "", updated: "" },
    { id: "spec-b", type: "module", path: "b", title: "B", status: "active", covers: [], tags: [], created: "", updated: "" },
  ];

  it("returns empty array when all IDs exist", () => {
    expect(findStaleSpecIds(["spec-a", "spec-b"], liveSpecs)).toEqual([]);
  });

  it("returns stale IDs that do not exist in live specs", () => {
    expect(findStaleSpecIds(["spec-a", "spec-c", "spec-d"], liveSpecs)).toEqual(["spec-c", "spec-d"]);
  });

  it("returns empty array for empty input", () => {
    expect(findStaleSpecIds([], liveSpecs)).toEqual([]);
  });

  it("returns all IDs when live specs is empty", () => {
    expect(findStaleSpecIds(["spec-a"], [])).toEqual(["spec-a"]);
  });
});

describe("isSkillValid", () => {
  const skills = [
    { id: "module-design", icon: "", name: "Module Design", description: "", group: "Creation" },
    { id: "task-spec", icon: "", name: "Task Spec", description: "", group: "Creation" },
  ];

  it("returns true for null skill", () => {
    expect(isSkillValid(null, skills)).toBe(true);
  });

  it("returns true for known skill", () => {
    expect(isSkillValid("module-design", skills)).toBe(true);
  });

  it("returns false for unknown skill", () => {
    expect(isSkillValid("nonexistent-skill", skills)).toBe(false);
  });
});

describe("findStaleSessionIds", () => {
  it("returns empty array when all sessions exist", () => {
    const liveSids = new Set(["s1", "s2"]);
    expect(findStaleSessionIds(["s1", "s2"], liveSids)).toEqual([]);
  });

  it("returns stale session IDs", () => {
    const liveSids = new Set(["s1"]);
    expect(findStaleSessionIds(["s1", "s2", "s3"], liveSids)).toEqual(["s2", "s3"]);
  });

  it("returns empty for empty input", () => {
    expect(findStaleSessionIds([], new Set())).toEqual([]);
  });
});
