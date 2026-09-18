import { Download } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from "react";
import { detectInstallPlatform, type InstallPlatform, installPlatforms } from "./desktopDownloads";

export function useDetectedInstallPlatform(): InstallPlatform | null | undefined {
	const [platform, setPlatform] = useState<InstallPlatform | null>();
	useEffect(() => setPlatform(detectInstallPlatform(navigator) ?? null), []);
	return platform;
}

function moveTab<T extends string>(
	event: KeyboardEvent<HTMLButtonElement>,
	options: ReadonlyArray<{ id: T }>,
	current: T,
	select: (value: T) => void,
) {
	const currentIndex = options.findIndex((option) => option.id === current);
	let nextIndex: number | undefined;
	if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % options.length;
	if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + options.length) % options.length;
	if (event.key === "Home") nextIndex = 0;
	if (event.key === "End") nextIndex = options.length - 1;
	if (nextIndex === undefined) return;
	event.preventDefault();
	const next = options[nextIndex];
	if (!next) return;
	select(next.id);
	const tabs = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll("button");
	(tabs?.[nextIndex] as HTMLButtonElement | undefined)?.focus();
}

export function CompactDownloadAction({
	href,
	ariaLabel,
	className = "",
	children,
}: {
	href: string;
	ariaLabel?: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<a
			href={href}
			aria-label={ariaLabel}
			className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-primary px-3 text-[12px] font-semibold whitespace-nowrap text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${className}`}
		>
			{children}
			<Download size={14} aria-hidden="true" />
		</a>
	);
}

export function InstallPicker() {
	const pickerId = useId();
	const detectedPlatform = useDetectedInstallPlatform();
	const [platform, setPlatform] = useState<InstallPlatform>();
	const activePlatform = platform ?? detectedPlatform ?? "macos";

	const platformTabId = (value: InstallPlatform) => `${pickerId}-platform-${value}-tab`;
	const platformPanelId = (value: InstallPlatform) => `${pickerId}-platform-${value}-panel`;

	return (
		<div className="max-w-4xl">
			<div className="overflow-hidden rounded-md border border-border bg-container-workspace-bg">
				<div className="flex min-h-9 items-stretch bg-container-header-bg">
					<div
						role="tablist"
						aria-label="Choose your operating system"
						className="flex items-stretch overflow-x-auto"
					>
						{installPlatforms.map((option) => {
							const selected = option.id === activePlatform;
							return (
								<button
									key={option.id}
									id={platformTabId(option.id)}
									type="button"
									role="tab"
									aria-controls={platformPanelId(option.id)}
									aria-selected={selected}
									tabIndex={selected ? 0 : -1}
									onClick={() => setPlatform(option.id)}
									onKeyDown={(event) =>
										moveTab(event, installPlatforms, activePlatform, setPlatform)
									}
									className={`border-r border-border px-3 text-[12px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
										selected
											? "bg-container-workspace-bg text-text-default"
											: "border-b text-text-muted hover:text-text-strong"
									}`}
								>
									{option.label}
								</button>
							);
						})}
					</div>
					<div className="min-w-0 flex-1 border-b border-border" />
				</div>

				{installPlatforms.map((option) => (
					<section
						key={option.id}
						id={platformPanelId(option.id)}
						role="tabpanel"
						aria-label={`${option.label} desktop downloads`}
						hidden={
							(detectedPlatform !== undefined || platform !== undefined) &&
							option.id !== activePlatform
						}
						data-install-platform-panel
						data-selected={option.id === activePlatform}
						className="border-t border-border"
					>
						<div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
							<p className="text-[11px] leading-4 text-text-muted">{option.desktop.detail}</p>
							<div
								className={
									option.id === "linux" ? "grid grid-cols-2 gap-2 self-start" : "flex self-start"
								}
							>
								{option.desktop.downloads.map((download) => (
									<CompactDownloadAction
										key={download.href}
										href={download.href}
										ariaLabel={`${download.label} for ${option.label}`}
										className={option.id === "linux" ? "min-w-24" : ""}
									>
										{download.label}
									</CompactDownloadAction>
								))}
							</div>
						</div>
					</section>
				))}
			</div>
		</div>
	);
}
