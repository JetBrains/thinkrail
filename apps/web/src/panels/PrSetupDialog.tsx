import {
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiPlayLine as Play,
	RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import type { GhSetupProblem, HostPlatform } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button, buttonVariants, IconButton, withIconClass } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { Textarea } from "@thinkrail/ui/textarea";
import { useState } from "react";
import { copyText } from "@/lib";

export type PrSetupState =
	| { kind: "push-auth"; detail: string }
	/** `omittedBody`: the description did not fit the compare URL, so the dialog has to show it. */
	| { kind: "gh"; problem: GhSetupProblem; compareUrl?: string; omittedBody?: string }
	/** The compare fallback could not carry the description and `gh` was not the problem. */
	| { kind: "compare-body"; compareUrl: string; body: string };

const CopiedIcon = withIconClass(Check, "text-feedback-success");

/**
 * The full PR description, when it could not ride in the compare URL.
 *
 * A read-only textarea keeps it selectable, which is what `lib/SPEC.md` asks of a failed clipboard
 * write (an insecure context such as plain-HTTP remote access has no `navigator.clipboard`, and a
 * denied permission fails the same way). The copy button is the convenience, never the only way out:
 * its "copied" state is set only from `copyText`'s own answer.
 */
export function DescriptionBox({ body }: { body: string }) {
	const t = useT();
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		if (await copyText(body)) {
			setCopied(true);
			setTimeout(() => setCopied(false), 1_500);
		}
	};
	return (
		<div className="flex min-h-0 flex-col gap-8">
			<Textarea
				readOnly
				value={body}
				data-testid="open-pr-omitted-body"
				rows={10}
				className="min-h-160 flex-1 resize-y tr-code-text"
			/>
			<div className="flex justify-end">
				<Button
					variant="outline"
					size="m"
					iconLeft={copied ? CopiedIcon : Copy}
					tooltip={t("panels.prSetup.copyDescription")}
					data-testid="open-pr-omitted-body-copy"
					onClick={() => void copy()}
				>
					{t(copied ? "panels.prSetup.copied" : "panels.prSetup.copyDescription")}
				</Button>
			</div>
		</div>
	);
}

function CommandRow({ command, onRun }: { command: string; onRun: (command: string) => void }) {
	const t = useT();
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		if (await copyText(command)) {
			setCopied(true);
			setTimeout(() => setCopied(false), 1_500);
		}
	};
	return (
		<div className="flex items-center gap-8 rounded-sm border border-border-default bg-control-bg px-12 py-8">
			<code className="min-w-0 flex-1 truncate tr-code-text text-text-default">{command}</code>
			<IconButton
				icon={copied ? CopiedIcon : Copy}
				label={t("panels.prSetup.copyCommand")}
				variant="ghost"
				size="m"
				data-testid="open-pr-setup-copy"
				onClick={() => void copy()}
			/>
			<Button
				variant="outline"
				size="m"
				iconLeft={Play}
				tooltip={t("panels.prSetup.runTitle")}
				data-testid="open-pr-setup-run"
				onClick={() => onRun(command)}
			>
				{t("panels.prSetup.run")}
			</Button>
		</div>
	);
}

const GH_TITLE = {
	missing: "panels.prSetup.ghMissingTitle",
	unauthenticated: "panels.prSetup.ghUnauthenticatedTitle",
} satisfies Record<GhSetupProblem, MessageKey>;

const GH_DESCRIPTION = {
	missing: "panels.prSetup.ghMissingDescription",
	unauthenticated: "panels.prSetup.ghUnauthenticatedDescription",
} satisfies Record<GhSetupProblem, MessageKey>;

const SSH_ADD_COMMAND: Record<HostPlatform, string> = {
	darwin: "ssh-add --apple-use-keychain ~/.ssh/id_ed25519",
	linux: "ssh-add ~/.ssh/id_ed25519",
	win32: "ssh-add $env:USERPROFILE\\.ssh\\id_ed25519",
};

const SSH_ADD_HINT = {
	darwin: "panels.prSetup.sshAddHintDarwin",
	linux: "panels.prSetup.sshAddHint",
	win32: "panels.prSetup.sshAddHintWin32",
} satisfies Record<HostPlatform, MessageKey>;

const GH_INSTALL_COMMAND: Record<HostPlatform, string | null> = {
	darwin: "brew install gh",
	linux: "sudo apt install gh",
	win32: "winget install --id GitHub.cli",
};

const GH_INSTALL_HINT: Record<HostPlatform, MessageKey | null> = {
	darwin: null,
	linux: "panels.prSetup.ghInstallHintLinux",
	win32: null,
};

const HOST_KEY_PATTERN = /host key verification failed/i;

function sshAddCommand(platform: HostPlatform | null): string {
	return platform ? SSH_ADD_COMMAND[platform] : "ssh-add ~/.ssh/id_ed25519";
}

function sshAddHint(platform: HostPlatform | null): MessageKey {
	return platform ? SSH_ADD_HINT[platform] : "panels.prSetup.sshAddHint";
}

function ghCommands(problem: GhSetupProblem, platform: HostPlatform | null): string[] {
	const install = platform ? GH_INSTALL_COMMAND[platform] : null;
	return problem === "missing" && install ? [install, "gh auth login"] : ["gh auth login"];
}

function ghInstallHint(problem: GhSetupProblem, platform: HostPlatform | null): MessageKey | null {
	if (problem !== "missing") return null;
	if (!platform) return "panels.prSetup.ghInstallHint";
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
	const t = useT();
	const installHint = state?.kind === "gh" ? ghInstallHint(state.problem, platform) : null;
	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				data-testid="open-pr-setup-dialog"
				data-reason={
					state?.kind === "gh"
						? `gh-${state.problem}`
						: state?.kind === "compare-body"
							? "compare-body"
							: state?.kind
				}
			>
				{state?.kind === "push-auth" ? (
					<>
						<DialogHeader>
							<DialogTitle>{t("panels.prSetup.pushAuthTitle")}</DialogTitle>
							<DialogDescription>{t("panels.prSetup.pushAuthDescription")}</DialogDescription>
						</DialogHeader>
						<pre
							data-testid="open-pr-setup-detail"
							className="max-h-128 shrink-0 overflow-auto whitespace-pre-wrap rounded-sm border border-border-default bg-control-bg px-12 py-8 tr-code-text text-feedback-error"
						>
							{state.detail}
						</pre>
						<div className="flex flex-col gap-8">
							{HOST_KEY_PATTERN.test(state.detail) ? (
								<>
									<p className="tr-text-ui text-text-muted">{t("panels.prSetup.hostKeyHint")}</p>
									<CommandRow command="ssh -T git@github.com" onRun={onRun} />
								</>
							) : null}
							<p className="tr-text-ui text-text-muted">{t(sshAddHint(platform))}</p>
							<CommandRow command={sshAddCommand(platform)} onRun={onRun} />
							<p className="tr-text-ui text-text-muted">{t("panels.prSetup.httpsHint")}</p>
							<CommandRow command="gh auth login" onRun={onRun} />
						</div>
					</>
				) : state?.kind === "gh" ? (
					<>
						<DialogHeader>
							<DialogTitle>{t(GH_TITLE[state.problem])}</DialogTitle>
							<DialogDescription>{t(GH_DESCRIPTION[state.problem])}</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-8">
							{installHint ? <p className="tr-text-ui text-text-muted">{t(installHint)}</p> : null}
							{ghCommands(state.problem, platform).map((command) => (
								<CommandRow key={command} command={command} onRun={onRun} />
							))}
						</div>
						{state.omittedBody === undefined ? null : (
							<>
								<p className="tr-text-ui text-text-muted">{t("panels.prSetup.bodyDescription")}</p>
								<DescriptionBox body={state.omittedBody} />
							</>
						)}
						{state.compareUrl ? (
							<p className="tr-text-ui text-text-muted">{t("panels.prSetup.compareHint")}</p>
						) : null}
					</>
				) : state?.kind === "compare-body" ? (
					<>
						<DialogHeader>
							<DialogTitle>{t("panels.prSetup.bodyTitle")}</DialogTitle>
							<DialogDescription>{t("panels.prSetup.bodyDescription")}</DialogDescription>
						</DialogHeader>
						<DescriptionBox body={state.body} />
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
							className={buttonVariants({ variant: "outline", size: "l" })}
						>
							<ExternalLink aria-hidden />
							{t("panels.prSetup.openCompare")}
						</a>
					) : null}
					{state?.kind === "compare-body" ? (
						<a
							data-testid="open-pr-setup-compare"
							href={state.compareUrl}
							target="_blank"
							rel="noopener noreferrer"
							onClick={onCompareOpen}
							className={buttonVariants({ variant: "outline", size: "l" })}
						>
							<ExternalLink aria-hidden />
							{t("panels.prSetup.openCompare")}
						</a>
					) : null}
					{state?.kind === "compare-body" ? null : (
						<Button iconLeft={RefreshCw} data-testid="open-pr-setup-retry" onClick={onRetry}>
							{t("panels.prSetup.tryAgain")}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
