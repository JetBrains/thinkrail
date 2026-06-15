import { type Skill } from "@/constants/skills";
import { SkillIcon } from "@/constants/skillIcons.tsx";
import { useSettingsStore } from "@/store/settingsStore.ts";
import "./SkillGrid.css";

interface SkillGridProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  context?: { hasTicket: boolean };
}

export type { Skill };

export function SkillGrid({ selectedId, onSelect, context }: SkillGridProps) {
  const skills = useSettingsStore((s) => s.skills);
  const preferredOrder = ["Foundation", "Creation", "Review", "Visualization", "Ticket"];
  const allGroups = new Set(skills.map((s) => s.group));
  const groups = [...preferredOrder.filter((g) => allGroups.has(g)), ...[...allGroups].filter((g) => !preferredOrder.includes(g))];

  return (
    <div className="skill-grid">
      {groups.map((group) => {
        const groupSkills = skills.filter((s) => s.group === group);
        if (groupSkills.length === 0) return null;
        return (
          <div key={group} className="skill-group">
            <div className="skill-group-label">{group}</div>
            <div className="skill-group-cards">
              {groupSkills.map((skill) => {
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
                    <span className="skill-card-icon"><SkillIcon skillId={skill.id} size={16} /></span>
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
