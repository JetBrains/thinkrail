export type { SpecSummary, SpecDetail, SpecGraph, SpecEntry, Link } from "@/types/spec.ts";
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
  filePaths?: string[];
  config: AgentConfig;
  skillId?: string;
  prompt?: string;
  name?: string;
  ticketId?: string;
}

