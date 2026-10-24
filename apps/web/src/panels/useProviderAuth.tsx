import type { ProviderStatusReport } from "@thinkrail/contracts";
import { t as translate } from "@thinkrail/locales/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { LoginDialog } from "@/auth";
import { selectLoginBusy, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

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
	const [report, setReport] = useState<ProviderStatusReport | null>(null);
	const [failed, setFailed] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [busyProvider, setBusyProvider] = useState<string | null>(null);
	const activeLogin = useAppStore((s) => (s.activeLogin?.target ? null : s.activeLogin));
	const loginBusy = useAppStore(selectLoginBusy);
	const providerVersion = useAppStore((s) => s.providerVersion);
	const loadSequence = useRef(0);

	const load = useCallback(async () => {
		const sequence = ++loadSequence.current;
		const providerVersion = useAppStore.getState().providerVersion;
		const isCurrent = () =>
			sequence === loadSequence.current &&
			providerVersion === useAppStore.getState().providerVersion;
		setRefreshing(true);
		try {
			const next = await getTransport().request("provider.status", {});
			if (!isCurrent()) return;
			setReport(next);
			setFailed(false);
		} catch {
			if (!isCurrent()) return;
			setFailed(true);
		} finally {
			if (sequence === loadSequence.current) setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (providerVersion > 0) void load();
	}, [providerVersion, load]);

	useEffect(() => {
		if (activeLogin?.status === "success") void load();
	}, [activeLogin?.status, load]);

	const startLogin = useCallback(async (providerId: string, type: "oauth" | "api_key") => {
		if (!useAppStore.getState().reserveLogin()) return;
		setBusyProvider(providerId);
		try {
			const { loginId } = await getTransport().request("provider.loginStart", { providerId, type });
			useAppStore.getState().beginLogin(loginId, providerId);
		} catch (err) {
			toast.error(errorText(err), translate("settings.providers.startFailed"));
		} finally {
			useAppStore.getState().finishLoginStart();
			setBusyProvider(null);
		}
	}, []);

	const logout = useCallback(
		async (providerId: string) => {
			setBusyProvider(providerId);
			try {
				await getTransport().request("provider.logout", { providerId });
			} catch (err) {
				toast.error(errorText(err), translate("settings.providers.signOutFailed"));
				return;
			} finally {
				setBusyProvider(null);
			}
			await load();
		},
		[load],
	);

	const loginProviderName =
		report?.providers.find((p) => p.id === activeLogin?.providerId)?.name ??
		activeLogin?.providerId ??
		"";

	const loginDialog =
		activeLogin && ownsLoginDialog ? (
			<LoginDialog
				key={activeLogin.loginId}
				state={activeLogin}
				providerName={loginProviderName}
				onReply={(value) => {
					getTransport()
						.request("provider.loginReply", { loginId: activeLogin.loginId, value })
						.catch((err) =>
							toast.error(errorText(err), translate("settings.providers.submitFailed")),
						);
					useAppStore.getState().clearLoginInput();
				}}
				onCancel={() => {
					getTransport()
						.request("provider.loginCancel", { loginId: activeLogin.loginId })
						.catch(() => {});
					useAppStore.getState().clearLogin();
				}}
				onClose={() => {
					useAppStore.getState().clearLogin();
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
