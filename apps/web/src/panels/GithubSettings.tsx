import { RiCheckLine as Check, RiRefreshLine as RefreshCw } from "@remixicon/react";
import type { GithubAuthStatus } from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { SkeletonRows } from "@thinkrail/ui/skeleton";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { getTransport } from "@/transport";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";

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
	const refreshButton = (
		<Button
			variant="outline"
			size="m"
			iconLeft={RefreshCw}
			loading={checking}
			spinIcon
			data-testid="settings-gh-refresh"
			onClick={onRefresh}
		>
			{t("settings.github.refresh")}
		</Button>
	);

	return (
		<div data-testid="settings-github" className="flex flex-col">
			<SettingsGroup
				title={t("settings.github.title")}
				description={t("settings.github.description")}
			>
				<div data-testid="settings-gh-status" data-connected={status?.connected}>
					{status?.connected ? (
						<div className="flex items-center gap-8 rounded-sm bg-control-bg px-12 py-8">
							<Check className="size-14 text-feedback-success" />
							<span className="tr-text-ui text-feedback-success">
								{t("settings.github.connected")}
							</span>
							{status.login ? (
								<span className="min-w-0 truncate text-text-muted tr-text-metadata">
									{status.login}
								</span>
							) : null}
							<div className="ml-auto shrink-0">{refreshButton}</div>
						</div>
					) : status ? (
						<SettingsNotice variant="warning" action={refreshButton}>
							<p>
								<T
									i18nKey="settings.github.notConnected"
									components={[<code key="command" className="tr-code-text" />]}
								/>
							</p>
						</SettingsNotice>
					) : failed ? (
						<SettingsNotice variant="error" action={refreshButton}>
							<p>{t("settings.github.checkFailed")}</p>
						</SettingsNotice>
					) : (
						<SkeletonRows rows={1} label={t("settings.github.checking")} />
					)}
				</div>
			</SettingsGroup>
		</div>
	);
}
