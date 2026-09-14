import { Check, Copy, Download } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
	detectInstallPlatform,
	type InstallPlatform,
	installCommand,
	installPlatforms,
	type WindowsShell,
	windowsShells,
} from "./installCommands";

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

export function InstallPicker({ context }: { context: string }) {
	const pickerId = useId();
	const detectedPlatform = useDetectedInstallPlatform();
	const [platform, setPlatform] = useState<InstallPlatform>();
	const [shell, setShell] = useState<WindowsShell>();
	const [copiedCommand, setCopiedCommand] = useState<string>();
	const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const activePlatform = platform ?? detectedPlatform ?? "macos";
	const activeShell = shell ?? "powershell";

	useEffect(() => {
		setShell("powershell");
		return () => {
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
		};
	}, []);

	const copy = async (command: string) => {
		try {
			await navigator.clipboard.writeText(command);
			setCopiedCommand(command);
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
			copiedTimer.current = setTimeout(() => setCopiedCommand(undefined), 1400);
		} catch {
			setCopiedCommand(undefined);
		}
	};

	const platformTabId = (value: InstallPlatform) => `${pickerId}-platform-${value}-tab`;
	const platformPanelId = (value: InstallPlatform) => `${pickerId}-platform-${value}-panel`;
	const shellTabId = (value: WindowsShell) => `${pickerId}-shell-${value}-tab`;
	const shellPanelId = (value: WindowsShell) => `${pickerId}-shell-${value}-panel`;

	const shellTabs = () => (
		<div
			role="tablist"
			aria-label="Choose your Windows shell"
			className="mt-1 flex flex-wrap items-stretch gap-1 rounded-sm"
		>
			{windowsShells.map((option) => {
				const selected = option.id === activeShell;
				return (
					<button
						key={option.id}
						id={shellTabId(option.id)}
						type="button"
						role="tab"
						aria-controls={shellPanelId(option.id)}
						aria-label={option.accessibleLabel}
						aria-selected={selected}
						tabIndex={selected ? 0 : -1}
						onClick={() => setShell(option.id)}
						onKeyDown={(event) => moveTab(event, windowsShells, activeShell, setShell)}
						className={`min-h-8 rounded-sm px-2 py-1 text-[12px] leading-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
							selected
								? "bg-control-bg-hovered text-text-default"
								: "text-text-muted hover:bg-control-bg hover:text-text-strong"
						}`}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);

	const commandLine = (command: string) => {
		const copied = copiedCommand === command;
		return (
			<div className="group flex min-h-10 items-stretch overflow-hidden rounded-sm border border-border bg-container-terminal-bg">
				<code className="font-mono flex min-w-0 flex-1 items-center px-3 py-2 text-[12px] leading-relaxed break-all text-primary">
					{command}
				</code>
				<button
					type="button"
					onClick={() => copy(command)}
					aria-label={copied ? "Install command copied" : "Copy install command"}
					className="flex w-10 flex-none items-center justify-center border-l border-border text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
				>
					{copied ? (
						<Check size={16} className="text-primary" aria-hidden="true" />
					) : (
						<Copy size={16} aria-hidden="true" />
					)}
				</button>
			</div>
		);
	};

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
						aria-label={`${context}: ${option.label} install options`}
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

						<details className="border-t border-border">
							<summary className="min-h-9 cursor-pointer px-3 py-2 text-[12px] font-semibold text-text-default marker:text-text-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
								Install via CLI
							</summary>
							<div className="px-3 pb-3">
								{option.id === "windows" ? shellTabs() : null}

								<div className="mt-2">
									{option.id === "windows"
										? windowsShells.map((shellOption) => (
												<div
													key={shellOption.id}
													id={shellPanelId(shellOption.id)}
													role="tabpanel"
													aria-label={`${context}: ${shellOption.accessibleLabel} CLI command`}
													hidden={shell !== undefined && shellOption.id !== shell}
													data-install-shell-panel
													data-selected={shellOption.id === activeShell}
													className="mt-2 first:mt-0"
												>
													<p className="mb-1 text-[11px] text-text-muted">
														{shellOption.accessibleLabel}
													</p>
													{commandLine(installCommand("windows", shellOption.id))}
												</div>
											))
										: commandLine(installCommand(option.id, activeShell))}
								</div>
							</div>
						</details>
					</section>
				))}
			</div>
		</div>
	);
}
