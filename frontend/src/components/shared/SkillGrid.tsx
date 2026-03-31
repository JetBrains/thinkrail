import { SKILLS, type Skill } from "@/constants/skills";
import "./SkillGrid.css";

interface SkillGridProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  context?: { hasTicket: boolean };
}

export type { Skill };

export function SkillGrid({ selectedId, onSelect, context }: SkillGridProps) {
  const groups = ["Foundation", "Creation", "Review", "Visualization", "Ticket"];

  return (
    <div className="skill-grid">
      {groups.map((group) => {
        const skills = SKILLS.filter((s) => s.group === group);
        if (skills.length === 0) return null;
        return (
          <div key={group} className="skill-group">
            <div className="skill-group-label">{group}</div>
            <div className="skill-group-cards">
              {skills.map((skill) => {
                const irrelevant = skill.requires === "ticket" && !context?.hasTicket;
                return (
                  <button
                    key={skill.id}
                    className={`skill-card ${selectedId === skill.id ? "skill-card-selected" : ""} ${irrelevant ? "skill-card--irrelevant" : ""}`}
                    onClick={() => {
                      if (irrelevant) return;
                      onSelect(selectedId === skill.id ? null : skill.id);
                    }}
                  >
                    <span className="skill-card-icon">{skill.icon}</span>
                    <span className="skill-card-name">{skill.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
