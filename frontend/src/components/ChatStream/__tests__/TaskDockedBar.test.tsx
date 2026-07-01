// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { TaskDockedBar, shouldShowDockedBar } from "../TaskDockedBar.tsx";
import type { TaskSnapshot } from "@/hooks/useTaskSnapshot.ts";

afterEach(cleanup);

const snap: TaskSnapshot = {
  items: [
    { key: "1", content: "Alpha", status: "completed" },
    { key: "2", content: "Working beta", status: "in_progress" },
    { key: "3", content: "Gamma", status: "pending" },
  ],
  done: 1,
  total: 3,
  activity: { toolName: "Edit", file: "ChatStream.tsx", text: "Edit · ChatStream.tsx" },
  running: true,
};

describe("shouldShowDockedBar", () => {
  it("shows only when running, has tasks, and the anchor is off-screen", () => {
    expect(shouldShowDockedBar({ running: true, total: 3, anchorVisible: false })).toBe(true);
    expect(shouldShowDockedBar({ running: true, total: 3, anchorVisible: true })).toBe(false);
    expect(shouldShowDockedBar({ running: false, total: 3, anchorVisible: false })).toBe(false);
    expect(shouldShowDockedBar({ running: true, total: 0, anchorVisible: false })).toBe(false);
  });
});

describe("TaskDockedBar", () => {
  it("renders progress and activity", () => {
    const { getByText } = render(<TaskDockedBar snapshot={snap} />);
    expect(getByText("1 / 3")).toBeTruthy();
    expect(getByText("Edit · ChatStream.tsx")).toBeTruthy();
  });

  it("toggles the inline popover with the full checklist", () => {
    const { getByText, queryByText } = render(<TaskDockedBar snapshot={snap} />);
    expect(queryByText("Gamma")).toBeNull();
    fireEvent.click(getByText("full list"));
    expect(getByText("Gamma")).toBeTruthy();
  });
});
