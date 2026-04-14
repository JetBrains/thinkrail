interface SubsessionResultCardProps {
  childName: string;
  subsessionType: "discussion" | "refinement";
  summary: string;
}

export function SubsessionResultCard({
  childName,
  subsessionType,
  summary,
}: SubsessionResultCardProps) {
  return (
    <div className="subsession-result-card">
      <div className="subsession-result-header">
        <span className="subsession-result-icon">
          {subsessionType === "refinement" ? "\u270f\ufe0f" : "\ud83d\udcac"}
        </span>
        <span className="subsession-result-label">
          Subsession result &mdash; &ldquo;{childName}&rdquo;
        </span>
      </div>
      <div className="subsession-result-text">{summary}</div>
    </div>
  );
}
