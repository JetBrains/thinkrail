// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TaskActivityLine } from "../TaskActivityLine.tsx";

describe("TaskActivityLine", () => {
  it("renders the activity text", () => {
    const { getByText } = render(<TaskActivityLine activity={{ toolName: "Edit", file: "a.ts", text: "Edit · a.ts" }} />);
    expect(getByText("Edit · a.ts")).toBeTruthy();
  });

  it("renders nothing when activity is null", () => {
    const { container } = render(<TaskActivityLine activity={null} />);
    expect(container.firstChild).toBeNull();
  });
});
