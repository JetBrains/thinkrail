import { Check, Copy, Download } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import {
	detectInstallPlatform,
	type InstallPlatform,
	installCommand,
	installPlatforms,
	type WindowsShell,
	windowsShells,
} from "./installCommands";

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

export function InstallPicker({ context }: { context: string }) {
	const pickerId = useId();
	const [platform, setPlatform] = useState<InstallPlatform>();
	const [shell, setShell] = useState<WindowsShell>();
	const [copiedCommand, setCopiedCommand] = useState<string>();
	const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const activePlatform = platform ?? "macos";
	const activeShell = shell ?? "powershell";

	useEffect(() => {
		setPlatform(detectInstallPlatform(navigator) ?? "macos");
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
			className="mt-3 flex flex-wrap items-stretch gap-1 rounded-sm"
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
						className={`rounded-sm px-2 py-1 text-xs leading-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
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
				<code className="font-mono flex min-w-0 flex-1 items-center px-3 py-2 text-xs leading-relaxed break-all text-primary">
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
									className={`border-r border-border px-3 text-xs whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
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
						hidden={platform !== undefined && option.id !== platform}
						data-install-platform-panel
						data-selected={option.id === activePlatform}
						className="border-t border-border p-4"
					>
						<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
							<div className="flex min-w-0 items-center gap-3">
								<span
									aria-hidden="true"
									className="font-mono grid size-10 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
								>
									TR
								</span>
								<div className="min-w-0">
									<p className="text-sm font-semibold text-text-default">{option.desktop.title}</p>
									<p className="mt-1 text-[11px] leading-relaxed text-text-muted">
										{option.desktop.detail}
									</p>
								</div>
							</div>

							<div className="flex shrink-0 flex-col gap-2">
								{option.desktop.downloads.map((download) => (
									<a
										key={download.href}
										href={download.href}
										aria-label={`${download.label} for ${option.label} (${download.format})`}
										className="inline-flex min-h-10 items-center justify-center gap-2 rounded-sm bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
									>
										{download.label} {download.format}
										<Download size={16} aria-hidden="true" />
									</a>
								))}
							</div>
						</div>

						<div className="mt-4 border-t border-border pt-4">
							<div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
								<p className="text-xs font-semibold text-text-default">Prefer the command line?</p>
								<p className="text-[11px] text-text-muted">Installs the CLI-only host</p>
							</div>

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
					</section>
				))}
			</div>
		</div>
	);
}
