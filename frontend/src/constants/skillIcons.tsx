import {
  Sprout,
  Target,
  Building2,
  Package,
  Boxes,
  ClipboardList,
  RefreshCw,
  SearchCheck,
  FileCheck2,
  BarChart3,
  Compass,
  Wrench,
  LineChart,
  Pencil,
  FileCog,
  FilePen,
  Map as MapIcon,
  Rocket,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/** Skill id → lucide icon. Replaces the legacy emoji glyphs so the skill
 *  picker matches the rest of the lucide-based UI. Unknown ids fall back to
 *  a generic icon. */
const SKILL_ICONS: Record<string, LucideIcon> = {
  "new-project": Sprout,
  "goal-and-requirements": Target,
  "architecture-design": Building2,
  "module-design": Package,
  "submodule-design": Boxes,
  "task-spec": ClipboardList,
  "spec-from-code": RefreshCw,
  "spec-review": SearchCheck,
  "spec-lint": FileCheck2,
  "spec-status": BarChart3,
  "spec-next": Compass,
  "spec-init": Wrench,
  "cli-progress": LineChart,
  "ticket-product-design": Pencil,
  "ticket-technical-design": FileCog,
  "ticket-amend-specs": FilePen,
  "ticket-implementation-plan": MapIcon,
  "ticket-implement": Rocket,
};

export function SkillIcon({
  skillId,
  size = 14,
  className,
}: {
  skillId: string;
  size?: number;
  className?: string;
}) {
  const Icon = SKILL_ICONS[skillId] ?? Sparkles;
  return <Icon size={size} strokeWidth={1.5} className={className} aria-hidden="true" />;
}
