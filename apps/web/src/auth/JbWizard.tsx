import type { JbcentralStatus } from "@thinkrail/contracts";
import { AlertCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { CopyRow, LogTail, StepRow, WaitingPulse } from "./bits";
import { ProviderMark } from "./ProviderMark";

/** The exact command the host will run, per platform — shown before consent. The host decides the
 * real platform; this mirrors it for display (a mac/linux browser talking to a windows host is rare
 * enough that the wrong *display* string is acceptable; the host always runs its own). */
const INSTALL_DISPLAY =
	"curl -fsSL https://jetbrains-central-cli.s3.eu-west-1.amazonaws.com/central/stable/install.sh | bash";

type Stage = "install" | "login" | "configure";

const STAGE_ORDER: Stage[] = ["install", "login", "configure"];
const STAGE_LABEL: Record<Stage, string> = {
	install: "Install CLI",
	login: "Sign in",
	configure: "Connect models",
};

/** Fire a wizard step on the host (progress arrives via auth.event — nothing to await). */
function start(method: "jbcentral.install" | "jbcentral.login" | "jbcentral.configure"): void {
	getTransport()
		.request(method, {})
		.catch(() => {});
}

const CONFIGURE_STEPS: { step: string; label: string; command?: string }[] = [
	{ step: "add-claude", label: "Enable Claude models", command: "jbcentral add claude" },
	{ step: "add-codex", label: "Enable Codex models", command: "jbcentral add codex" },
	{
		step: "wire-proxy",
		label: "Route pi through the local JetBrains proxy",
		command: "models.json",
	},
	{ step: "reload-models", label: "Reload model registry" },
];

/**
 * The JetBrains AI mini-wizard: Install → Sign in → Connect models, every step host-driven
 * (`jbcentral.install/login/configure`), streamed via `auth.event`, and separately retryable. The
 * entry stage comes from the host's probe (`installed`/`wired`); each flow's `done ok` auto-chains
 * the next stage. The installer never runs without the explicit "Install for me" click.
 */
export function JbWizard({
	jbcentral,
	onCancel,
}: {
	jbcentral: JbcentralStatus;
	onCancel: () => void;
}) {
	const flow = useAppStore((s) => s.authFlow);
	const [stage, setStage] = useState<Stage>(jbcentral.installed ? "login" : "install");
	// Consent screen state: shown before the install flow runs.
	const [installStarted, setInstallStarted] = useState(false);
	const chainedRef = useRef<string | null>(null);

	const jbFlow = flow?.flow.startsWith("jb-") ? flow : null;
	const failed = jbFlow?.done && !jbFlow.done.ok && jbFlow.done.message !== "cancelled";

	// Auto-chain: install done → sign in; sign in done → configure. (Configure's completion flips
	// modelCount>0, which the gate turns into the success screen — nothing to chain here.)
	useEffect(() => {
		if (!jbFlow?.done?.ok || chainedRef.current === jbFlow.flowId) return;
		chainedRef.current = jbFlow.flowId;
		if (jbFlow.flow === "jb-install") {
			setStage("login");
			start("jbcentral.login");
		} else if (jbFlow.flow === "jb-login") {
			setStage("configure");
			start("jbcentral.configure");
		}
	}, [jbFlow]);

	const cancel = () => {
		if (jbFlow && !jbFlow.done) {
			getTransport()
				.request("auth.cancel", { flowId: jbFlow.flowId })
				.catch(() => {});
		}
		onCancel();
	};

	const retry = () => {
		if (stage === "install") start("jbcentral.install");
		else if (stage === "login") start("jbcentral.login");
		else start("jbcentral.configure");
	};

	const stageIndex = STAGE_ORDER.indexOf(stage);
	const running = jbFlow != null && !jbFlow.done;

	return (
		<section data-testid="auth-jb-wizard" className="flex flex-col">
			<header className="flex items-center gap-md border-border border-b px-lg py-md">
				<ProviderMark id="jetbrains" size="md" />
				<div className="min-w-0">
					<h2 className="font-semibold text-md text-text">Set up JetBrains AI</h2>
					<p className="text-hint text-sm">
						ThinkRail runs every step on this machine — nothing to type in a terminal.
					</p>
				</div>
			</header>

			<div className="flex flex-col gap-md px-lg py-md">
				{/* stepper */}
				<ol className="flex flex-col gap-sm sm:flex-row sm:items-center sm:gap-0">
					{STAGE_ORDER.map((s, i) => {
						const state = i < stageIndex ? "done" : i === stageIndex ? "now" : "todo";
						return (
							<li key={s} className="flex flex-1 items-center gap-sm text-sm">
								<span
									className={cn(
										"grid size-6 shrink-0 place-items-center rounded-full border font-medium text-xs",
										state === "done" && "border-green bg-[var(--green-tint)] text-green",
										state === "now" && "border-primary text-primary",
										state === "todo" && "border-border2 text-hint",
									)}
								>
									{i + 1}
								</span>
								<span className={state === "todo" ? "text-hint" : "text-text"}>
									{STAGE_LABEL[s]}
								</span>
								{i < STAGE_ORDER.length - 1 ? (
									<span className="mx-md hidden h-px flex-1 bg-border2 sm:block" />
								) : null}
							</li>
						);
					})}
				</ol>

				{failed ? (
					<div
						data-testid="auth-jb-error"
						className="flex items-start gap-sm rounded-[var(--radius-md)] border border-red bg-[var(--input-bg)] px-md py-sm text-sm"
					>
						<AlertCircle className="mt-[2px] size-4 shrink-0 text-red" />
						<div className="min-w-0">
							<div className="text-text">This step failed</div>
							<div className="whitespace-pre-wrap break-words text-hint text-xs">
								{jbFlow?.done?.message}
							</div>
						</div>
					</div>
				) : null}

				{/* stage: install (consent-first) */}
				{stage === "install" && !installStarted ? (
					<div className="flex flex-col gap-sm" data-testid="auth-jb-consent">
						<p className="text-muted text-sm">
							The JetBrains Central CLI (<span className="font-[var(--font-mono)]">jbcentral</span>)
							isn't installed. ThinkRail can run the official installer for you — this is the exact
							command it will execute:
						</p>
						<CopyRow text={INSTALL_DISPLAY} prefix="$" testId="auth-jb-install-cmd" />
						<div className="flex flex-wrap items-center gap-sm pt-xs">
							<Button
								data-testid="auth-jb-install"
								size="sm"
								onClick={() => {
									setInstallStarted(true);
									start("jbcentral.install");
								}}
							>
								Install for me
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									// "I ran it myself" — the install flow fast-paths when the binary is found.
									setInstallStarted(true);
									start("jbcentral.install");
								}}
							>
								I ran it myself — re-check
							</Button>
						</div>
					</div>
				) : null}

				{/* stage: login */}
				{stage === "login" && running ? (
					<>
						<WaitingPulse
							title="Finish signing in to JetBrains in your browser"
							sub={
								<>
									ThinkRail launched{" "}
									<span className="font-[var(--font-mono)] text-xs">jbcentral login</span> and your
									browser should have opened the JetBrains sign-in page.
								</>
							}
						/>
						{jbFlow?.authUrl ? <CopyRow text={jbFlow.authUrl} testId="auth-jb-login-url" /> : null}
						<p className="text-hint text-xs">
							<span className="font-semibold text-muted">Early access?</span> Choose the{" "}
							<span className="font-semibold text-muted">ThinkRail-Early</span> organisation when
							asked. No access yet — request it from @daniil.berezun with your name and email.
						</p>
					</>
				) : null}

				{/* stage: configure (also renders the running install checklist) */}
				{stage === "configure" || (stage === "install" && installStarted) ? (
					<div className="flex flex-col" data-testid="auth-jb-steps">
						{stage === "configure"
							? CONFIGURE_STEPS.map(({ step, label, command }) => {
									const live = jbFlow?.steps.find((s) => s.step === step);
									return (
										<StepRow
											key={step}
											label={label}
											status={live?.status ?? "pending"}
											detail={live?.detail ?? command}
										/>
									);
								})
							: (jbFlow?.steps ?? []).map((s) => (
									<StepRow
										key={s.step}
										label={STAGE_LABEL.install}
										status={s.status}
										detail={s.detail}
									/>
								))}
						<LogTail lines={jbFlow?.logs ?? []} />
					</div>
				) : null}

				<div className="flex items-center gap-md pt-xs">
					{failed ? (
						<Button data-testid="auth-jb-retry" size="sm" onClick={retry}>
							<RotateCcw className="size-3.5" /> Retry this step
						</Button>
					) : null}
					{stage === "login" && !running && !failed ? (
						<Button data-testid="auth-jb-signin" size="sm" onClick={() => start("jbcentral.login")}>
							Sign in to JetBrains
						</Button>
					) : null}
					<Button data-testid="auth-jb-cancel" variant="ghost" size="sm" onClick={cancel}>
						Cancel
					</Button>
				</div>
			</div>
		</section>
	);
}
