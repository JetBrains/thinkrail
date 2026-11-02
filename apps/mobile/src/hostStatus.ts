import type { Translator } from "@thinkrail/locales/react";
import { RelayUnreachableError } from "@thinkrail/remote-client";

/** Why a computer could not be reached: no shared route (Wi‑Fi or Tailscale), or the host said something went wrong. */
export type HostFailure = { kind: "network" } | { kind: "error"; message: string };

export type HostStatus =
	| { kind: "connected" }
	| { kind: "connecting" }
	| { kind: "unreachable"; failure: HostFailure };

export const failureOf = (error: unknown): HostFailure =>
	error instanceof RelayUnreachableError
		? { kind: "network" }
		: { kind: "error", message: error instanceof Error ? error.message : String(error) };

export const failureText = (t: Translator, failure: HostFailure): string =>
	failure.kind === "network"
		? t("mobile.hosts.networkFailure")
		: t("mobile.hosts.errorFailure", { message: failure.message });
