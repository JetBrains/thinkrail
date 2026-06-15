/** Single source of truth for the ticket phase lifecycle — order, labels, the
 *  skill that runs each phase, and the reverse skill→phase lookup. */

export type TicketStatus =
  | "idea"
  | "product-design"
  | "technical-design"
  | "amend-specs"
  | "implementation-plan"
  | "implementing"
  | "done";

/** Numeric rank of each phase in lifecycle order. */
export const STATE_ORDER: Record<TicketStatus, number> = {
  idea: 0,
  "product-design": 1,
  "technical-design": 2,
  "amend-specs": 3,
  "implementation-plan": 4,
  implementing: 5,
  done: 6,
};

/** Phases in lifecycle order. */
export const PHASE_ORDER: TicketStatus[] = [
  "idea",
  "product-design",
  "technical-design",
  "amend-specs",
  "implementation-plan",
  "implementing",
  "done",
];

/** Display label per phase. */
export const PHASE_LABELS: Record<TicketStatus, string> = {
  idea: "Idea",
  "product-design": "Product design",
  "technical-design": "Technical design",
  "amend-specs": "Amend specs",
  "implementation-plan": "Implementation plan",
  implementing: "Implementing",
  done: "Done",
};

/** Skill ID associated with each phase. `null` for non-skill phases. */
export const PHASE_SKILLS: Record<TicketStatus, string | null> = {
  idea: null,
  "product-design": "ticket-product-design",
  "technical-design": "ticket-technical-design",
  "amend-specs": "ticket-amend-specs",
  "implementation-plan": "ticket-implementation-plan",
  implementing: "ticket-implement",
  done: null,
};

const SKILL_TO_PHASE: Record<string, TicketStatus> = Object.fromEntries(
  (Object.entries(PHASE_SKILLS) as [TicketStatus, string | null][])
    .filter(([, skill]) => skill != null)
    .map(([phase, skill]) => [skill as string, phase]),
);

/** The phase a session belongs to, derived from its skill id (or null). */
export function phaseForSkill(skillId: string | null | undefined): TicketStatus | null {
  return skillId ? SKILL_TO_PHASE[skillId] ?? null : null;
}
