interface CompactMarkerProps {
  preTokens?: number;
}

export function CompactMarker({ preTokens }: CompactMarkerProps) {
  return (
    <div className="chat-compact">
      <span className="chat-compact-line" />
      <span className="chat-compact-label">
        Context compacted{preTokens != null ? ` \u2014 ${Math.round(preTokens / 1000)}k tokens` : ""}
      </span>
      <span className="chat-compact-line" />
    </div>
  );
}
