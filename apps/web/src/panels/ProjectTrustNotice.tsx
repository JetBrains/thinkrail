import { RiShieldCheckLine as ShieldCheck, RiAlertLine as TriangleAlert } from "@remixicon/react";
import type { Project } from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { selectSupportsProjectTrust, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { ConfirmDialog } from "./ConfirmDialog";
import {
	deriveProjectTrustNotice,
	stopTrustingText,
	trustEnablesText,
	trustedNoticeText,
	trustGrantParams,
	untrustedNoticeText,
} from "./projectTrust";
import { useProjectTrustSummary } from "./useProjectTrustSummary";

export function ProjectTrustNotice({ projectId }: { projectId: string }) {
	const project = useAppStore((s) => s.projects.find((p) => p.id === projectId));
	const supportsProjectTrust = useAppStore(selectSupportsProjectTrust);
	const summary = useProjectTrustSummary(projectId);
	const [busy, setBusy] = useState(false);
	const [confirmingRevoke, setConfirmingRevoke] = useState(false);
	const notice = deriveProjectTrustNotice(project, summary);

	if (notice.kind === "hidden") return null;

	const run = async (request: () => Promise<Project>, failure: string) => {
		if (busy) return;
		setBusy(true);
		try {
			useAppStore.getState().applyProjectUpdated(await request());
		} catch (err) {
			toast.error(errorText(err), failure);
		} finally {
			setBusy(false);
		}
	};

	if (notice.kind === "trusted") {
		return (
			<div
				data-testid="project-trust-notice"
				data-state="trusted"
				className="mt-16 flex items-center gap-4 text-text-muted tr-text-metadata"
			>
				<ShieldCheck className="size-14 shrink-0 text-feedback-warning" />
				{trustedNoticeText(notice)}
				<Button
					variant="ghost"
					size="sm"
					data-testid="project-untrust-button"
					disabled={busy}
					onClick={() => setConfirmingRevoke(true)}
				>
					Stop trusting
				</Button>
				<ConfirmDialog
					open={confirmingRevoke}
					onOpenChange={setConfirmingRevoke}
					title="Stop trusting this project?"
					description={stopTrustingText(project, supportsProjectTrust)}
					confirmLabel="Stop trusting"
					destructive
					confirmTestId="project-untrust-confirm"
					onConfirm={() =>
						void run(
							() => getTransport().request("project.setTrust", { id: projectId, trusted: false }),
							"Couldn't stop trusting project",
						)
					}
				/>
			</div>
		);
	}

	const pending = notice.kind === "unacknowledged";
	const enables = notice.kind === "untrusted" ? trustEnablesText(notice) : null;
	return (
		<div
			data-testid="project-trust-notice"
			data-state={pending ? "pending" : "untrusted"}
			className="mt-16 flex w-full max-w-[560px] items-center gap-8 rounded-[var(--radius-sm)] border border-border-default border-l-[3px] border-l-feedback-warning bg-feedback-warning-subtle px-12 py-8 text-left"
		>
			<TriangleAlert className="size-16 shrink-0 text-feedback-warning" />
			<span className="flex min-w-0 flex-1 flex-col gap-2">
				<span className="tr-text-ui text-text-default">
					{pending
						? `${notice.names.length} new skill${notice.names.length === 1 ? "" : "s"} appeared since you trusted this project.`
						: untrustedNoticeText(notice)}
				</span>
				{enables ? (
					<span data-testid="project-trust-enables" className="text-text-muted tr-text-metadata">
						{enables}
					</span>
				) : null}
			</span>
			<Button
				size="sm"
				data-testid={pending ? "project-ack-button" : "project-trust-button"}
				disabled={busy}
				onClick={() =>
					void run(
						pending
							? () =>
									getTransport().request("project.acknowledgeSkills", {
										id: projectId,
										names: notice.names,
									})
							: () =>
									getTransport().request("project.setTrust", trustGrantParams(projectId, notice)),
						pending ? "Couldn't confirm skills" : "Couldn't trust project",
					)
				}
			>
				{pending ? "Review & enable" : "Trust project"}
			</Button>
		</div>
	);
}
