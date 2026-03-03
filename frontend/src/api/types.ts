export type { SpecSummary, SpecDetail, SpecGraph, RegistryEntry, Link } from "@/types/spec.ts";
export type { AgentTask, AgentConfig, AgentEvent, AgentResult } from "@/types/agent.ts";
import type { AgentConfig } from "@/types/agent.ts";
export type { ConnectionState } from "@/types/rpc.ts";

export type Unsubscribe = () => void;

export interface CreateSpecParams {
  type: string;
  path: string;
  content?: string;
  id?: string;
}

export interface AgentRunParams {
  specIds: string[];
  config: AgentConfig;
}

export interface CostSummary {
  sessionCost: number;
  projectCost: number;
  sessionTokens: number;
  projectTokens: number;
  budget: CostBudget | null;
}

export interface CostBudget {
  amount: number;
  scope: "session" | "project";
  warnAt: number;
}
