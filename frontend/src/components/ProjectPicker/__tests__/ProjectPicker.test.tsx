// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
// @ts-expect-error -- @types/node is intentionally not installed; this is a test-only utility.
import { readFileSync } from "node:fs";
// @ts-expect-error -- @types/node is intentionally not installed.
import { join } from "node:path";

// Mock the projects service before importing ProjectPicker.
const getKnownProjectsMock = vi.hoisted(() => vi.fn());
const registerKnownProjectMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/projects.ts", () => ({
  getKnownProjects: getKnownProjectsMock,
  registerKnownProject: registerKnownProjectMock,
}));

// Mock the project service used by handleOpen.
const validateProjectMock = vi.hoisted(() => vi.fn());
const initProjectMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/project.ts", () => ({
  validateProject: validateProjectMock,
  initProject: initProjectMock,
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
    registerKnownProjectMock.mockReset();
    validateProjectMock.mockReset();
    initProjectMock.mockReset();
    getKnownProjectsMock.mockResolvedValue([]);
    registerKnownProjectMock.mockResolvedValue(undefined);
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
      valid: true,
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
      expect(onSelect).toHaveBeenCalledWith("/tmp/alpha", false);
    });
    expect(validateProjectMock).toHaveBeenCalledWith("/tmp/alpha");
    expect(initProjectMock).not.toHaveBeenCalled();
  });

  it("useTokenStore is never imported in ProjectPicker.tsx", () => {
    // @ts-expect-error -- import.meta.dirname is a Node 20.11+/Vitest runtime feature; types not installed.
    const dir = import.meta.dirname as string;
    const src = readFileSync(join(dir, "..", "ProjectPicker.tsx"), "utf8");
    expect(src).not.toContain("useTokenStore");
  });
});
