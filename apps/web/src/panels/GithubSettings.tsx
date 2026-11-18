import {
	RiCheckLine as Check,
	RiErrorWarningLine as ErrorIcon,
	RiRefreshLine as RefreshCw,
	RiAlertLine as Warning,
} from "@remixicon/react";
import type { GithubAuthStatus } from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { SkeletonRows } from "@thinkrail/ui/skeleton";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { SettingsGroup, SettingsPage, SettingsRow } from "@/settingsKit";
import { getTransport } from "@/transport";
import { SETTING, settingProps } from "./settingsCatalog";

let lastStatus: GithubAuthStatus | null = null;

export interface GithubProbe {
	status: GithubAuthStatus | null;
	failed: boolean;
	pending: number | null;
}

export type GithubProbeEvent =
	| { type: "start"; id: number }
	| { type: "answer"; id: number; status: GithubAuthStatus }
	| { type: "reject"; id: number };

export function githubProbe(probe: GithubProbe, event: GithubProbeEvent): GithubProbe {
	if (event.type === "start") return { ...probe, pending: event.id };
	if (event.id !== probe.pending) return probe;
	return event.type === "answer"
		? { status: event.status, failed: false, pending: null }
		: { ...probe, failed: true, pending: null };
}

export function GithubSettings() {
	const [probe, dispatch] = useReducer(githubProbe, {
		status: lastStatus,
		failed: false,
		pending: null,
	});
	const requests = useRef(0);

	const run = useCallback((method: "github.authStatus" | "github.refresh") => {
		const id = ++requests.current;
		dispatch({ type: "start", id });
		getTransport()
			.request(method, {})
			.then(
				(status) => dispatch({ type: "answer", id, status }),
				() => dispatch({ type: "reject", id }),
			);
	}, []);

	useEffect(() => run("github.authStatus"), [run]);

	useEffect(() => {
		if (probe.status) lastStatus = probe.status;
	}, [probe.status]);

	return (
		<GithubStatusView
			status={probe.status}
			checking={probe.pending !== null}
			failed={probe.failed}
			onRefresh={() => run("github.refresh")}
		/>
	);
}

export function GithubStatusView({
	status,
	checking,
	failed,
	onRefresh,
}: {
	status: GithubAuthStatus | null;
	checking: boolean;
	failed: boolean;
	onRefresh: () => void;
}) {
	const t = useT();
	return (
		<SettingsPage
			title={t("settings.nav.github")}
			description={t("settings.github.pageDescription")}
			testId="settings-github"
		>
			<SettingsGroup
				title={t("settings.github.title")}
				description={t("settings.github.description")}
			>
				<SettingsRow
					{...settingProps(t, SETTING.githubCli)}
					description={
						<div
							data-testid="settings-gh-status"
							data-connected={status?.connected}
							className="flex min-w-0 items-start gap-4"
						>
							{status?.connected ? (
								<>
									<Check aria-hidden className="mt-2 size-14 shrink-0 text-feedback-success" />
									<span className="text-feedback-success">{t("settings.github.connected")}</span>
									{status.login ? <span className="min-w-0 break-all">{status.login}</span> : null}
								</>
							) : status ? (
								<>
									<Warning aria-hidden className="mt-2 size-14 shrink-0 text-feedback-warning" />
									<span>
										<T
											i18nKey="settings.github.notConnected"
											components={[<code key="command" className="tr-code-text" />]}
										/>
									</span>
								</>
							) : failed ? (
								<>
									<ErrorIcon aria-hidden className="mt-2 size-14 shrink-0 text-feedback-error" />
									<span>{t("settings.github.checkFailed")}</span>
								</>
							) : (
								<SkeletonRows rows={1} label={t("settings.github.checking")} />
							)}
						</div>
					}
					control={
						<Button
							variant="outline"
							size="m"
							iconLeft={RefreshCw}
							loading={checking}
							spinIcon
							tabIndex={0}
							data-testid="settings-gh-refresh"
							onClick={onRefresh}
						>
							{t("settings.github.refresh")}
						</Button>
					}
				/>
			</SettingsGroup>
		</SettingsPage>
	);
}
