const LEGEND_ITEMS = [
  { label: "Goal", color: "var(--gold)" },
  { label: "Architecture", color: "var(--purple)" },
  { label: "Module", color: "var(--blue)" },
  { label: "Task", color: "var(--green)" },
];

const EDGE_ITEMS = [
  { label: "Parent", style: "solid" },
  { label: "Depends", style: "dashed" },
  { label: "Reference", style: "dotted" },
];

export function GraphLegend() {
  return (
    <div className="graph-legend">
      {LEGEND_ITEMS.map((item) => (
        <span key={item.label} className="graph-legend-item">
          <span
            className="graph-legend-dot"
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
      {EDGE_ITEMS.map((item) => (
        <span key={item.label} className="graph-legend-item">
          <span
            className="graph-legend-line"
            style={{
              borderTopStyle: item.style as "solid" | "dashed" | "dotted",
            }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
