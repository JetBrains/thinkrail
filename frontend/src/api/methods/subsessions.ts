import type { RpcClient } from "../client.ts";

export function createSubsessionApi(client: RpcClient) {
  return {
    create: (params: {
      parentThinkrailSid: string;
      type: "discussion" | "refinement";
      context?: string;
      name?: string;
      origin?: { kind: "question" | "message"; requestId?: string | null; questionIndex?: number };
    }) => client.request<{ thinkrailSid: string }>("subsession/create", params),

    requestSummary: (thinkrailSid: string) =>
      client.request<{ ok: true }>("subsession/requestSummary", { thinkrailSid }),

    approveSummary: (thinkrailSid: string, text: string) =>
      client.request<{ ok: true }>("subsession/approveSummary", { thinkrailSid, text }),

    dismissSummary: (thinkrailSid: string) =>
      client.request<{ ok: true }>("subsession/dismissSummary", { thinkrailSid }),

    reviseSummary: (thinkrailSid: string, feedback: string) =>
      client.request<{ ok: true }>("subsession/reviseSummary", { thinkrailSid, feedback }),

    listChildren: (parentThinkrailSid: string) =>
      client.request<{ children: unknown[] }>("subsession/listChildren", { parentThinkrailSid }),
  };
}

export type SubsessionApi = ReturnType<typeof createSubsessionApi>;
