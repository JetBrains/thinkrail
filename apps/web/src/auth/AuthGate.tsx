import type { AuthProviderStatus } from "@thinkrail/contracts";
import { ArrowLeft, ArrowRight, Check, KeyRound, Loader2, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME } from "../constants/branding";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { ApiKeyPanel } from "./ApiKeyPanel";
import { JbWizard } from "./JbWizard";
import { OAuthPanel } from "./OAuthPanel";
import { ProviderMark } from "./ProviderMark";

type GateView = "home" | "jetbrains" | "oauth" | "apikey";

/** Display copy for the featured OAuth tiles (keyed by pi provider id). */
const TILE_COPY: Record<string, { title: string; blurb: string }> = {
	anthropic: { title: "Claude", blurb: "Sign in with your Claude Pro or Max subscription." },
	"openai-codex": { title: "ChatGPT", blurb: "Codex models with a ChatGPT Plus or Pro plan." },
	"github-copilot": {
		title: "GitHub Copilot",
		blurb: "Use your Copilot seat via a one-time device code.",
	},
};

/**
 * The first-run hard gate: while the host reports zero available models, this full-screen surface IS
 * the app — connect a provider (JetBrains AI hero, the OAuth trio, or an API key) to get in. It's
 * condition-driven (`auth.status.modelCount === 0` after a definitive read), so revoked auth that
 * empties the model list re-engages it, and a success anywhere closes it reactively (after a brief
 * "you're connected" beat with a Start-building CTA).
 */
export function AuthGate() {
	const status = useAppStore((s) => s.status);
	const authStatus = useAppStore((s) => s.authStatus);
	const models = useAppStore((s) => s.models);
	const clearAuthFlow = useAppStore((s) => s.clearAuthFlow);

	const [view, setView] = useState<GateView>("home");
	const [oauthProvider, setOauthProvider] = useState<AuthProviderStatus | null>(null);
	const [celebrate, setCelebrate] = useState(false);
	const wasOpenRef = useRef(false);

	// The gate only ever shows on a DEFINITIVE zero (authStatus loaded), never while loading.
	const needsProvider =
		status === "connected" && authStatus !== null && authStatus.modelCount === 0;

	useEffect(() => {
		if (needsProvider) {
			wasOpenRef.current = true;
		} else if (wasOpenRef.current && authStatus && authStatus.modelCount > 0) {
			// Models arrived while the gate was up → hold it for the success beat.
			setCelebrate(true);
		}
	}, [needsProvider, authStatus]);

	if (!needsProvider && !celebrate) return null;

	const enter = () => {
		wasOpenRef.current = false;
		setCelebrate(false);
		setView("home");
		clearAuthFlow();
	};

	const back = () => {
		setView("home");
		setOauthProvider(null);
	};

	const startOAuth = (provider: AuthProviderStatus) => {
		setOauthProvider(provider);
		setView("oauth");
		getTransport()
			.request("auth.login", { providerId: provider.id })
			.catch(() => {});
	};

	// Featured tiles in design order (Claude → ChatGPT → Copilot), not registry order.
	const TILE_ORDER = ["anthropic", "openai-codex", "github-copilot"];
	const featured = (authStatus?.providers ?? [])
		.filter((p) => p.featured)
		.sort((a, b) => TILE_ORDER.indexOf(a.id) - TILE_ORDER.indexOf(b.id));
	const jb = authStatus?.jbcentral ?? { installed: false, wired: false };
	const success = celebrate || (authStatus != null && authStatus.modelCount > 0);

	return (
		<div
			data-testid="auth-gate"
			className="fixed inset-0 z-50 overflow-y-auto bg-bg-dark text-text"
		>
			{/* atmosphere: one restrained brand glow */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-[-340px] mx-auto h-[640px] w-[min(1100px,100%)] rounded-full bg-[radial-gradient(closest-side,var(--primary-20),transparent_70%)]"
			/>

			<header className="relative flex items-center justify-between px-lg py-md">
				<span className="font-[var(--font-accent)] font-extrabold text-lg text-primary tracking-[0.5px]">
					{PRODUCT_NAME}
				</span>
				<span
					data-testid="auth-gate-pill"
					className="inline-flex items-center gap-sm rounded-full border border-border2 bg-[var(--input-bg)] px-md py-xs text-muted text-sm"
				>
					<span
						className={cn("size-2 rounded-full", success ? "bg-green" : "bg-gold")}
						aria-hidden
					/>
					Host connected ·{" "}
					<span className="font-medium text-text">{authStatus?.modelCount ?? 0} models</span>
				</span>
			</header>

			<main className="relative mx-auto flex w-full max-w-[660px] flex-col px-lg pb-2xl">
				{success ? (
					<section
						data-testid="auth-gate-success"
						className="mt-xl flex flex-col items-center rounded-[var(--radius-lg)] border border-border2 bg-elevated/80 px-lg py-xl text-center shadow-[var(--shadow-lg)]"
					>
						<div className="mb-md grid size-14 place-items-center rounded-full border border-green bg-[var(--green-tint)]">
							<Check className="size-6 text-green" />
						</div>
						<h1 className="font-[var(--font-accent)] font-extrabold text-xl">You're connected</h1>
						<p className="mt-xs text-md text-muted">
							{authStatus?.modelCount ?? models.length} models are ready.
						</p>
						<div className="mt-md flex flex-wrap justify-center gap-sm">
							{models.slice(0, 4).map((m) => (
								<span
									key={`${m.provider}:${m.id}`}
									className="rounded-full border border-border2 bg-[var(--input-bg)] px-md py-xs font-[var(--font-mono)] text-muted text-xs"
								>
									{m.name}
								</span>
							))}
							{models.length > 4 ? (
								<span className="rounded-full border border-border2 bg-[var(--input-bg)] px-md py-xs font-[var(--font-mono)] text-muted text-xs">
									+{models.length - 4} more
								</span>
							) : null}
						</div>
						<Button data-testid="auth-gate-enter" className="mt-lg" onClick={enter}>
							Start building <ArrowRight className="size-4" />
						</Button>
						<p className="mt-md text-hint text-xs">
							Add or remove providers any time in Settings → Providers.
						</p>
					</section>
				) : view === "home" ? (
					<>
						<div className="mt-lg mb-lg text-center">
							<h1 className="font-[var(--font-accent)] font-extrabold text-[clamp(28px,5vw,40px)] leading-[1.15] tracking-[0.2px]">
								Connect a <span className="text-primary">model provider</span>
							</h1>
							<p className="mx-auto mt-sm max-w-[44ch] text-md text-muted">
								{PRODUCT_NAME} drives the pi coding agent. Link one provider — a subscription or an
								API key — and you're in.
							</p>
						</div>

						{/* hero: JetBrains AI */}
						<button
							type="button"
							data-testid="auth-tile-jetbrains"
							onClick={() => setView("jetbrains")}
							className="flex w-full items-center gap-lg rounded-[var(--radius-lg)] border border-[var(--primary-40)] bg-[linear-gradient(135deg,var(--primary-10),var(--input-bg)_46%)] p-lg text-left shadow-[var(--shadow-md)] outline-none transition-colors hover:border-[var(--primary-60)] focus-visible:ring-2 focus-visible:ring-primary max-sm:flex-col max-sm:items-start"
						>
							<ProviderMark id="jetbrains" size="lg" />
							<span className="min-w-0 flex-1">
								<span className="flex items-center gap-sm font-semibold text-lg">
									JetBrains AI
									<span className="rounded-full border border-[var(--primary-40)] bg-[var(--primary-10)] px-sm py-[2px] font-semibold text-primary text-xs uppercase tracking-wider">
										Recommended
									</span>
								</span>
								<span className="mt-xs block text-muted text-sm">
									Claude &amp; GPT models through your JetBrains AI subscription or ThinkRail early
									access — no keys to manage.
								</span>
								<span
									data-testid="auth-jb-state"
									className="mt-sm flex items-center gap-xs font-[var(--font-mono)] text-hint text-xs"
								>
									{jb.wired
										? "proxy wired — reconnect to finish"
										: jb.installed
											? "jbcentral detected — sign in to connect models"
											: "jbcentral not installed — setup takes ~2 minutes"}
								</span>
							</span>
							<span className="inline-flex shrink-0 items-center gap-xs rounded-[var(--radius-md)] bg-primary px-md py-sm font-medium text-on-accent text-sm max-sm:w-full max-sm:justify-center">
								Set up <ArrowRight className="size-4" />
							</span>
						</button>

						{/* the OAuth trio */}
						<div className="mt-md grid grid-cols-3 gap-md max-sm:grid-cols-1">
							{featured.map((p) => {
								const copy = TILE_COPY[p.id] ?? { title: p.name, blurb: p.name };
								return (
									<button
										key={p.id}
										type="button"
										data-testid={`auth-tile-${p.id}`}
										onClick={() => startOAuth(p)}
										className="flex flex-col gap-sm rounded-[var(--radius-lg)] border border-border2 bg-elevated/70 p-md text-left outline-none transition-colors hover:border-[var(--primary-40)] hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary"
									>
										<span className="flex items-center gap-sm">
											<ProviderMark id={p.id} size="sm" />
											<span className="font-semibold text-sm">{copy.title}</span>
											{p.authenticated ? <Check className="ml-auto size-3.5 text-green" /> : null}
										</span>
										<span className="flex-1 text-hint text-sm leading-snug">{copy.blurb}</span>
										<span className="inline-flex items-center gap-xs font-semibold text-primary text-sm">
											Sign in <ArrowRight className="size-3" />
										</span>
									</button>
								);
							})}
						</div>

						<div className="my-lg flex items-center gap-md text-hint text-sm">
							<span className="h-px flex-1 bg-border2 opacity-70" />
							or
							<span className="h-px flex-1 bg-border2 opacity-70" />
						</div>

						<div className="flex justify-center">
							<button
								type="button"
								data-testid="auth-apikey-toggle"
								onClick={() => setView("apikey")}
								className="inline-flex items-center gap-sm rounded-[var(--radius-md)] px-md py-sm font-medium text-muted text-sm outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
							>
								<KeyRound className="size-4" />
								Use an API key instead — Anthropic, OpenAI, Google, Groq &amp; more
							</button>
						</div>

						<p className="mx-auto mt-xl max-w-[56ch] text-center text-hint text-xs">
							<Lock className="mr-xs inline size-3 align-[-2px]" />
							Credentials stay on this machine, in pi's{" "}
							<span className="font-[var(--font-mono)]">~/.pi/agent/auth.json</span>. The browser
							only ever sees connection status.
						</p>
					</>
				) : (
					<>
						<button
							type="button"
							data-testid="auth-gate-back"
							onClick={back}
							className="mb-md inline-flex w-fit items-center gap-xs rounded-[var(--radius-md)] px-sm py-xs font-medium text-muted text-sm outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
						>
							<ArrowLeft className="size-3.5" /> All providers
						</button>
						<div className="overflow-hidden rounded-[var(--radius-lg)] border border-border2 bg-elevated/80 shadow-[var(--shadow-lg)]">
							{view === "jetbrains" ? <JbWizard jbcentral={jb} onCancel={back} /> : null}
							{view === "oauth" && oauthProvider ? (
								<OAuthPanel provider={oauthProvider} onCancel={back} />
							) : null}
							{view === "apikey" ? <ApiKeyPanel onCancel={back} /> : null}
						</div>
					</>
				)}

				{status !== "connected" ? (
					<p className="mt-lg flex items-center justify-center gap-sm text-hint text-sm">
						<Loader2 className="size-3.5 animate-spin" /> Reconnecting to the host…
					</p>
				) : null}
			</main>
		</div>
	);
}
