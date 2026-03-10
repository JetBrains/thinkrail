import { SKILLS } from "@/constants/skills.ts";

interface StickyContextBarProps {
  skillId?: string;
  specCount: number;
  model: string;
  permissionMode: string;
  onScrollToTop: () => void;
}

export function StickyContextBar({
  skillId,
  specCount,
  model,
  permissionMode,
  onScrollToTop,
}: StickyContextBarProps) {
  const skill = skillId ? SKILLS.find((s) => s.id === skillId) : null;

  const parts: string[] = [];
  if (skill) parts.push(`${skill.icon} ${skill.name}`);
  if (specCount > 0) parts.push(`${specCount} spec${specCount !== 1 ? "s" : ""}`);
  parts.push(model);
  parts.push(permissionMode);

  return (
    <div className="sticky-context-bar" onClick={onScrollToTop}>
      {parts.join(" \u2502 ")}
    </div>
  );
}
