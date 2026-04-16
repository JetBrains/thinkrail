/**
 * Typed REST client for the Bonsai backend.
 *
 * Generated types come from openapi.json (run `npm run generate` to refresh).
 * Usage:
 *   import { restClient } from "@/api/rest.ts";
 *   const { data, error } = await restClient.GET("/api/health");
 */

import createClient from "openapi-fetch";
import type { components, paths } from "./generated.ts";

export const restClient = createClient<paths>({ baseUrl: "/" });

// ── Convenient type aliases ───────────────────────────────────────────────────

export type UserProfile      = components["schemas"]["UserProfileResponse"];
export type RecentProject    = components["schemas"]["RecentProjectResponse"];
export type KnownProject     = components["schemas"]["KnownProjectResponse"];
export type ProjectInfo      = components["schemas"]["ProjectInfo"];
export type ProjectValidate  = components["schemas"]["ProjectValidateResponse"];
export type ProjectFiles     = components["schemas"]["ProjectFilesResponse"];
export type FileEntry        = components["schemas"]["FileEntry"];
export type FileRead         = components["schemas"]["FileReadResponse"];
export type FileWrite        = components["schemas"]["FileWriteResponse"];
export type FileBrowse       = components["schemas"]["FileBrowseResponse"];
export type OpenExternal     = components["schemas"]["OpenExternalResponse"];
export type DirList          = components["schemas"]["DirListResponse"];
export type FolderPick       = components["schemas"]["FolderPickResponse"];
export type SetupStatus      = components["schemas"]["SetupStatusResponse"];
export type SetupResult      = components["schemas"]["SetupResponse"];
export type ServerInfo       = components["schemas"]["ServerInfoResponse"];
export type TailscaleInfo    = components["schemas"]["TailscaleInfoResponse"];
