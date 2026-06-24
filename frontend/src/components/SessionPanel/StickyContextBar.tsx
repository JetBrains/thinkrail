import { useSettingsStore } from "@/store/settingsStore.ts";
import { useRuntimeCapsStore } from "@/store/runtimeCapsStore.ts";
import { permissionModeLabel } from "@/utils/permissionMode.ts";

interface StickyContextBarProps {
  skillId?: string;
  specCount: number;
  model: string;
  permissionMode: string;
  createdBy?: string;
  onScrollToTop: () => void;
}

export function StickyContextBar({
  skillId,
  specCount,
  model,
  permissionMode,
  createdBy,
  onScrollToTop,
}: StickyContextBarProps) {
  const skills = useSettingsStore((s) => s.skills);
  const skill = skillId ? skills.find((s) => s.id === skillId) : null;
  const permissionModes =
    useRuntimeCapsStore((s) => s.capsByRuntime["claude"])?.permissionModes ?? [];

  const parts: string[] = [];
  if (skill) parts.push(`${skill.icon} ${skill.name}`);
  if (specCount > 0) parts.push(`${specCount} spec${specCount !== 1 ? "s" : ""}`);
  parts.push(model);
  parts.push(permissionModeLabel(permissionModes, permissionMode));
  if (createdBy) parts.push(`by ${createdBy}`);

  return (
    <div className="sticky-context-bar" onClick={onScrollToTop}>
      {parts.join(" \u2502 ")}
    </div>
  );
}
