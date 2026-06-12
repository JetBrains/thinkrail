import { useState } from "react";
import { ArrowRightFromLine, ArrowLeftFromLine } from "lucide-react";
import { FileTree } from "@/components/FileTree/FileTree.tsx";
import { SpecTree } from "@/components/SpecTree/SpecTree.tsx";
import { SessionManager } from "@/components/SessionManager/SessionManager.tsx";
import { ResizeHandle } from "@/components/AppShell/ResizeHandle.tsx";
import { useBoardStore } from "@/store/boardStore.ts";
import type { TicketSummary } from "@/types/board.ts";
import { PHASE_LABELS } from "@/components/TicketDetail/phases.ts";
import "./SessionsLeftPanel.css";

type SessionsLeftTab = "tickets" | "sessions" | "specs" | "files";

const TAB_LABELS: Record<SessionsLeftTab, string> = {
  tickets: "Tickets",
  sessions: "Sessions",
  specs: "Specs",
  files: "Files",
};

interface TicketItemProps {
  ticket: TicketSummary;
  onOpen: (id: string) => void;
  onPreview: (id: string) => void;
}

function TicketItem({ ticket, onOpen, onPreview }: TicketItemProps) {
  const phaseLabel = PHASE_LABELS[ticket.status] || ticket.status;

  return (
    <div
      className="sessions-left-ticket"
      onClick={() => onOpen(ticket.id)}
      onMouseEnter={() => onPreview(ticket.id)}
    >
      <div className="sessions-left-ticket-header">
        <span className="sessions-left-ticket-title">{ticket.title}</span>
        <span className="sessions-left-ticket-id">#{ticket.id.slice(-4)}</span>
      </div>
      <div className="sessions-left-ticket-meta">
        <span className="sessions-left-ticket-phase">{phaseLabel}</span>
        <span className="sessions-left-ticket-type">{ticket.type}</span>
      </div>
    </div>
  );
}

function TicketsContent() {
  const tickets = useBoardStore((s) => s.tickets);
  const openTicket = useBoardStore((s) => s.openTicket);
  const setPreviewTicket = useBoardStore((s) => s.setPreviewTicket);

  const ticketList = Array.from(tickets.values()).sort((a, b) => {
    const ta = Date.parse(a.updated || a.created || "") || 0;
    const tb = Date.parse(b.updated || b.created || "") || 0;
    return tb - ta;
  });

  if (ticketList.length === 0) {
    return <div className="sessions-left-empty">No tickets yet</div>;
  }

  return (
    <div className="sessions-left-tickets-list">
      {ticketList.map((ticket) => (
        <TicketItem
          key={ticket.id}
          ticket={ticket}
          onOpen={openTicket}
          onPreview={setPreviewTicket}
        />
      ))}
    </div>
  );
}

function TabContent({ tab }: { tab: SessionsLeftTab }) {
  switch (tab) {
    case "tickets":
      return <TicketsContent />;
    case "sessions":
      return (
        <div className="sessions-left-sessions-content">
          <SessionManager />
        </div>
      );
    case "specs":
      return <SpecTree />;
    case "files":
      return <FileTree />;
  }
}

const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const COLLAPSE_THRESHOLD = 150;

export function SessionsLeftPanel() {
  const [activeTab, setActiveTab] = useState<SessionsLeftTab>("sessions");
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div
        className={`sessions-left-panel${collapsed ? " sessions-left-panel--collapsed" : ""}`}
        style={{ width: collapsed ? 48 : width }}
      >
        {collapsed ? (
          <button
            className="sessions-left-expand-btn"
            onClick={() => setCollapsed(false)}
            title="Expand panel"
          >
            <ArrowRightFromLine size={16} />
          </button>
        ) : (
          <>
            <div className="sessions-left-tabs">
              {(Object.keys(TAB_LABELS) as SessionsLeftTab[]).map((tab) => (
                <button
                  key={tab}
                  className={`sessions-left-tab ${activeTab === tab ? "sessions-left-tab-active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
              <button
                className="sessions-left-collapse-btn"
                onClick={() => setCollapsed(true)}
                title="Collapse panel"
              >
                <ArrowLeftFromLine size={16} />
              </button>
            </div>
            <div className="sessions-left-content">
              <TabContent tab={activeTab} />
            </div>
          </>
        )}
      </div>
      {!collapsed && (
        <ResizeHandle
          side="left"
          panelWidth={width}
          onResize={setWidth}
          onCollapse={() => setCollapsed(true)}
          min={MIN_WIDTH}
          max={MAX_WIDTH}
          collapseThreshold={COLLAPSE_THRESHOLD}
          handleWidth={2}
          restColor="transparent"
          hoverColor="var(--primary)"
        />
      )}
    </div>
  );
}
