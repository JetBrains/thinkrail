import type { RpcClient } from "../client.ts";

export function createSubsessionApi(client: RpcClient) {
  return {
    create: (params: {
      parentBonsaiSid: string;
      type: "discussion" | "refinement";
      context?: string;
      name?: string;
    }) => client.request<{ bonsaiSid: string }>("subsession/create", params),

    requestSummary: (bonsaiSid: string) =>
      client.request<{ ok: true }>("subsession/requestSummary", { bonsaiSid }),

    approveSummary: (bonsaiSid: string, text: string) =>
      client.request<{ ok: true }>("subsession/approveSummary", { bonsaiSid, text }),

    dismissSummary: (bonsaiSid: string) =>
      client.request<{ ok: true }>("subsession/dismissSummary", { bonsaiSid }),

    reviseSummary: (bonsaiSid: string, feedback: string) =>
      client.request<{ ok: true }>("subsession/reviseSummary", { bonsaiSid, feedback }),

    listChildren: (parentBonsaiSid: string) =>
      client.request<{ children: unknown[] }>("subsession/listChildren", { parentBonsaiSid }),
  };
}

export type SubsessionApi = ReturnType<typeof createSubsessionApi>;
