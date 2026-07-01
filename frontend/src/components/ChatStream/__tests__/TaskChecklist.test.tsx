// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TaskChecklist } from "../TaskChecklist.tsx";

describe("TaskChecklist", () => {
  it("renders one row per item with the label", () => {
    const { getByText, container } = render(
      <TaskChecklist items={[
        { key: "1", label: "Alpha", status: "completed" },
        { key: "2", label: "Beta", status: "in_progress" },
      ]} />,
    );
    expect(getByText("Alpha")).toBeTruthy();
    expect(getByText("Beta")).toBeTruthy();
    expect(container.querySelectorAll(".task-item").length).toBe(2);
  });

  it("marks completed rows with the completed modifier", () => {
    const { container } = render(<TaskChecklist items={[{ key: "1", label: "Done it", status: "completed" }]} />);
    expect(container.querySelector(".task-item--completed")).toBeTruthy();
  });
});
