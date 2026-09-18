import {
	directDesktopDownload,
	getInstallPlatform,
	type InstallPlatform,
} from "./desktopDownloads";
import { CompactDownloadAction, useDetectedInstallPlatform } from "./InstallPicker";
import { Reveal } from "./Reveal";
import { Subtitle } from "./Subtitle";

export function desktopCtaAction(platform: InstallPlatform | null | undefined) {
	if (!platform) {
		return {
			label: "View desktop downloads",
			href: "#quick-start",
			detail: undefined,
			showAllPlatforms: false,
		};
	}
	const option = getInstallPlatform(platform);
	const download = directDesktopDownload(platform);
	return {
		label: `Download for ${option.label}`,
		href: download?.href ?? "#quick-start",
		detail: download?.architecture,
		showAllPlatforms: download !== undefined,
	};
}

export function CallToAction() {
	const action = desktopCtaAction(useDetectedInstallPlatform());

	return (
		<section
			id="cta"
			className="relative overflow-hidden border-b border-border-muted bg-container-header-bg"
		>
			<div className="relative mx-auto max-w-[1200px] px-6 py-16 text-center sm:py-32">
				<Reveal>
					<p className="label-mono">Next step</p>
					<h2 className="font-display mx-auto mt-6 max-w-3xl text-3xl font-normal sm:text-4xl">
						Give your AI agents a system.
					</h2>
					<Subtitle className="mx-auto mt-6">
						Move from disconnected prompts to a clear, predictable, and fully visible environment
						for automated code generation.
					</Subtitle>

					<div className="mt-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
						<CompactDownloadAction
							href={action.href}
							ariaLabel={action.detail ? `${action.label}, ${action.detail}` : action.label}
						>
							{action.label}
						</CompactDownloadAction>
						{action.showAllPlatforms ? (
							<a
								href="#quick-start"
								className="rounded-sm text-[12px] font-semibold text-text-muted underline underline-offset-4 transition-colors hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							>
								All platforms
							</a>
						) : null}
					</div>
				</Reveal>
			</div>
		</section>
	);
}
