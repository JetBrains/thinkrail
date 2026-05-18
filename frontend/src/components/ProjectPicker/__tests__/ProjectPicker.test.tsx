// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
// @ts-expect-error -- @types/node is intentionally not installed; this is a test-only utility.
import { readFileSync } from "node:fs";
// @ts-expect-error -- @types/node is intentionally not installed.
import { join } from "node:path";

// Mock the projects service before importing ProjectPicker.
const getKnownProjectsMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/projects.ts", () => ({
  getKnownProjects: getKnownProjectsMock,
}));

// Mock the project service used by handleOpen.
const validateProjectMock = vi.hoisted(() => vi.fn());

const scanProjectMock = vi.hoisted(() => vi.fn());
const initEngineMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/project.ts", () => ({
  validateProject: validateProjectMock,
  scanProject: scanProjectMock,
  initEngine: initEngineMock,
}));

// Mock fs service so the autocomplete effect doesn't hit the network.
vi.mock("@/services/fs.ts", () => ({
  listDirs: vi.fn(async () => ({ dirs: [] })),
  makeDirectory: vi.fn(),
  browseFolder: vi.fn(async () => null),
}));

import { ProjectPicker } from "../ProjectPicker.tsx";

describe("ProjectPicker", () => {
  beforeEach(() => {
    getKnownProjectsMock.mockReset();
    validateProjectMock.mockReset();
    scanProjectMock.mockReset();
    initEngineMock.mockReset();
    getKnownProjectsMock.mockResolvedValue([]);
    scanProjectMock.mockResolvedValue({
      important_files: [],
      top_folders: [],
      engine_guidance: [],
    });
    initEngineMock.mockResolvedValue({
      ok: true,
      created: true,
      file: "CLAUDE.md",
      init_command: "claude init",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls getKnownProjects on mount with no arguments", async () => {
    render(<ProjectPicker onSelect={() => {}} />);
    await waitFor(() => {
      expect(getKnownProjectsMock).toHaveBeenCalledTimes(1);
    });
    expect(getKnownProjectsMock).toHaveBeenCalledWith();
  });

  it("renders both projects when getKnownProjects resolves with two", async () => {
    getKnownProjectsMock.mockResolvedValue([
      {
        path: "/tmp/alpha",
        name: "alpha",
        registered_at: "2026-01-01T00:00:00Z",
        last_opened_at: "2026-01-02T00:00:00Z",
      },
      {
        path: "/tmp/beta",
        name: "beta",
        registered_at: "2026-01-01T00:00:00Z",
        last_opened_at: "2026-01-03T00:00:00Z",
      },
    ]);
    render(<ProjectPicker onSelect={() => {}} />);
    await screen.findByText("alpha");
    await screen.findByText("beta");
    expect(screen.getByText("/tmp/alpha")).toBeDefined();
    expect(screen.getByText("/tmp/beta")).toBeDefined();
  });

  it("clicking a recent row calls onSelect with the right path", async () => {
    getKnownProjectsMock.mockResolvedValue([
      {
        path: "/tmp/alpha",
        name: "alpha",
        registered_at: "2026-01-01T00:00:00Z",
        last_opened_at: "2026-01-02T00:00:00Z",
      },
    ]);
    validateProjectMock.mockResolvedValue({
      state: "initialized",
      exists: true,
      path: "/tmp/alpha",
      name: "alpha",
    });
    const onSelect = vi.fn();
    const { container } = render(<ProjectPicker onSelect={onSelect} />);
    await screen.findByText("alpha");
    const row = container.querySelector(
      ".picker-recent-item",
    ) as HTMLButtonElement;
    expect(row).not.toBeNull();
    fireEvent.click(row);
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("/tmp/alpha");
    });
    expect(validateProjectMock).toHaveBeenCalledWith("/tmp/alpha");
  });

  it("state=existing shows detect screen instead of calling onSelect", async () => {
    getKnownProjectsMock.mockResolvedValue([
      {
        path: "/tmp/legacy",
        name: "legacy",
        registered_at: "2026-01-01T00:00:00Z",
        last_opened_at: "2026-01-02T00:00:00Z",
      },
    ]);
    validateProjectMock.mockResolvedValue({
      state: "existing",
      exists: true,
      path: "/tmp/legacy",
      name: "legacy",
    });
    const onSelect = vi.fn();
    const { container } = render(<ProjectPicker onSelect={onSelect} />);
    await screen.findByText("legacy");
    const row = container.querySelector(
      ".picker-recent-item",
    ) as HTMLButtonElement;
    fireEvent.click(row);
    await screen.findByRole("button", { name: /Start investigation/i });
    expect(onSelect).not.toHaveBeenCalled();
    expect(scanProjectMock).toHaveBeenCalledWith("/tmp/legacy");
  });

  it("init agent button calls initEngine then re-scans", async () => {
    getKnownProjectsMock.mockResolvedValue([
      {
        path: "/tmp/oldproj",
        name: "oldproj",
        registered_at: "2026-01-01T00:00:00Z",
        last_opened_at: "2026-01-02T00:00:00Z",
      },
    ]);
    validateProjectMock.mockResolvedValue({
      state: "existing",
      exists: true,
      path: "/tmp/oldproj",
      name: "oldproj",
    });
    scanProjectMock
      .mockResolvedValueOnce({
        important_files: [],
        top_folders: [],
        engine_guidance: [
          {
            engine: "claude",
            display_name: "Claude Code",
            file: "CLAUDE.md",
            found: false,
            init_command: "claude init",
          },
        ],
      })
      .mockResolvedValueOnce({
        important_files: [],
        top_folders: [],
        engine_guidance: [
          {
            engine: "claude",
            display_name: "Claude Code",
            file: "CLAUDE.md",
            found: true,
            init_command: "claude init",
          },
        ],
      });

    const { container } = render(<ProjectPicker onSelect={() => {}} />);
    await screen.findByText("oldproj");
    fireEvent.click(
      container.querySelector(".picker-recent-item") as HTMLButtonElement,
    );
    const initBtn = await screen.findByRole("button", { name: /Init Claude Code/i });
    fireEvent.click(initBtn);
    await waitFor(() => {
      expect(initEngineMock).toHaveBeenCalledWith("claude", "/tmp/oldproj");
    });
    // Second scan refreshes the row from missing → found.
    await waitFor(() => {
      expect(scanProjectMock).toHaveBeenCalledTimes(2);
    });
  });

  it("useTokenStore is never imported in ProjectPicker.tsx", () => {
    // @ts-expect-error -- import.meta.dirname is a Node 20.11+/Vitest runtime feature; types not installed.
    const dir = import.meta.dirname as string;
    const src = readFileSync(join(dir, "..", "ProjectPicker.tsx"), "utf8");
    expect(src).not.toContain("useTokenStore");
  });
});
