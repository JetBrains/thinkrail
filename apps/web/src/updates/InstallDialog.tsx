import {
	RiLoader4Line as Active,
	RiCheckLine as Check,
	RiCheckboxBlankCircleLine as Pending,
} from "@remixicon/react";
import type { NativeUpdateState } from "@thinkrail/contracts";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { InstallLog, InstallLogToggle } from "./InstallLog";
import { INSTALL_STEPS, installProgress, installStepIndex } from "./installCopy";

export function InstallDialog({ state }: { state: NativeUpdateState }) {
	const [showLog, setShowLog] = useState(false);
	const open = state.status === "installing";
	const current = installStepIndex(state.installStep);
	const progress = installProgress(state.installStep);
	const version = state.availableVersion;
	const currentLabel = INSTALL_STEPS[current]?.label ?? INSTALL_STEPS[1].label;

	return (
		<Dialog open={open}>
			<DialogContent
				hideClose
				data-testid="update-install-dialog"
				className="max-w-[32rem]"
				onEscapeKeyDown={(event) => event.preventDefault()}
				onInteractOutside={(event) => event.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle>
						{version ? `Installing ThinkRail ${version}` : "Installing the update"}
					</DialogTitle>
					<DialogDescription>
						ThinkRail will close and reopen by itself. This usually takes less than a minute.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					<progress
						max={100}
						value={progress}
						aria-label={`${currentLabel}, step ${current + 1} of ${INSTALL_STEPS.length}`}
						className="h-4 w-full accent-primary"
					/>
					<div className="flex justify-between gap-8 text-text-muted tr-text-metadata">
						<span>{currentLabel}…</span>
						<span>
							Step {current + 1} of {INSTALL_STEPS.length}
						</span>
					</div>
				</div>
				<ol className="flex flex-col gap-4" data-testid="update-install-steps">
					{INSTALL_STEPS.map((step, index) => {
						const status = index < current ? "done" : index === current ? "active" : "pending";
						const Icon = status === "done" ? Check : status === "active" ? Active : Pending;
						return (
							<li
								key={step.key}
								data-step={step.key}
								data-status={status}
								className={cn(
									"flex items-center gap-8 tr-text-ui",
									status === "pending" ? "text-text-muted" : "text-text-default",
								)}
							>
								<Icon
									aria-hidden="true"
									className={cn(
										"size-14 shrink-0",
										status === "done" && "text-feedback-success",
										status === "active" && "animate-spin text-primary",
									)}
								/>
								{step.label}
							</li>
						);
					})}
				</ol>
				<div className="flex flex-col gap-8 border-border-default border-t pt-8">
					<div>
						<InstallLogToggle open={showLog} onOpenChange={setShowLog} />
					</div>
					{showLog ? (
						<InstallLog
							entries={state.log}
							note="The same log is saved and shown again after the restart."
						/>
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
