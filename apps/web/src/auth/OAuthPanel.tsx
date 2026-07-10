import type { AuthProviderStatus } from "@thinkrail/contracts";
import { AlertCircle, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { CopyRow, WaitingPulse } from "./bits";
import { ProviderMark } from "./ProviderMark";

/**
 * A subscription OAuth flow in progress (Claude / ChatGPT / Copilot — any pi OAuth provider).
 * Renders the store's single `authFlow`: waiting pulse, the copyable auth URL ("browser didn't
 * open?" + works-on-another-device), the device code, and the blocking questions (`prompt` /
 * `select` / `manual-code`) answered via `auth.answer`. Cancel is always visible.
 */
export function OAuthPanel({
	provider,
	onCancel,
}: {
	provider: AuthProviderStatus;
	onCancel: () => void;
}) {
	const flow = useAppStore((s) => s.authFlow);
	const clearAuthQuestion = useAppStore((s) => s.clearAuthQuestion);
	const [promptValue, setPromptValue] = useState("");
	const [manualCode, setManualCode] = useState("");

	const failed = flow?.done && !flow.done.ok && flow.done.message !== "cancelled";

	const answer = (requestId: string, value: string | null) => {
		getTransport()
			.request("auth.answer", { requestId, value })
			.catch(() => {});
	};

	const cancel = () => {
		if (flow && !flow.done) {
			getTransport()
				.request("auth.cancel", { flowId: flow.flowId })
				.catch(() => {});
		}
		onCancel();
	};

	const retry = () => {
		getTransport()
			.request("auth.login", { providerId: provider.id })
			.catch(() => {});
	};

	return (
		<section data-testid="auth-oauth-panel" className="flex flex-col">
			<header className="flex items-center gap-md border-border border-b px-lg py-md">
				<ProviderMark id={provider.id} size="md" />
				<div className="min-w-0">
					<h2 className="font-semibold text-md text-text">Sign in — {provider.name}</h2>
					<p className="text-hint text-sm">
						Uses your subscription. ThinkRail never sees your password — only the resulting token,
						stored on this machine.
					</p>
				</div>
			</header>

			<div className="flex flex-col gap-md px-lg py-md">
				{failed ? (
					<div
						data-testid="auth-oauth-error"
						className="flex items-start gap-sm rounded-[var(--radius-md)] border border-red bg-[var(--input-bg)] px-md py-sm text-sm"
					>
						<AlertCircle className="mt-[2px] size-4 shrink-0 text-red" />
						<div className="min-w-0">
							<div className="text-text">Sign-in failed</div>
							<div className="break-words text-hint text-xs">{flow?.done?.message}</div>
						</div>
					</div>
				) : (
					<WaitingPulse
						title={
							flow?.deviceCode
								? "Enter the code below to pair this machine"
								: "Waiting for authorization in your browser…"
						}
						sub={
							flow?.progress ??
							(flow?.deviceCode
								? undefined
								: "A tab should have opened. Approve access there and this screen moves on by itself.")
						}
					/>
				)}

				{flow?.deviceCode ? (
					<div className="flex flex-col items-center gap-sm">
						<div
							data-testid="auth-device-code"
							className="rounded-[var(--radius-md)] border border-border2 bg-bg-dark px-lg py-md font-[var(--font-mono)] font-semibold text-[28px] text-text tracking-[3px]"
						>
							{flow.deviceCode.userCode}
						</div>
						<CopyRow text={flow.deviceCode.verificationUri} testId="auth-device-url" />
					</div>
				) : null}

				{flow?.authUrl ? (
					<>
						<CopyRow text={flow.authUrl} testId="auth-url-row" />
						<p className="text-hint text-xs">
							Browser didn't open? Copy the link into any browser — even on another device.
							{flow.instructions ? ` ${flow.instructions}` : ""}
						</p>
					</>
				) : null}

				{flow?.select ? (
					<div className="flex flex-col gap-sm" data-testid="auth-select">
						<p className="text-sm text-text">{flow.select.message}</p>
						<div className="flex flex-wrap gap-sm">
							{flow.select.options.map((o) => (
								<Button
									key={o.id}
									variant="outline"
									size="sm"
									onClick={() => {
										if (flow.select) answer(flow.select.requestId, o.id);
										clearAuthQuestion("select");
									}}
								>
									{o.label}
								</Button>
							))}
						</div>
					</div>
				) : null}

				{flow?.prompt ? (
					<form
						data-testid="auth-prompt"
						className="flex flex-col gap-sm"
						onSubmit={(e) => {
							e.preventDefault();
							if (!flow.prompt) return;
							if (promptValue.trim() === "" && !flow.prompt.allowEmpty) return;
							answer(flow.prompt.requestId, promptValue);
							setPromptValue("");
							clearAuthQuestion("prompt");
						}}
					>
						<label className="text-sm text-text" htmlFor="auth-prompt-input">
							{flow.prompt.message}
						</label>
						<div className="flex gap-sm">
							<input
								id="auth-prompt-input"
								value={promptValue}
								onChange={(e) => setPromptValue(e.target.value)}
								placeholder={flow.prompt.placeholder ?? ""}
								className="h-8 min-w-0 flex-1 rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm text-sm text-text outline-none placeholder:text-hint focus-visible:border-primary"
							/>
							<Button type="submit" size="sm">
								Submit
							</Button>
						</div>
					</form>
				) : null}

				{flow?.manualCodeRequestId && !failed ? (
					<form
						data-testid="auth-manual-code"
						className="flex gap-sm"
						onSubmit={(e) => {
							e.preventDefault();
							if (manualCode.trim() === "" || !flow.manualCodeRequestId) return;
							answer(flow.manualCodeRequestId, manualCode.trim());
							setManualCode("");
							clearAuthQuestion("manual-code");
						}}
					>
						<input
							value={manualCode}
							onChange={(e) => setManualCode(e.target.value)}
							placeholder="Paste authorization code (optional fallback)"
							className="h-8 min-w-0 flex-1 rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm font-[var(--font-mono)] text-sm text-text outline-none placeholder:text-hint focus-visible:border-primary"
						/>
						<Button type="submit" variant="outline" size="sm">
							Submit code
						</Button>
					</form>
				) : null}

				<div className="flex items-center gap-md pt-xs">
					{failed ? (
						<Button data-testid="auth-oauth-retry" size="sm" onClick={retry}>
							<RotateCcw className="size-3.5" /> Try again
						</Button>
					) : null}
					<Button data-testid="auth-oauth-cancel" variant="ghost" size="sm" onClick={cancel}>
						Cancel sign-in
					</Button>
				</div>
			</div>
		</section>
	);
}
