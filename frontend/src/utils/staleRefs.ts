import type { RegistryEntry } from "@/types/spec.ts";
import type { Skill } from "@/constants/skills.ts";

/**
 * Return spec IDs from `specIds` that do not exist in `liveSpecs`.
 */
export function findStaleSpecIds(
  specIds: string[],
  liveSpecs: RegistryEntry[],
): string[] {
  const liveIds = new Set(liveSpecs.map((s) => s.id));
  return specIds.filter((id) => !liveIds.has(id));
}

/**
 * Return true if `skillId` is null or exists in the given skills list.
 */
export function isSkillValid(skillId: string | null, skills: Skill[]): boolean {
  if (!skillId) return true;
  return skills.some((s) => s.id === skillId);
}

/**
 * Return session IDs from `sessionIds` that do not exist in `liveSids`.
 */
export function findStaleSessionIds(
  sessionIds: string[],
  liveSids: Set<string>,
): string[] {
  return sessionIds.filter((id) => !liveSids.has(id));
}
