interface SubsessionResultCardProps {
  childName: string;
  summary: string;
}

export function SubsessionResultCard({
  childName,
  summary,
}: SubsessionResultCardProps) {
  return (
    <div className="subsession-result-card">
      <div className="subsession-result-header">
        <span className="subsession-result-icon">{"💬"}</span>
        <span className="subsession-result-label">
          Subsession result &mdash; &ldquo;{childName}&rdquo;
        </span>
      </div>
      <div className="subsession-result-text">{summary}</div>
    </div>
  );
}
