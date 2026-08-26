import { Check, Copy } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
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

export function InstallPicker() {
	const [platform, setPlatform] = useState<InstallPlatform>("linux");
	const [shell, setShell] = useState<WindowsShell>("powershell");
	const [copied, setCopied] = useState(false);
	const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => {
		const detected = detectInstallPlatform(navigator);
		if (detected) setPlatform(detected);
		return () => {
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
		};
	}, []);

	const command = installCommand(platform, shell);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
			copiedTimer.current = setTimeout(() => setCopied(false), 1400);
		} catch {
			setCopied(false);
		}
	};

	const shellTabs = (className: string) => (
		<div role="tablist" aria-label="Choose your Windows shell" className={className}>
			{windowsShells.map((option) => {
				const selected = option.id === shell;
				return (
					<button
						key={option.id}
						type="button"
						role="tab"
						aria-label={option.accessibleLabel}
						aria-selected={selected}
						tabIndex={selected ? 0 : -1}
						onClick={() => setShell(option.id)}
						onKeyDown={(event) => moveTab(event, windowsShells, shell, setShell)}
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

	return (
		<div className="max-w-4xl">
			<div className="overflow-hidden rounded-md border border-border">
				<div className="flex h-9 items-stretch bg-container-header-bg">
					<div
						role="tablist"
						aria-label="Choose your operating system"
						className="flex items-stretch"
					>
						{installPlatforms.map((option) => {
							const selected = option.id === platform;
							return (
								<button
									key={option.id}
									type="button"
									role="tab"
									aria-selected={selected}
									tabIndex={selected ? 0 : -1}
									onClick={() => setPlatform(option.id)}
									onKeyDown={(event) => moveTab(event, installPlatforms, platform, setPlatform)}
									className={`border-r border-border px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
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
					<div className="flex min-w-0 flex-1 items-center border-b border-border px-2">
						{platform === "windows" && shellTabs("hidden items-stretch gap-1 rounded-sm sm:flex")}
					</div>
				</div>

				{platform === "windows" &&
					shellTabs(
						"flex items-stretch gap-1 border-b border-border bg-container-header-bg px-2 py-1.5 sm:hidden",
					)}

				<div className="group flex h-[45px] items-stretch bg-container-workspace-bg">
					<code className="font-mono flex min-w-0 flex-1 items-center overflow-x-auto px-3 text-xs whitespace-nowrap text-primary [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
						{command}
					</code>
					<span
						aria-hidden="true"
						className="block w-px flex-none bg-border sm:hidden sm:group-hover:block sm:group-focus-within:block"
					/>
					<button
						type="button"
						onClick={copy}
						aria-label={copied ? "Install command copied" : "Copy install command"}
						className="flex w-[45px] flex-none items-center justify-center text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
					>
						{copied ? <Check size={16} className="text-primary" /> : <Copy size={16} />}
					</button>
				</div>
			</div>
		</div>
	);
}
