// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SessionSubRow } from "../SessionSubRow.tsx";

afterEach(cleanup);

// Mock stores at module level
vi.mock("@/store/sessionStore.ts", () => ({
  useSessionStore: vi.fn(),
}));

vi.mock("@/store/ticketRouteStore.ts", () => ({
  useTicketRouteStore: vi.fn(),
}));

import { useSessionStore } from "@/store/sessionStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";

const useSessionStoreMock = useSessionStore as unknown as ReturnType<typeof vi.fn>;
const useTicketRouteStoreMock = useTicketRouteStore as unknown as ReturnType<typeof vi.fn>;

const SID = "abcdef1234567890";

function renderRow(props: Partial<Parameters<typeof SessionSubRow>[0]> = {}) {
  return render(
    <SessionSubRow
      sid={SID}
      depth={1}
      ancestors={[false]}
      isActive={false}
      onFocusSession={vi.fn()}
      onOpenFile={vi.fn()}
      {...props}
    />,
  );
}

describe("SessionSubRow", () => {
  beforeEach(() => {
    useSessionStoreMock.mockReturnValue(undefined);
    useTicketRouteStoreMock.mockReturnValue(undefined);
  });

  it("no content → no real chevron (hidden spacer)", () => {
    useSessionStoreMock.mockReturnValue(undefined);
    useTicketRouteStoreMock.mockReturnValue(undefined);

    renderRow();

    const chevron = document.querySelector(".stage-chevron") as HTMLElement;
    expect(chevron).toBeTruthy();
    expect(chevron.style.visibility).toBe("hidden");
  });

  it("session with todos → real chevron + n/m count shown", () => {
    useSessionStoreMock.mockReturnValue(undefined);
    useTicketRouteStoreMock.mockReturnValue({
      todos: [
        { key: "1", content: "Task A", status: "completed" },
        { key: "2", content: "Task B", status: "pending" },
      ],
    });

    renderRow();

    const chevron = document.querySelector(".stage-chevron") as HTMLElement;
    expect(chevron.style.visibility).toBe("visible");
    expect(screen.getByText("1/2")).toBeTruthy();
  });

  it("expanding a session with todos lists todo items", () => {
    useSessionStoreMock.mockReturnValue(undefined);
    useTicketRouteStoreMock.mockReturnValue({
      todos: [
        { key: "1", content: "Task A", status: "completed" },
        { key: "2", content: "Task B", status: "in_progress" },
      ],
    });

    renderRow();

    const chevron = document.querySelector(".stage-chevron") as HTMLElement;
    fireEvent.click(chevron);

    expect(screen.getByText("Task A")).toBeTruthy();
    expect(screen.getByText("Task B")).toBeTruthy();
    expect(screen.getByText("✓")).toBeTruthy();
    expect(screen.getByText("●")).toBeTruthy();
  });

  it("session with touched files → expanding shows file rows; clicking calls onOpenFile", () => {
    const mockSession = {
      events: [],
      artifacts: [{ path: "/project/src/foo.ts", kind: "file" }],
      previewPath: null,
    };
    useSessionStoreMock.mockReturnValue(mockSession);
    useTicketRouteStoreMock.mockReturnValue(undefined);

    const onOpenFile = vi.fn();
    renderRow({ onOpenFile });

    const chevron = document.querySelector(".stage-chevron") as HTMLElement;
    fireEvent.click(chevron);

    const fileRow = screen.getByText("foo.ts").closest(".stage-session-file-row")!;
    expect(fileRow).toBeTruthy();
    fireEvent.click(fileRow);
    expect(onOpenFile).toHaveBeenCalledWith("/project/src/foo.ts");
  });

  it("clicking the session title calls onFocusSession with the sid", () => {
    useSessionStoreMock.mockReturnValue(undefined);
    useTicketRouteStoreMock.mockReturnValue(undefined);

    const onFocusSession = vi.fn();
    renderRow({ onFocusSession });

    const title = screen.getByText("session " + SID.slice(0, 8));
    fireEvent.click(title);
    expect(onFocusSession).toHaveBeenCalledWith(SID);
  });

  it("live session todos take priority over summary fallback", () => {
    // Live session has events that produce todos
    const mockSession = {
      events: [
        {
          thinkrailSid: SID,
          sessionId: "",
          eventType: "toolCallStart",
          payload: {
            toolName: "TodoWrite",
            toolInput: {
              todos: [
                { id: "t1", content: "Live task", status: "in_progress" },
              ],
            },
          },
        },
      ],
      artifacts: [],
      previewPath: null,
    };
    useSessionStoreMock.mockReturnValue(mockSession);
    useTicketRouteStoreMock.mockReturnValue({
      todos: [{ key: "old", content: "Stale task", status: "completed" }],
    });

    renderRow();

    // Expand
    const chevron = document.querySelector(".stage-chevron") as HTMLElement;
    fireEvent.click(chevron);

    expect(screen.getByText("Live task")).toBeTruthy();
    expect(screen.queryByText("Stale task")).toBeNull();
  });

  it("isActive adds stage-sub-row--active class", () => {
    useSessionStoreMock.mockReturnValue(undefined);
    useTicketRouteStoreMock.mockReturnValue(undefined);

    renderRow({ isActive: true });
    expect(document.querySelector(".stage-sub-row--active")).toBeTruthy();
  });
});
