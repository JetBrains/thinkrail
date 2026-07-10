import type { AuthProviderStatus } from "@thinkrail/contracts";
import { Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { ProviderMark } from "./ProviderMark";

/** "Connected" / "Not connected" pill with the auth source when known. */
function StatusPill({ provider }: { provider: AuthProviderStatus }) {
	return (
		<span
			data-testid={`settings-provider-status-${provider.id}`}
			data-connected={provider.authenticated}
			className={`inline-flex items-center gap-xs text-xs ${provider.authenticated ? "text-green" : "text-hint"}`}
		>
			{provider.authenticated ? <Check className="size-3" /> : <X className="size-3" />}
			{provider.authenticated ? (provider.label ?? "Connected") : "Not connected"}
		</span>
	);
}

/**
 * Settings → Providers: the durable management surface once the gate is gone. OAuth rows (Sign in /
 * Sign out), the JetBrains AI proxy block (wire / remove wiring), and a compact add-an-API-key form.
 * All writes round-trip through the host and land as a fresh `auth.status` snapshot.
 */
export function ProvidersSection() {
	const authStatus = useAppStore((s) => s.authStatus);
	const setAuthStatus = useAppStore((s) => s.setAuthStatus);
	const flow = useAppStore((s) => s.authFlow);
	const [busy, setBusy] = useState<string | null>(null);
	const [keyProvider, setKeyProvider] = useState("anthropic");
	const [keyValue, setKeyValue] = useState("");
	const [keyError, setKeyError] = useState<string | null>(null);

	if (!authStatus) {
		return (
			<section className="flex flex-col gap-sm">
				<h3 className="font-medium text-muted text-xs uppercase tracking-wider">Model providers</h3>
				<p className="flex items-center gap-sm text-hint text-sm">
					<Loader2 className="size-3.5 animate-spin" /> Loading provider status…
				</p>
			</section>
		);
	}

	const featured = authStatus.providers.filter((p) => p.featured);
	const keyCapable = authStatus.providers.filter((p) => p.kind === "api_key");
	const flowRunning = flow != null && !flow.done;

	const run = async (id: string, action: () => Promise<void>) => {
		setBusy(id);
		try {
			await action();
		} catch {
			/* the fresh status refetch reconciles */
		} finally {
			setBusy(null);
		}
	};

	const signIn = (provider: AuthProviderStatus) =>
		run(provider.id, async () => {
			await getTransport().request("auth.login", { providerId: provider.id });
		});

	const signOut = (provider: AuthProviderStatus) =>
		run(provider.id, async () => {
			setAuthStatus(await getTransport().request("auth.logout", { providerId: provider.id }));
		});

	const saveKey = () =>
		run("apikey", async () => {
			setKeyError(null);
			try {
				setAuthStatus(
					await getTransport().request("auth.setApiKey", {
						providerId: keyProvider,
						key: keyValue,
					}),
				);
				setKeyValue("");
			} catch (err) {
				setKeyError(err instanceof Error ? err.message : String(err));
			}
		});

	const wire = () =>
		run("jbcentral", async () => {
			await getTransport().request("jbcentral.configure", {});
		});

	const unwire = () =>
		run("jbcentral", async () => {
			setAuthStatus(await getTransport().request("jbcentral.unwire", {}));
		});

	return (
		<section data-testid="settings-providers" className="flex flex-col gap-sm">
			<h3 className="font-medium text-muted text-xs uppercase tracking-wider">Model providers</h3>

			{/* subscription OAuth rows */}
			<div className="flex flex-col rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)]">
				{featured.map((p) => (
					<div
						key={p.id}
						data-testid={`settings-provider-${p.id}`}
						className="flex items-center gap-md border-border border-b px-md py-sm last:border-b-0"
					>
						<ProviderMark id={p.id} size="sm" />
						<div className="min-w-0 flex-1">
							<div className="truncate font-medium text-sm text-text">{p.name}</div>
							<StatusPill provider={p} />
						</div>
						{p.authenticated ? (
							<Button
								variant="outline"
								size="sm"
								disabled={busy === p.id}
								onClick={() => void signOut(p)}
							>
								Sign out
							</Button>
						) : (
							<Button
								size="sm"
								disabled={busy === p.id || flowRunning}
								onClick={() => void signIn(p)}
							>
								Sign in
							</Button>
						)}
					</div>
				))}

				{/* JetBrains AI (jbcentral proxy) */}
				<div
					data-testid="settings-provider-jetbrains"
					className="flex items-center gap-md px-md py-sm"
				>
					<ProviderMark id="jetbrains" size="sm" />
					<div className="min-w-0 flex-1">
						<div className="truncate font-medium text-sm text-text">JetBrains AI</div>
						<span
							data-testid="settings-jb-status"
							data-wired={authStatus.jbcentral.wired}
							className={`text-xs ${authStatus.jbcentral.wired ? "text-green" : "text-hint"}`}
						>
							{authStatus.jbcentral.wired
								? "Proxy wired (anthropic + openai routed)"
								: authStatus.jbcentral.installed
									? "CLI installed, proxy not wired"
									: "CLI not installed"}
						</span>
					</div>
					{authStatus.jbcentral.wired ? (
						<Button
							variant="outline"
							size="sm"
							disabled={busy === "jbcentral"}
							onClick={() => void unwire()}
						>
							Remove wiring
						</Button>
					) : (
						<Button
							size="sm"
							disabled={busy === "jbcentral" || flowRunning || !authStatus.jbcentral.installed}
							title={
								authStatus.jbcentral.installed
									? undefined
									: "Install jbcentral first (see the connect screen)"
							}
							onClick={() => void wire()}
						>
							Wire proxy
						</Button>
					)}
				</div>
			</div>

			{/* a running flow started from here (OAuth / configure) — minimal live line */}
			{flowRunning ? (
				<p className="flex items-center gap-sm text-hint text-xs" data-testid="settings-auth-flow">
					<Loader2 className="size-3 animate-spin" />
					{flow?.progress ?? "Working… follow your browser if it opened."}
					{flow?.authUrl ? (
						<a
							href={flow.authUrl}
							target="_blank"
							rel="noreferrer"
							className="text-blue underline-offset-2 hover:underline"
						>
							open the sign-in page
						</a>
					) : null}
				</p>
			) : null}

			{/* add an API key */}
			<form
				className="flex flex-col gap-xs"
				onSubmit={(e) => {
					e.preventDefault();
					if (keyValue.trim() !== "") void saveKey();
				}}
			>
				<div className="flex gap-sm">
					<select
						data-testid="settings-apikey-provider"
						value={keyProvider}
						onChange={(e) => setKeyProvider(e.target.value)}
						className="h-7 max-w-[40%] rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm text-sm text-text outline-none focus-visible:border-primary"
					>
						{keyCapable.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
								{p.authenticated ? " ✓" : ""}
							</option>
						))}
					</select>
					<input
						data-testid="settings-apikey-input"
						type="password"
						value={keyValue}
						onChange={(e) => setKeyValue(e.target.value)}
						placeholder="Add or replace API key…"
						className="h-7 min-w-0 flex-1 rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm font-[var(--font-mono)] text-sm text-text outline-none placeholder:text-hint focus-visible:border-primary"
					/>
					<Button
						data-testid="settings-apikey-save"
						type="submit"
						size="sm"
						disabled={keyValue.trim() === "" || busy === "apikey"}
					>
						Save
					</Button>
				</div>
				{keyError ? <p className="text-red text-xs">{keyError}</p> : null}
				<p className="text-hint text-xs">
					{authStatus.modelCount} models available. Keys are stored on the host in pi's auth.json —
					never shown again.
				</p>
			</form>
		</section>
	);
}
