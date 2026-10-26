import {
	RiArrowRightLine as ArrowRight,
	RiLoginBoxLine as LogIn,
	RiSearchLine as Search,
} from "@remixicon/react";
import type { DetectedAccount, DetectedAccountSource, ProviderStatus } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { t as translate, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { SkeletonRows } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { toast } from "@/store";
import { getTransport } from "@/transport";
import { JetBrainsAiCard } from "./JetBrainsAiCard";
import { ProviderRow } from "./ProviderRow";
import type { ProviderAuth } from "./useProviderAuth";

const JETBRAINS_AI_SEARCH = "jetbrains ai central";

const LIST_VIEWPORT_CAP = [
	"max-h-[calc(100dvh-360px)]",
	"max-h-[calc(100dvh-431px)]",
	"max-h-[calc(100dvh-502px)]",
	"max-h-[calc(100dvh-573px)]",
] as const;

type Method = "oauth" | "api_key";

const DETECTED_COPY = {
	"claude-code": {
		title: "panels.connectProvider.detected.claudeCodeTitle",
		detail: "panels.connectProvider.detected.claudeCodeDetail",
	},
	codex: {
		title: "panels.connectProvider.detected.codexTitle",
		detail: "panels.connectProvider.detected.codexDetail",
	},
	"github-copilot": {
		title: "panels.connectProvider.detected.copilotTitle",
		detail: "panels.connectProvider.detected.copilotDetail",
	},
	"copilot-cli": {
		title: "panels.connectProvider.detected.copilotTitle",
		detail: "panels.connectProvider.detected.copilotCliDetail",
	},
	"kimi-cli": {
		title: "panels.connectProvider.detected.kimiCliTitle",
		detail: "panels.connectProvider.detected.kimiCliDetail",
	},
	"grok-build": {
		title: "panels.connectProvider.detected.grokBuildTitle",
		detail: "panels.connectProvider.detected.grokBuildDetail",
	},
} as const satisfies Record<DetectedAccountSource, { title: MessageKey; detail: MessageKey }>;

interface DetectedChoice {
	account: DetectedAccount;
	provider: ProviderStatus;
}

export function connectedProviderName(provider: ProviderStatus): string {
	return provider.kind === "central" ? "JetBrains AI" : provider.name;
}

export async function announceProviderConnected(provider: ProviderStatus): Promise<void> {
	const models = await getTransport()
		.request("model.list", {})
		.catch(() => null);
	toast.success(
		models
			? translate("panels.connectProvider.modelsAvailable", { count: models.length })
			: translate("panels.connectProvider.agentCanRun"),
		translate("auth.login.connectedTitle", { provider: connectedProviderName(provider) }),
	);
}

export function ConnectProviderOptions({
	auth,
	detected,
	onConnected,
}: {
	auth: ProviderAuth;
	detected: readonly DetectedAccount[] | null;
	onConnected: (provider: ProviderStatus) => void;
}) {
	const t = useT();
	const { report, failed, load, startLogin, rowBusy } = auth;
	const [search, setSearch] = useState("");
	const baseline = useRef<Set<string> | null>(null);

	useEffect(() => {
		if (!report) return;
		const configured = report.providers.filter((p) => p.configured);
		if (baseline.current === null) {
			baseline.current = new Set(configured.map((p) => p.id));
			return;
		}
		const known = baseline.current;
		const fresh = configured.find((p) => !known.has(p.id));
		if (!fresh) return;
		for (const p of configured) known.add(p.id);
		onConnected(fresh);
	}, [report, onConnected]);

	if (failed && !report) {
		return (
			<div data-testid="connect-provider-error" className="flex items-center gap-12">
				<p className="min-w-0 flex-1 text-text-muted tr-text-ui">
					{t("panels.connectProvider.loadFailed")}
				</p>
				<Button variant="outline" size="sm" onClick={() => void load()}>
					{t("common.retry")}
				</Button>
			</div>
		);
	}
	if (!report || detected === null) return <SkeletonRows rows={3} />;

	const unconfigured = report.providers.filter(
		(p) => !p.configured && p.kind !== "central" && (p.canOAuth || p.canApiKey),
	);
	const found = detected.flatMap((account): DetectedChoice[] => {
		if (!Object.hasOwn(DETECTED_COPY, account.source)) return [];
		const provider = unconfigured.find((p) => p.id === account.providerId && p.canOAuth);
		return provider ? [{ account, provider }] : [];
	});
	const featured = new Set(found.map((choice) => choice.provider));
	const query = search.trim().toLowerCase();
	const others = unconfigured
		.filter((p) =>
			query ? p.name.toLowerCase().includes(query) || p.id.includes(query) : !featured.has(p),
		)
		.sort((a, b) => (b.canOAuth ? 1 : 0) - (a.canOAuth ? 1 : 0));
	const centralInstalled = report.jbcentral.state !== "absent";
	const detectedCount = found.length + (centralInstalled ? 1 : 0);
	const showJetBrainsRow = !centralInstalled && (!query || JETBRAINS_AI_SEARCH.includes(query));
	const connect = (p: ProviderStatus, method: Method) => void startLogin(p.id, method);

	return (
		<div data-testid="connect-provider-options" className="flex flex-col text-left">
			<section
				data-testid="connect-provider-all"
				className="flex flex-col gap-8 rounded-sm border border-border-default bg-clip-padding bg-container-workspace-bg p-16"
			>
				{detectedCount > 0 ? (
					<div
						data-testid="connect-option-detected"
						className="flex flex-col gap-8 border-border-muted border-b pb-12"
					>
						<span className="self-start rounded-full border border-primary-muted bg-clip-padding bg-primary-subtle px-8 py-2 tr-text-label-pill text-primary">
							{t("panels.connectProvider.detectedLabel")}
						</span>
						{centralInstalled ? (
							<div
								data-testid="connect-detected-central"
								className="rounded-sm border border-primary-muted bg-clip-padding bg-container-workspace-bg p-12"
							>
								<JetBrainsAiCard
									status={report.jbcentral}
									install={report.jbcentralInstall}
									onChanged={load}
								/>
							</div>
						) : null}
						{found.map(({ account, provider }) => (
							<DetectedChoiceButton
								key={account.source}
								account={account}
								provider={provider}
								busy={rowBusy(provider.id)}
								onPick={() => connect(provider, "oauth")}
							/>
						))}
						<span className="text-text-muted tr-text-metadata">
							{t("panels.connectProvider.detectedNote")}
						</span>
					</div>
				) : null}
				<div className="relative">
					<Search className="pointer-events-none absolute top-1/2 left-8 size-14 -translate-y-1/2 text-text-muted" />
					<input
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder={
							detectedCount > 0
								? t("panels.connectProvider.searchOthers")
								: t("panels.connectProvider.search")
						}
						aria-label={t("panels.connectProvider.searchLabel")}
						data-testid="connect-provider-search"
						className="h-32 w-full rounded-sm border border-control-border-default bg-control-bg pl-24 pr-8 tr-text-ui text-text-default placeholder:text-text-muted outline-none transition-colors focus:border-control-border-active"
					/>
				</div>
				<div
					data-testid="connect-provider-list"
					className={cn(
						"flex h-240 min-h-160 flex-col overflow-y-auto",
						LIST_VIEWPORT_CAP[Math.min(detectedCount, 3)],
					)}
				>
					{others.map((p) => (
						<ProviderRow
							key={p.id}
							provider={p}
							busy={rowBusy(p.id)}
							onSignIn={() => connect(p, "oauth")}
							onApiKey={() => connect(p, "api_key")}
							showApiKey={!p.canOAuth}
						/>
					))}
					{showJetBrainsRow ? (
						<JetBrainsAiRow
							status={report.jbcentral}
							install={report.jbcentralInstall}
							onChanged={load}
						/>
					) : null}
					{!showJetBrainsRow && others.length === 0 ? (
						<p className="py-16 text-center text-text-muted tr-text-metadata">
							{t("panels.connectProvider.noMatch")}
						</p>
					) : null}
				</div>
			</section>
		</div>
	);
}

function JetBrainsAiRow(props: ComponentProps<typeof JetBrainsAiCard>) {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<div
			data-testid="jetbrains-ai-row"
			className="flex flex-col border-border-muted border-b py-12"
		>
			<div className="flex items-center gap-8">
				<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default">
					{t("settings.jbcentral.title")}
				</span>
				<Button
					variant="outline"
					size="sm"
					data-testid="jetbrains-ai-setup"
					aria-expanded={open}
					onClick={() => setOpen((o) => !o)}
				>
					{t("panels.connectProvider.centralSetUp")}
				</Button>
			</div>
			{open ? (
				<div className="pt-12">
					<JetBrainsAiCard {...props} />
				</div>
			) : null}
		</div>
	);
}

function DetectedChoiceButton({
	account,
	provider,
	busy,
	onPick,
}: DetectedChoice & { busy: boolean; onPick: () => void }) {
	const t = useT();
	const copy = DETECTED_COPY[account.source];
	return (
		<button
			type="button"
			data-testid="connect-detected"
			data-source={account.source}
			data-provider={provider.id}
			disabled={busy}
			onClick={onPick}
			className="flex min-w-0 items-start gap-8 rounded-sm border border-primary-muted bg-clip-padding bg-container-workspace-bg p-12 text-left transition-colors hover:bg-control-bg-hovered focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
		>
			<LogIn className="mt-2 size-16 shrink-0 text-primary" />
			<span className="flex min-w-0 flex-1 flex-col gap-2">
				<span className="flex flex-wrap items-center gap-8">
					<span className="tr-title-card text-text-default">{t(copy.title)}</span>
					{account.plan ? (
						<span className="rounded-full border border-border-default px-8 tr-text-label-pill text-text-muted">
							{t("panels.connectProvider.detectedPlan", {
								plan: account.plan.charAt(0).toUpperCase() + account.plan.slice(1),
							})}
						</span>
					) : null}
				</span>
				<span className="text-text-muted tr-text-metadata">{t(copy.detail)}</span>
			</span>
			<ArrowRight className="mt-2 size-16 shrink-0 text-text-muted" />
		</button>
	);
}
