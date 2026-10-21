import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFileCopyLine as Copy,
} from "@remixicon/react";
import type { NativeUpdateLogEntry } from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { formatInstallLog, logTime } from "./installCopy";

export function InstallLogToggle({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange(open: boolean): void;
}) {
	const Icon = open ? ChevronDown : ChevronRight;
	return (
		<Button
			variant="ghost"
			size="sm"
			data-testid="update-log-toggle"
			aria-expanded={open}
			onClick={() => onOpenChange(!open)}
		>
			<Icon className="size-14" />
			{open ? "Hide details" : "Show details"}
		</Button>
	);
}

export function InstallLog({
	entries,
	note,
}: {
	entries: readonly NativeUpdateLogEntry[];
	note?: string | undefined;
}) {
	return (
		<div className="flex flex-col gap-4">
			<div
				role="log"
				aria-label="Update log"
				data-testid="update-log"
				className="max-h-[12rem] overflow-auto rounded-sm border border-border-default bg-container-terminal-bg p-8 tr-code-text-small"
			>
				{entries.length === 0 ? (
					<p className="text-text-muted">No log was saved for this update.</p>
				) : (
					entries.map((entry, index) => (
						<p
							key={`${entry.at}-${index}`}
							className={cn(
								"whitespace-pre-wrap break-words",
								entry.level === "error" ? "text-feedback-error" : "text-text-default",
							)}
						>
							<span className="text-text-subtle">{logTime(entry.at)}</span>{" "}
							<span className="text-feedback-info">{entry.source}</span> {entry.text}
						</p>
					))
				)}
			</div>
			<div className="flex items-center justify-between gap-8">
				<span className="text-text-muted tr-text-metadata">{note}</span>
				<Button
					variant="ghost"
					size="sm"
					data-testid="update-log-copy"
					disabled={entries.length === 0}
					onClick={() => {
						void navigator.clipboard?.writeText(formatInstallLog(entries)).catch(() => {});
					}}
				>
					<Copy className="size-14" />
					Copy log
				</Button>
			</div>
		</div>
	);
}
