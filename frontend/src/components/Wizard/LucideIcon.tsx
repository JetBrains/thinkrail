import * as Icons from "lucide-react";

interface LucideIconProps {
  /** kebab-case lucide icon name (e.g. "pencil-ruler"). */
  name?: string | null;
  size?: number;
}

/** Renders a lucide-react icon by its kebab-case name, or nothing when
 *  the name is missing/unknown. */
export function LucideIcon({ name, size = 16 }: LucideIconProps) {
  if (!name) return null;
  const pascalCase = name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  const IconComponent = Icons[pascalCase as keyof typeof Icons] as
    | React.ComponentType<{ size?: number }>
    | undefined;
  return IconComponent ? <IconComponent size={size} /> : null;
}
