/** Shared plan-model types used by TicketPhaseList, TicketInfo, and the
 *  plan view. Lives here (rather than in a component file) so the type
 *  layer is decoupled from component lifecycles. */

export interface PlanStepModel {
  number: number;
  title: string;
  status: "pending" | "executing" | "done" | "failed";
  milestoneNumber: number;
  sessionId: string | null;
  /** Set when the step ran via the subagent Task tool in the
   *  orchestrator session. Click → scroll orchestrator chat to event.
   *  Mutually exclusive with sessionId in practice. */
  eventIndex: number | null;
}

export interface MilestoneModel {
  number: number;
  title: string;
  description: string;
  steps: PlanStepModel[];
}

export interface PlanModel {
  ticketId: string;
  title: string;
  status: string;
  milestones: MilestoneModel[];
  verification: unknown[];
}
