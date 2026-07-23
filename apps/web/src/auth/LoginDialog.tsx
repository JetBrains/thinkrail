import { Check, ExternalLink, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { LoginState } from "./loginState";

/**
 * The in-app OAuth login dialog — **presentational** (no store/transport): it renders the accumulated
 * `LoginState` and calls back. `onReply` answers a live `select`/`prompt` frame; `onCancel` aborts an
 * in-flight login; `onClose` dismisses a terminal (success/error) one. The `url` and a paste `prompt` can
 * be shown together (the browser-vs-paste race). Mount with `key={state.loginId}` for fresh local state;
 * the prompt field is uncontrolled, so it also resets each time the integrator clears the live input.
 */
export function LoginDialog({
	state,
	providerName,
	onReply,
	onCancel,
	onClose,
}: {
	state: LoginState;
	providerName: string;
	onReply: (value: string) => void;
	onCancel: () => void;
	onClose: () => void;
}) {
	const promptRef = useRef<HTMLInputElement>(null);

	// Best-effort: open the device-verification page automatically in a new tab. This fires right after the
	// user's Submit gesture on the host prompt, so it's usually inside the browser's transient-activation
	// window (not popup-blocked); if a blocker does stop it, the clickable link below is the reliable
	// fallback. The ref guards against re-opening on re-render / StrictMode's double-invoke.
	const openedUrlRef = useRef<string | null>(null);
	const deviceUri = state.deviceCode?.verificationUri;
	useEffect(() => {
		if (!deviceUri || openedUrlRef.current === deviceUri) return;
		openedUrlRef.current = deviceUri;
		window.open(deviceUri, "_blank", "noopener,noreferrer");
	}, [deviceUri]);

	const submitPrompt = () => {
		const value = promptRef.current?.value.trim() ?? "";
		// A non-empty answer always submits; an empty one only when pi marked the prompt `allowEmpty`
		// (e.g. Copilot's "blank for github.com") — otherwise a blank submit is a no-op, not a dead-end.
		const allowEmpty = state.input?.kind === "prompt" && state.input.allowEmpty;
		if (value || allowEmpty) onReply(value);
	};

	const terminal = state.status !== "active";
	const dismiss = () => (terminal ? onClose() : onCancel());

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) dismiss();
			}}
		>
			<DialogContent
				data-testid="login-dialog"
				data-provider={state.providerId}
				data-status={state.status}
				// Cap height + scroll so a long URL / verbose provider error can't overflow the viewport.
				className="max-h-[85vh] overflow-y-auto"
			>
				<DialogHeader>
					<DialogTitle>
						{/* "Connect", not "Sign in" — one dialog serves OAuth and API-key entry alike. */}
						{state.status === "success"
							? `${providerName} connected`
							: state.status === "error"
								? "Couldn't connect"
								: `Connect ${providerName}`}
					</DialogTitle>
					{state.instructions && state.status === "active" ? (
						<DialogDescription>{state.instructions}</DialogDescription>
					) : null}
				</DialogHeader>

				{state.status === "success" ? (
					<p className="flex items-center gap-sm text-green text-sm" data-testid="login-success">
						<Check className="size-4 shrink-0" />
						{providerName} is connected.
					</p>
				) : state.status === "error" ? (
					<p className="flex items-start gap-sm text-red text-sm" data-testid="login-error">
						<TriangleAlert className="mt-0.5 size-4 shrink-0" />
						<span className="min-w-0 break-words">{state.error ?? "Login failed."}</span>
					</p>
				) : (
					<div className="flex flex-col gap-md">
						{state.url ? (
							<div className="flex flex-col gap-xs">
								<Button
									data-testid="login-open-url"
									onClick={() => window.open(state.url, "_blank", "noopener,noreferrer")}
								>
									<ExternalLink className="size-4" />
									Open sign-in page
								</Button>
								<code className="select-all break-all rounded-[var(--radius-sm)] bg-[var(--input-bg)] px-sm py-xs font-[var(--font-mono)] text-hint text-xs">
									{state.url}
								</code>
							</div>
						) : null}

						{state.deviceCode ? (
							<div
								className="flex flex-col gap-xs rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] p-md"
								data-testid="login-device-code"
							>
								<span className="text-hint text-xs">
									Enter this code at{" "}
									<a
										href={state.deviceCode.verificationUri}
										target="_blank"
										rel="noopener noreferrer"
										data-testid="login-device-url"
										className="inline-flex items-center gap-0.5 break-all rounded-[var(--radius-sm)] text-primary underline underline-offset-2 outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary"
									>
										{state.deviceCode.verificationUri}
										<ExternalLink className="size-3 shrink-0" />
									</a>
								</span>
								<code className="select-all text-center font-[var(--font-mono)] text-lg text-text tracking-widest">
									{state.deviceCode.userCode}
								</code>
							</div>
						) : null}

						{state.input?.kind === "select" ? (
							<div className="flex flex-col gap-xs">
								{state.input.message ? (
									<p className="text-muted text-sm">{state.input.message}</p>
								) : null}
								{state.input.options.map((option) => (
									<button
										key={option.id}
										type="button"
										data-testid="login-option"
										data-option={option.id}
										onClick={() => onReply(option.id)}
										className="rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-md py-sm text-left text-sm text-text outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary"
									>
										{option.label}
									</button>
								))}
							</div>
						) : null}

						{state.input?.kind === "prompt" ? (
							<div className="flex flex-col gap-xs">
								{state.input.message ? (
									<p className="text-muted text-sm">{state.input.message}</p>
								) : null}
								<div className="flex gap-sm">
									<input
										ref={promptRef}
										data-testid="login-input"
										autoFocus
										type={state.input.secret ? "password" : "text"}
										placeholder={state.input.placeholder ?? ""}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												e.preventDefault();
												submitPrompt();
											}
										}}
										className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm py-xs text-sm text-text outline-none placeholder:text-hint focus:border-primary"
									/>
									<Button data-testid="login-submit" onClick={submitPrompt}>
										Submit
									</Button>
								</div>
							</div>
						) : null}

						{state.progress ? (
							<p
								className="flex items-center gap-sm text-hint text-sm"
								data-testid="login-progress"
							>
								<Loader2 className="size-4 shrink-0 animate-spin" />
								{state.progress}
							</p>
						) : null}

						{!state.url && !state.deviceCode && !state.input && !state.progress ? (
							<p className="flex items-center gap-sm text-hint text-sm" data-testid="login-working">
								<Loader2 className="size-4 shrink-0 animate-spin" />
								Working…
							</p>
						) : null}
					</div>
				)}

				<DialogFooter>
					{terminal ? (
						<Button variant="outline" data-testid="login-close" onClick={onClose}>
							Done
						</Button>
					) : (
						<Button variant="outline" data-testid="login-cancel" onClick={onCancel}>
							Cancel
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
