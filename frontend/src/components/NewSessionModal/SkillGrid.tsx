interface Skill {
  id: string;
  icon: string;
  name: string;
  description: string;
  group: string;
}

const SKILLS: Skill[] = [
  { id: "goal-and-requirements", icon: "\u{1F3AF}", name: "Goal & Requirements", description: "Define project goal and requirements", group: "Foundation" },
  { id: "architecture-design", icon: "\u{1F3DB}", name: "Architecture", description: "Create system architecture document", group: "Foundation" },
  { id: "module-design", icon: "\u{1F4E6}", name: "Module Design", description: "Design a module-level specification", group: "Creation" },
  { id: "submodule-design", icon: "\u{1F4E6}", name: "Submodule Design", description: "Design a sub-component specification", group: "Creation" },
  { id: "task-spec", icon: "\u{1F4CB}", name: "Task Spec", description: "Create an actionable task specification", group: "Creation" },
  { id: "spec-from-code", icon: "\u{1F504}", name: "Spec from Code", description: "Reverse-engineer specs from existing code", group: "Creation" },
  { id: "spec-review", icon: "\u{1F50D}", name: "Review", description: "Review specs against code for accuracy", group: "Review" },
  { id: "spec-lint", icon: "\u{1F4DD}", name: "Lint", description: "Validate spec structure and consistency", group: "Review" },
  { id: "spec-status", icon: "\u{1F4CA}", name: "Status", description: "Show coverage, health, and gaps", group: "Review" },
  { id: "spec-next", icon: "\u{1F9ED}", name: "Next", description: "Suggest what to specify next", group: "Review" },
  { id: "spec-init", icon: "\u{1F527}", name: "Init", description: "Initialize spec-driven project structure", group: "Review" },
  { id: "cli-progress", icon: "\u{1F4C9}", name: "Progress", description: "Show progress with terminal graphics", group: "Visualization" },
];

interface SkillGridProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

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
