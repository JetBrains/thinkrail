import type { RpcClient } from "../client.ts";
import type { RegistryEntry, SpecDetail, SpecGraph, CreateSpecParams } from "../types.ts";

export function createSpecApi(client: RpcClient) {
  return {
    list: () => client.request<RegistryEntry[]>("spec/list"),

    get: (id: string) => client.request<SpecDetail>("spec/get", { id }),

    create: (params: CreateSpecParams) =>
      client.request<SpecDetail>("spec/create", params),

    update: (id: string, content: string) =>
      client.request<SpecDetail>("spec/update", { id, content }),

    delete: (id: string) => client.request<null>("spec/delete", { id }),

    graph: () => client.request<SpecGraph>("spec/graph"),
  };
}

export type SpecApi = ReturnType<typeof createSpecApi>;
