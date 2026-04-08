import { useState } from "react";

interface CompactUserMessageProps {
  text: string;
}

export function CompactUserMessage({ text }: CompactUserMessageProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="compact-user">
      <div
        className={`compact-user-bubble${expanded ? " compact-user-bubble--expanded" : ""}`}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v);
        }}
      >
        <span className="compact-user-label">You</span>
        <span className="compact-user-text">{text}</span>
      </div>
    </div>
  );
}
