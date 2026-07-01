// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TasksSection } from "../TasksSection.tsx";
import type { TaskSnapshot } from "@/hooks/useTaskSnapshot.ts";

afterEach(cleanup);

const snap: TaskSnapshot = {
  items: [
    { key: "1", content: "Alpha", status: "completed" },
    { key: "2", content: "Working beta", status: "in_progress" },
  ],
  done: 1,
  total: 2,
  activity: { toolName: "Edit", file: "x.ts", text: "Edit · x.ts" },
  running: true,
};

describe("TasksSection", () => {
  it("renders the section with the checklist", () => {
    const { getByText } = render(<TasksSection snapshot={snap} />);
    expect(getByText("Tasks")).toBeTruthy();
    expect(getByText("Alpha")).toBeTruthy();
    expect(getByText("Working beta")).toBeTruthy();
  });

  it("renders nothing when there are no tasks", () => {
    const empty: TaskSnapshot = { items: [], done: 0, total: 0, activity: null, running: false };
    const { container } = render(<TasksSection snapshot={empty} />);
    expect(container.firstChild).toBeNull();
  });
});
