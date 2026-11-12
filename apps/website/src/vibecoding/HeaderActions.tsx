import { Check, ChevronDown, Copy, Download, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchStarCount } from "../githubStars";
import { installCommandFor } from "../installCommands";
import { DiscordIcon } from "./DiscordIcon";
import { GithubIcon } from "./GithubIcon";
import {
	InstallPicker,
	shareAnchor,
	useDetectedInstallPlatform,
	useInstallLinkShare,
	useIsMobileDevice,
} from "./InstallPicker";

const panelId = "install-popover";
const focusRing =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const iconLink = `inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-sm px-1.5 text-text-muted transition-colors hover:bg-container-card-bg hover:text-text-default ${focusRing}`;
const accentButton = `inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-sm bg-primary text-[13px] font-semibold whitespace-nowrap text-primary-foreground transition-opacity hover:opacity-90 ${focusRing}`;
const panelLink =
	"inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-text-default";

function useStarCount(): string | undefined {
	const [stars, setStars] = useState<string>();
	useEffect(() => {
		void fetchStarCount().then(setStars);
	}, []);
	return stars;
}

function InstallCommand() {
	const command = installCommandFor(useDetectedInstallPlatform());
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
			setTimeout(() => setCopied(false), 1400);
		} catch {}
	}

	return (
		<span className="hidden h-9 max-w-[230px] min-w-0 items-center gap-2 rounded-sm border border-border bg-container-workspace-bg pr-1 pl-2.5 font-mono text-[12px] text-text-muted min-[1080px]:inline-flex xl:max-w-[340px]">
			<span aria-hidden="true">$</span>
			<code title={command} className="min-w-0 truncate text-text-default">
				{command}
			</code>
			<button
				type="button"
				data-copy={command}
				onClick={copy}
				aria-label="Copy install command"
				className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-container-card-bg hover:text-text-default ${focusRing}`}
			>
				{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
			</button>
		</span>
	);
}

function SendLinkIcon() {
	const { copied, send } = useInstallLinkShare();

	return (
		<button
			type="button"
			data-share-install-link={shareAnchor}
			onClick={send}
			className={`${accentButton} w-9`}
		>
			{copied ? <Check size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
			<span className="sr-only" aria-live="polite">
				{copied ? "Link copied" : "Send link to my computer"}
			</span>
		</button>
	);
}

export function HeaderActions() {
	const mobile = useIsMobileDevice();
	const stars = useStarCount();

	return (
		<div className="flex min-w-0 items-center gap-2">
			<a
				href="https://github.com/JetBrains/thinkrail"
				aria-label="ThinkRail on GitHub"
				className={iconLink}
			>
				<GithubIcon className="h-6 w-6" />
				{stars && <span className="font-mono text-[12px]">{stars}</span>}
			</a>
			<a
				href="https://thinkrail.ai/discord"
				aria-label="Join the ThinkRail Discord"
				className={iconLink}
			>
				<DiscordIcon className="h-5 w-5" />
			</a>
			{mobile ? (
				<SendLinkIcon />
			) : (
				<>
					<InstallCommand />
					<button type="button" popoverTarget={panelId} className={`${accentButton} px-3`}>
						<Download size={15} aria-hidden="true" />
						<span className="sr-only sm:not-sr-only">Install</span>
						<ChevronDown size={15} aria-hidden="true" />
					</button>
				</>
			)}
			<div
				id={panelId}
				popover="auto"
				role="dialog"
				aria-labelledby={`${panelId}-title`}
				data-install-popover=""
				className="top-[72px] right-[max(8px,calc((100%_-_1200px)/2_+_24px))] bottom-auto left-auto m-0 hidden max-h-[calc(100dvh_-_88px)] w-[min(420px,calc(100%_-_16px))] overflow-auto rounded-md border border-border bg-container-header-bg p-4 text-text-default shadow-2xl open:block"
			>
				<p className="mb-3 flex items-baseline justify-between gap-3 text-[14px] font-semibold">
					<span id={`${panelId}-title`}>Install ThinkRail</span>
					<small className="text-[12px] font-normal text-text-muted">free · open source</small>
				</p>
				<InstallPicker />
				<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border-muted pt-2.5 text-[13px]">
					<a
						href="https://github.com/JetBrains/thinkrail"
						target="_blank"
						rel="noopener noreferrer"
						className={panelLink}
					>
						<GithubIcon className="h-4 w-4" />
						Star on GitHub
					</a>
					<a
						href="https://thinkrail.ai/discord"
						target="_blank"
						rel="noopener noreferrer"
						className={panelLink}
					>
						<DiscordIcon className="h-4 w-4" />
						Questions? Join Discord
					</a>
				</div>
			</div>
		</div>
	);
}
