import { RiShieldCheckLine as ShieldCheck, RiAlertLine as TriangleAlert } from "@remixicon/react";
import type { Project } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import {
	canStopTrusting,
	deriveProjectTrustNotice,
	stopTrustingText,
	trustEnablesText,
	trustedNoticeText,
	trustGrantParams,
	untrustedNoticeText,
} from "@/chat/projectTrust";
import { useProjectTrustSummary } from "@/chat/useProjectTrustSummary";
import { selectSupportsProjectTrust, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { ConfirmDialog } from "./ConfirmDialog";

export function ProjectTrustNotice({ projectId }: { projectId: string }) {
	const t = useT();
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

	const stopTrusting = canStopTrusting(project) ? (
		<>
			<Button
				variant="ghost"
				size="m"
				data-testid="project-untrust-button"
				disabled={busy}
				onClick={() => setConfirmingRevoke(true)}
				className="shrink-0"
			>
				{t("panels.projectTrust.stopTrusting")}
			</Button>
			<ConfirmDialog
				open={confirmingRevoke}
				onOpenChange={setConfirmingRevoke}
				title={t("panels.projectTrust.stopTrustingTitle")}
				description={stopTrustingText(t, project, supportsProjectTrust)}
				confirmLabel={t("panels.projectTrust.stopTrusting")}
				destructive
				confirmTestId="project-untrust-confirm"
				onConfirm={() =>
					void run(
						() => getTransport().request("project.setTrust", { id: projectId, trusted: false }),
						t("panels.projectTrust.stopTrustingFailed"),
					)
				}
			/>
		</>
	) : null;

	if (notice.kind === "trusted") {
		return (
			<div
				data-testid="project-trust-notice"
				data-state="trusted"
				className="mt-16 flex w-full max-w-[560px] items-center gap-8 rounded-sm border border-feedback-success-muted bg-container-elevated-bg px-12 py-8 text-left"
			>
				<ShieldCheck className="-mt-2 size-14 shrink-0 text-feedback-success" aria-hidden />
				<span className="min-w-0 flex-1 tr-text-ui text-text-default">
					{trustedNoticeText(t, notice)}
				</span>
				{stopTrusting}
			</div>
		);
	}

	const pending = notice.kind === "unacknowledged";
	const enables = notice.kind === "untrusted" ? trustEnablesText(t, notice) : null;
	return (
		<div
			data-testid="project-trust-notice"
			data-state={pending ? "pending" : "untrusted"}
			className="mt-16 flex w-full max-w-[560px] flex-col gap-8 rounded-sm border border-feedback-warning-muted bg-container-elevated-bg px-12 py-8 text-left"
		>
			<div className="flex items-start gap-8">
				<TriangleAlert className="mt-2 size-14 shrink-0 text-feedback-warning" aria-hidden />
				<span className="flex min-w-0 flex-1 flex-col gap-2">
					<span className="tr-text-ui text-text-default">
						{pending
							? t("panels.projectTrust.newSkills", { count: notice.names.length })
							: untrustedNoticeText(t, notice)}
					</span>
					{enables ? (
						<span data-testid="project-trust-enables" className="text-text-muted tr-text-metadata">
							{enables}
						</span>
					) : null}
				</span>
			</div>
			<div className="flex justify-end gap-8">
				{stopTrusting}
				<Button
					variant="outline"
					size="m"
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
							pending
								? t("panels.projectTrust.acknowledgeFailed")
								: t("panels.projectTrust.trustFailed"),
						)
					}
				>
					{pending ? t("panels.projectTrust.reviewAndEnable") : t("panels.projectTrust.trust")}
				</Button>
			</div>
		</div>
	);
}
