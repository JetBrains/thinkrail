import { RiLockLine as Lock } from "@remixicon/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getTransport } from "../transport";

let submittedToken = false;

export function LaunchTokenScreen() {
	const [token, setToken] = useState("");
	const [rejected] = useState(() => submittedToken);
	const value = token.trim();

	return (
		<div
			data-testid="launch-token-screen"
			className="flex h-full min-h-0 flex-col items-center justify-center gap-12 overflow-auto p-16 text-center"
		>
			<Lock className="size-24 text-feedback-warning" />
			<p className="tr-title-compact text-text-default">This page is not connected to ThinkRail</p>
			<p className="max-w-[28rem] tr-text-metadata text-text-muted">
				Re-open ThinkRail from the CLI: use the <code className="tr-code-text">thinkrail →</code>{" "}
				link it prints. Or paste the launch token from that link below.
			</p>
			{rejected ? (
				<p data-testid="launch-token-rejected" className="tr-text-ui text-feedback-error">
					The host rejected that token.
				</p>
			) : null}
			<form
				className="flex w-full max-w-[28rem] items-center gap-8"
				onSubmit={(event) => {
					event.preventDefault();
					if (!value) return;
					submittedToken = true;
					getTransport().authorize(value);
				}}
			>
				<input
					data-testid="launch-token-input"
					aria-label="Launch token"
					autoComplete="off"
					spellCheck={false}
					value={token}
					onChange={(event) => setToken(event.target.value)}
					placeholder="Launch token"
					className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active"
				/>
				<Button type="submit" data-testid="launch-token-submit" disabled={!value}>
					Connect
				</Button>
			</form>
		</div>
	);
}
