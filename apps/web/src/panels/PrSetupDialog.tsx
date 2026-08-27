import {
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiPlayLine as Play,
	RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import type { GhSetupProblem, HostPlatform } from "@thinkrail/contracts";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { copyText } from "@/lib";

export type PrSetupState =
	| { kind: "push-auth"; detail: string }
	| { kind: "gh"; problem: GhSetupProblem; compareUrl?: string };

function CommandRow({ command, onRun }: { command: string; onRun: (command: string) => void }) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		if (await copyText(command)) {
			setCopied(true);
			setTimeout(() => setCopied(false), 1_500);
		}
	};
	return (
		<div className="flex items-center gap-8 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
			<code className="min-w-0 flex-1 truncate tr-code-text text-text-default">{command}</code>
			<Button
				variant="ghost"
				size="icon"
				data-testid="open-pr-setup-copy"
				aria-label="Copy command"
				onClick={() => void copy()}
			>
				{copied ? (
					<Check className="size-14 text-feedback-success" />
				) : (
					<Copy className="size-14" />
				)}
			</Button>
			<Button
				variant="outline"
				size="sm"
				data-testid="open-pr-setup-run"
				title="Run this command in a workspace terminal — answer its prompts there"
				onClick={() => onRun(command)}
			>
				<Play className="size-14" />
				Run
			</Button>
		</div>
	);
}

const GH_TITLE: Record<GhSetupProblem, string> = {
	missing: "GitHub CLI isn't installed",
	unauthenticated: "GitHub CLI isn't signed in",
};

const GH_DESCRIPTION: Record<GhSetupProblem, string> = {
	missing:
		"The branch was pushed, but creating the PR directly needs the GitHub CLI on this machine. Install it and sign in, then Open PR creates and updates PRs in one click.",
	unauthenticated:
		"The branch was pushed, but the GitHub CLI on this machine isn't signed in, so the PR can't be created directly. Sign in, then try again.",
};

const SSH_ADD_COMMAND: Record<HostPlatform, string> = {
	darwin: "ssh-add --apple-use-keychain ~/.ssh/id_ed25519",
	linux: "ssh-add ~/.ssh/id_ed25519",
	win32: "ssh-add $env:USERPROFILE\\.ssh\\id_ed25519",
};

const SSH_ADD_HINT: Record<HostPlatform, string> = {
	darwin: "SSH remote: load your key into the agent once — Keychain remembers the passphrase.",
	linux: "SSH remote: load your key into the ssh-agent once.",
	win32: "SSH remote: load your key into the ssh-agent once (needs the OpenSSH Agent service).",
};

const GH_INSTALL_COMMAND: Record<HostPlatform, string | null> = {
	darwin: "brew install gh",
	linux: "sudo apt install gh",
	win32: "winget install --id GitHub.cli",
};

const GH_INSTALL_HINT: Record<HostPlatform, string | null> = {
	darwin: null,
	linux: "apt is the Debian/Ubuntu route — use your distro's package manager otherwise.",
	win32: null,
};

const HOST_KEY_PATTERN = /host key verification failed/i;

function sshAddCommand(platform: HostPlatform | null): string {
	return platform ? SSH_ADD_COMMAND[platform] : "ssh-add ~/.ssh/id_ed25519";
}

function sshAddHint(platform: HostPlatform | null): string {
	return platform ? SSH_ADD_HINT[platform] : "SSH remote: load your key into the ssh-agent once.";
}

function ghCommands(problem: GhSetupProblem, platform: HostPlatform | null): string[] {
	const install = platform ? GH_INSTALL_COMMAND[platform] : null;
	return problem === "missing" && install ? [install, "gh auth login"] : ["gh auth login"];
}

function ghInstallHint(problem: GhSetupProblem, platform: HostPlatform | null): string | null {
	if (problem !== "missing") return null;
	if (!platform) return "Install the GitHub CLI first — cli.github.com — then sign in:";
	return GH_INSTALL_HINT[platform];
}

export function PrSetupDialog({
	state,
	platform,
	onClose,
	onRetry,
	onRun,
	onCompareOpen,
}: {
	state: PrSetupState | null;
	platform: HostPlatform | null;
	onClose: () => void;
	onRetry: () => void;
	onRun: (command: string) => void;
	onCompareOpen: () => void;
}) {
	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				data-testid="open-pr-setup-dialog"
				data-reason={state?.kind === "gh" ? `gh-${state.problem}` : state?.kind}
			>
				{state?.kind === "push-auth" ? (
					<>
						<DialogHeader>
							<DialogTitle>Git push couldn't authenticate</DialogTitle>
							<DialogDescription>
								ThinkRail pushes without a terminal, so SSH passphrase and credential prompts can't
								appear. Make your git auth non-interactive, then try again.
							</DialogDescription>
						</DialogHeader>
						<pre
							data-testid="open-pr-setup-detail"
							className="max-h-128 overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8 tr-code-text text-feedback-error"
						>
							{state.detail}
						</pre>
						<div className="flex flex-col gap-8">
							{HOST_KEY_PATTERN.test(state.detail) ? (
								<>
									<p className="tr-text-ui text-text-muted">
										This host's SSH key isn't in known_hosts yet — connect once and answer "yes" to
										approve it:
									</p>
									<CommandRow command="ssh -T git@github.com" onRun={onRun} />
								</>
							) : null}
							<p className="tr-text-ui text-text-muted">{sshAddHint(platform)}</p>
							<CommandRow command={sshAddCommand(platform)} onRun={onRun} />
							<p className="tr-text-ui text-text-muted">
								HTTPS remote: sign in with the GitHub CLI instead.
							</p>
							<CommandRow command="gh auth login" onRun={onRun} />
						</div>
					</>
				) : state?.kind === "gh" ? (
					<>
						<DialogHeader>
							<DialogTitle>{GH_TITLE[state.problem]}</DialogTitle>
							<DialogDescription>{GH_DESCRIPTION[state.problem]}</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-8">
							{ghInstallHint(state.problem, platform) ? (
								<p className="tr-text-ui text-text-muted">
									{ghInstallHint(state.problem, platform)}
								</p>
							) : null}
							{ghCommands(state.problem, platform).map((command) => (
								<CommandRow key={command} command={command} onRun={onRun} />
							))}
						</div>
						{state.compareUrl ? (
							<p className="tr-text-ui text-text-muted">
								No rush — GitHub's compare page can create this PR right now, prefilled from the
								plan.
							</p>
						) : null}
					</>
				) : null}
				<DialogFooter>
					{state?.kind === "gh" && state.compareUrl ? (
						<a
							data-testid="open-pr-setup-compare"
							href={state.compareUrl}
							target="_blank"
							rel="noopener noreferrer"
							onClick={onCompareOpen}
							className={buttonVariants({ variant: "outline" })}
						>
							<ExternalLink className="size-14" />
							Open compare page
						</a>
					) : null}
					<Button data-testid="open-pr-setup-retry" onClick={onRetry}>
						<RefreshCw className="size-14" />
						Try again
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
