export interface Skill {
  id: string;
  icon: string;
  name: string;
  description: string;
  group: string;
  requires?: "ticket";
}

export const FALLBACK_SKILLS: Skill[] = [
  { id: "new-project", icon: "\u{1F331}", name: "New Project", description: "Start a brand-new project from scratch", group: "Foundation" },
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
  { id: "ticket-describe", icon: "\u{270F}\u{FE0F}", name: "Describe", description: "Formulate a structured ticket description", group: "Ticket", requires: "ticket" },
  { id: "ticket-specify", icon: "\u{1F50D}", name: "Specify", description: "Create specifications from ticket description", group: "Ticket", requires: "ticket" },
  { id: "ticket-plan", icon: "\u{1F5FA}\u{FE0F}", name: "Plan", description: "Create implementation plan from specs", group: "Ticket", requires: "ticket" },
  { id: "ticket-execute", icon: "\u{1F680}", name: "Execute", description: "Orchestrate plan execution", group: "Ticket", requires: "ticket" },
];
