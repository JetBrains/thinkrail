import type { RpcClient } from "../client.ts";

export interface AdminUser {
  id: string;
  name: string;
  isAdmin: boolean;
  createdAt: string;
  tokenCount: number;
}

export interface CreateUserResult {
  userId: string;
  name: string;
  token: string;
  isAdmin: boolean;
}

/** WebSocket RPC methods for admin user management. */
export function createAdminApi(client: RpcClient) {
  return {
    listUsers: () =>
      client.request<{ users: AdminUser[] }>("admin/listUsers"),

    createUser: (userId: string, name: string, isAdmin = false) =>
      client.request<CreateUserResult>("admin/createUser", {
        userId,
        name,
        isAdmin,
      }),

    deleteUser: (userId: string) =>
      client.request<{ ok: boolean }>("admin/deleteUser", { userId }),

    setAdmin: (userId: string) =>
      client.request<{ ok: boolean }>("admin/setAdmin", { userId }),

    removeAdmin: (userId: string) =>
      client.request<{ ok: boolean }>("admin/removeAdmin", { userId }),

    revokeToken: (token: string) =>
      client.request<{ ok: boolean }>("admin/revokeToken", { token }),
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
