import { entryTransition } from "./registry";
import type { PendingNewProject } from "@/store/uiStore";

const CHAIN_ID = "new-project";
const ENTRY = entryTransition(CHAIN_ID);

export const NEW_PROJECT_CHAIN = CHAIN_ID;
export const NEW_PROJECT_SKILL = ENTRY?.target ?? CHAIN_ID;

/** Fold the project name + idea + optional attached doc into the agent's
 *  first kick message. Single source so the picker (pre-nav) and the
 *  post-nav auto-start build the same prompt. */
export function composeNewProjectKick({ name, ideaText, attachedFile }: PendingNewProject): string {
  const parts: string[] = [];
  if (ideaText) parts.push(ideaText);
  if (attachedFile) {
    parts.push(`--- Attached: ${attachedFile.name} ---\n${attachedFile.content}`);
  }
  return (
    ENTRY?.buildPrompt?.({ projectName: name, ideaText: parts.join("\n\n") }) ??
    [`Project name: ${name}`, ...parts].join("\n\n")
  );
}
