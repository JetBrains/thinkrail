import { useState, useRef, useEffect } from "react";
import { ChevronDown, SquareKanban, FolderOpen } from "lucide-react";
import { useUiStore } from "@/store/uiStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { Logo } from "@/components/ui";
import { WizardStepper, type WizardStep } from "@/components/Wizard";
import { SettingsModal } from "./SettingsModal.tsx";
import { ProjectDropdown } from "@/components/shared/ProjectDropdown.tsx";

interface HeaderProps {
  onSwitchProject: () => void;
  variant?: "default" | "wizard";
  wizardSteps?: WizardStep[];
}

export function Header({ onSwitchProject, variant = "default", wizardSteps }: HeaderProps) {
  const projectName = useUiStore((s) => s.projectName);
  const centerView = useUiStore((s) => s.centerView);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const focusSessions = useUiStore((s) => s.focusSessions);
  const leftActiveTab = useUiStore((s) => s.leftActiveTab);
  const leftCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const setLeftTab = useUiStore((s) => s.setLeftTab);
  const toggleLeftPanel = useUiStore((s) => s.toggleLeftPanel);

  // The left-panel Specs/Files browser, the header Board/Ticket buttons and
  // the folder icon form one switcher: exactly one is "active" at a time. The
  // browser only lives in the sessions layout (the board is full-width and the
  // ticket route's left panel is the phase tree), so it's active only there.
  const browserOpen = centerView === "sessions" && !leftCollapsed && leftActiveTab !== "sessions";

  const handleSelectBoard = () => {
    // `Board` click from inside a ticket route returns to the kanban board (BoardView)
    useBoardStore.setState({ activeTicketId: null });
    setCenterView("board");
  };

  const handleSelectSessions = () => {
    focusSessions();
    useBoardStore.setState({ activeTicketId: null });
    if (leftCollapsed) toggleLeftPanel();
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target as Node)) {
        setProjectDropdownOpen(false);
      }
    };

    if (projectDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [projectDropdownOpen]);

  return (
    <>
    <header className="header-bar">
      <div className="header-left">
        <button className="header-logo-btn" onClick={() => onSwitchProject()} title="Back to project selection">
          <Logo />
        </button>
        {(variant === "default" || (variant === "wizard" && projectName)) && (
          <>
            <span className="header-separator">/</span>
            <div className="header-project-container" ref={projectDropdownRef}>
              <button
                className="header-project-btn"
                onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
                title="Switch project"
              >
                <span>{projectName}</span>
                <ChevronDown size={16} strokeWidth={1.5} />
              </button>
              {projectDropdownOpen && (
                <ProjectDropdown
                  onSelectProject={onSwitchProject}
                  onClose={() => setProjectDropdownOpen(false)}
                />
              )}
            </div>
          </>
        )}
        {variant === "default" && (
          <>
            <div className="header-view-switcher" role="tablist" aria-label="Center view">
              <button
                type="button"
                role="tab"
                aria-selected={centerView === "board" && !browserOpen}
                className={`header-view-btn${centerView === "board" && !browserOpen ? " header-view-btn--active" : ""}`}
                onClick={handleSelectBoard}
                title="Show board"
              >
                <SquareKanban size={16} strokeWidth={1.5} />
                <span>Board</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={centerView === "sessions" && !browserOpen}
                className={`header-view-btn${centerView === "sessions" && !browserOpen ? " header-view-btn--active" : ""}`}
                onClick={handleSelectSessions}
                title="Show workspace"
              >
                <FolderOpen size={16} strokeWidth={1.5} />
                <span>Workspace</span>
              </button>
            </div>
          </>
        )}
      </div>
      {variant === "wizard" && wizardSteps && (
        <div className="header-center">
          <WizardStepper steps={wizardSteps} />
        </div>
      )}
      <div className="header-right">
        {variant === "default" && (
          <button
            className="header-settings-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
        {variant === "wizard" && (
          <button
            className="header-settings-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
      </div>
    </header>
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
