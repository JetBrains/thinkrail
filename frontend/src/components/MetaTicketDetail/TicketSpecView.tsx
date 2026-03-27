interface TicketSpecViewProps {
  specId: string;
  specTitle: string;
}

export function TicketSpecView({ specId, specTitle }: TicketSpecViewProps) {
  return (
    <div className="ticket-right-panel">
      <div className="ticket-right-header">
        <span className="ticket-right-title">Spec: {specTitle}</span>
      </div>
      <div className="ticket-right-body">
        <div className="ticket-placeholder">
          <p>Spec diff viewer will appear in upcoming versions.</p>
          <p style={{ fontSize: 11, color: "var(--hint)", marginTop: "var(--space-sm)" }}>
            Spec ID: {specId}
          </p>
        </div>
      </div>
    </div>
  );
}
