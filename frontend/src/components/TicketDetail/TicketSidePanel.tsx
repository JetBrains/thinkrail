import { TicketInfo } from "./TicketInfo.tsx";
import "./BoardTicketPreview.css";

/** AppShell right-panel content while a ticket tab is active.
 *  Data is already loaded into ticketRouteStore by TicketDetail in the center
 *  column — this component just renders the TicketInfo panel chrome. */
export function TicketSidePanel() {
  return (
    <div className="context-panel context-panel--ticket">
      <div className="context-panel__body context-panel__body--flush">
        <div className="left-panel-ticket-body">
          <TicketInfo />
        </div>
      </div>
    </div>
  );
}
