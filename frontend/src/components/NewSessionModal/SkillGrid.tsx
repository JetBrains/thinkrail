import { SKILLS, type Skill } from "@/constants/skills";

interface SkillGridProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export type { Skill };

export function SkillGrid({ selectedId, onSelect }: SkillGridProps) {
  const groups = ["Foundation", "Creation", "Review", "Visualization"];

  return (
    <div className="skill-grid">
      {groups.map((group) => {
        const skills = SKILLS.filter((s) => s.group === group);
        return (
          <div key={group} className="skill-group">
            <div className="skill-group-label">{group}</div>
            <div className="skill-group-cards">
              {skills.map((skill) => (
                <button
                  key={skill.id}
                  className={`skill-card ${selectedId === skill.id ? "skill-card-selected" : ""}`}
                  onClick={() =>
                    onSelect(selectedId === skill.id ? null : skill.id)
                  }
                >
                  <span className="skill-card-icon">{skill.icon}</span>
                  <span className="skill-card-name">{skill.name}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
