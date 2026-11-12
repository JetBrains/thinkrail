import type { ProviderStatusReport } from "@thinkrail/contracts";
import { t as translate } from "@thinkrail/locales/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { LoginDialog, type LoginState } from "@/auth";
import { ExtraUsageNotice } from "@/chat/ExtraUsageNotice";
import { selectLoginBusy, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { reloadProviderStatus, useProviderStatus } from "./useProviderStatus";

let pendingStart: { abandoned: boolean } | null = null;

function cancelProviderLogin(loginId: string): void {
	getTransport()
		.request("provider.loginCancel", { loginId })
		.catch(() => {});
	useAppStore.getState().clearLogin(loginId);
}

/** Cancels and clears a target-less provider login left open, or still starting, when a connect surface closes. */
export function cancelUnownedLogin(): void {
	if (pendingStart) pendingStart.abandoned = true;
	const login = useAppStore.getState().activeLogin;
	if (!login || login.target) return;
	if (login.status === "active") cancelProviderLogin(login.loginId);
	else useAppStore.getState().clearLogin(login.loginId);
}

/** Starts a provider login on an already reserved slot; a surface that closed meanwhile cancels the late `loginId`. */
export async function startReservedLogin(
	providerId: string,
	type: "oauth" | "api_key",
): Promise<void> {
	const owner = { abandoned: false };
	pendingStart = owner;
	try {
		const { loginId } = await getTransport().request("provider.loginStart", { providerId, type });
		if (owner.abandoned) cancelProviderLogin(loginId);
		else useAppStore.getState().beginLogin(loginId, providerId, undefined, type);
	} catch (err) {
		if (!owner.abandoned) toast.error(errorText(err), translate("settings.providers.startFailed"));
	} finally {
		if (pendingStart === owner) pendingStart = null;
		useAppStore.getState().finishLoginStart();
	}
}

export function warnsExtraUsageOnSignIn(
	login: Pick<LoginState, "providerId" | "method">,
	report: ProviderStatusReport | null,
): boolean {
	return (
		login.providerId === "anthropic" &&
		login.method === "oauth" &&
		report?.warnings?.anthropicExtraUsage !== false
	);
}

export interface ProviderAuth {
	report: ProviderStatusReport | null;
	failed: boolean;
	refreshing: boolean;
	load: () => Promise<void>;
	startLogin: (providerId: string, type: "oauth" | "api_key") => Promise<void>;
	logout: (providerId: string) => Promise<void>;
	rowBusy: (providerId: string) => boolean;
	busyProvider: string | null;
	loginDialog: ReactNode;
}

export function useProviderAuth({ ownsLoginDialog }: { ownsLoginDialog: boolean }): ProviderAuth {
	const { report, failed, refreshing } = useProviderStatus();
	const [busyProvider, setBusyProvider] = useState<string | null>(null);
	const activeLogin = useAppStore((s) => (s.activeLogin?.target ? null : s.activeLogin));
	const loginBusy = useAppStore(selectLoginBusy);
	const load = reloadProviderStatus;

	useEffect(() => {
		void reloadProviderStatus();
	}, []);

	const startLogin = useCallback(async (providerId: string, type: "oauth" | "api_key") => {
		if (!useAppStore.getState().reserveLogin()) return;
		setBusyProvider(providerId);
		await startReservedLogin(providerId, type).finally(() => setBusyProvider(null));
	}, []);

	const logout = useCallback(async (providerId: string) => {
		setBusyProvider(providerId);
		const signOut = async () => {
			await getTransport().request("provider.logout", { providerId });
			return true;
		};
		const signedOut = await signOut()
			.catch((err: unknown) => {
				toast.error(errorText(err), translate("settings.providers.signOutFailed"));
				return false;
			})
			.finally(() => setBusyProvider(null));
		if (signedOut) await reloadProviderStatus();
	}, []);

	const loginProviderName =
		report?.providers.find((p) => p.id === activeLogin?.providerId)?.name ??
		activeLogin?.providerId ??
		"";

	const warnExtraUsage = activeLogin ? warnsExtraUsageOnSignIn(activeLogin, report) : false;

	const loginDialog =
		activeLogin && ownsLoginDialog ? (
			<LoginDialog
				key={activeLogin.loginId}
				state={activeLogin}
				providerName={loginProviderName}
				{...(warnExtraUsage ? { notice: <ExtraUsageNotice context="signIn" /> } : {})}
				onReply={(value) => {
					getTransport()
						.request("provider.loginReply", { loginId: activeLogin.loginId, value })
						.catch((err) =>
							toast.error(errorText(err), translate("settings.providers.submitFailed")),
						);
					useAppStore.getState().clearLoginInput();
				}}
				onCancel={() => cancelProviderLogin(activeLogin.loginId)}
				onClose={() => {
					useAppStore.getState().clearLogin(activeLogin.loginId);
					void load();
				}}
			/>
		) : null;

	return {
		report,
		failed,
		refreshing,
		load,
		startLogin,
		logout,
		rowBusy: (id) => busyProvider === id || loginBusy,
		busyProvider,
		loginDialog,
	};
}
