import type { AuthProviderStatus } from "@thinkrail/contracts";
import { AlertCircle, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { ProviderMark } from "./ProviderMark";

/**
 * The "Use an API key" form: a searchable catalog of every key-capable provider (from
 * `auth.status`), a masked key field, the env-var hint, and Save → `auth.setApiKey` (the one write
 * that carries a credential; it's never rendered back). Success flips `modelCount` on the host,
 * which the gate turns into the success screen.
 */
export function ApiKeyPanel({ onCancel }: { onCancel: () => void }) {
	const authStatus = useAppStore((s) => s.authStatus);
	const setAuthStatus = useAppStore((s) => s.setAuthStatus);
	const providers = useMemo(
		() => (authStatus?.providers ?? []).filter((p) => p.kind === "api_key"),
		[authStatus],
	);
	const [filter, setFilter] = useState("");
	const [selectedId, setSelectedId] = useState<string>("anthropic");
	const [key, setKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [savedFor, setSavedFor] = useState<string | null>(null);

	const visible = providers.filter((p) =>
		`${p.id} ${p.name}`.toLowerCase().includes(filter.toLowerCase()),
	);
	const selected: AuthProviderStatus | undefined =
		providers.find((p) => p.id === selectedId) ?? visible[0];

	const save = async () => {
		if (!selected || key.trim() === "" || saving) return;
		setSaving(true);
		setError(null);
		try {
			const status = await getTransport().request("auth.setApiKey", {
				providerId: selected.id,
				key,
			});
			setAuthStatus(status);
			setKey("");
			setSavedFor(selected.id);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<section data-testid="auth-apikey-panel" className="flex flex-col">
			<header className="flex items-center gap-md border-border border-b px-lg py-md">
				<ProviderMark id="api-key" size="md" />
				<div className="min-w-0">
					<h2 className="font-semibold text-md text-text">Connect with an API key</h2>
					<p className="text-hint text-sm">
						Pay-per-token access. The key is written to pi's auth.json on this machine and never
						shown again.
					</p>
				</div>
			</header>

			<div className="flex flex-col gap-md px-lg py-md">
				<div className="flex flex-col gap-xs">
					<label className="font-medium text-muted text-sm" htmlFor="auth-provider-search">
						Provider
					</label>
					<input
						id="auth-provider-search"
						data-testid="auth-provider-search"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder={`Search ${providers.length} providers…`}
						className="h-8 rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm text-sm text-text outline-none placeholder:text-hint focus-visible:border-primary"
					/>
					<div
						data-testid="auth-provider-list"
						className="max-h-52 overflow-y-auto rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] [scrollbar-width:thin]"
					>
						{visible.length === 0 ? (
							<div className="px-md py-sm text-hint text-sm">No providers match.</div>
						) : (
							visible.map((p) => (
								<button
									key={p.id}
									type="button"
									data-testid={`auth-provider-${p.id}`}
									data-selected={selected?.id === p.id}
									onClick={() => setSelectedId(p.id)}
									className={cn(
										"flex w-full items-center gap-md border-border border-b px-md py-sm text-left text-sm text-text last:border-b-0 hover:bg-hover",
										selected?.id === p.id && "bg-[var(--primary-10)]",
									)}
								>
									<span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-elevated font-semibold text-muted text-xs uppercase">
										{p.name[0]}
									</span>
									<span className="min-w-0 flex-1 truncate">{p.name}</span>
									{p.authenticated ? (
										<span className="inline-flex items-center gap-xs text-green text-xs">
											<Check className="size-3" /> configured
										</span>
									) : p.envVar ? (
										<span className="font-[var(--font-mono)] text-hint text-xs">{p.envVar}</span>
									) : null}
								</button>
							))
						)}
					</div>
				</div>

				<form
					className="flex flex-col gap-xs"
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<label className="font-medium text-muted text-sm" htmlFor="auth-apikey-input">
						API key {selected ? `for ${selected.name}` : ""}
					</label>
					<div className="flex gap-sm">
						<input
							id="auth-apikey-input"
							data-testid="auth-apikey-input"
							type="password"
							value={key}
							onChange={(e) => setKey(e.target.value)}
							placeholder={selected?.id === "anthropic" ? "sk-ant-…" : "paste key…"}
							className="h-8 min-w-0 flex-1 rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm font-[var(--font-mono)] text-sm text-text outline-none placeholder:text-hint focus-visible:border-primary"
						/>
						<Button
							data-testid="auth-apikey-save"
							type="submit"
							size="sm"
							disabled={key.trim() === "" || saving || !selected}
						>
							{saving ? "Saving…" : "Save & verify"}
						</Button>
					</div>
					{selected?.envVar ? (
						<p className="text-hint text-xs">
							Already exported{" "}
							<span className="font-[var(--font-mono)] font-semibold">{selected.envVar}</span> in
							your shell? pi picks environment keys up automatically — this form stores a key
							permanently in auth.json.
						</p>
					) : null}
					{error ? (
						<p
							data-testid="auth-apikey-error"
							className="flex items-center gap-xs text-red text-xs"
						>
							<AlertCircle className="size-3.5" /> {error}
						</p>
					) : null}
					{savedFor ? (
						<p
							data-testid="auth-apikey-saved"
							className="flex items-center gap-xs text-green text-xs"
						>
							<Check className="size-3.5" /> Key saved for {savedFor}.
						</p>
					) : null}
				</form>

				<div>
					<Button variant="ghost" size="sm" onClick={onCancel}>
						Back
					</Button>
				</div>
			</div>
		</section>
	);
}
