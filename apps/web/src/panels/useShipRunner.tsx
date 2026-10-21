import {
	RiFileCopyLine as Copy,
	RiRobot2Line as Robot,
	RiTerminalBoxLine as Terminal,
} from "@remixicon/react";
import type { OpenBranchReview, OpenPrResult, PrBodySource, Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { type ReactNode, useRef, useState } from "react";
import { copyText } from "../lib";
import { useAppStore } from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import type { BranchFacts } from "./branchStatusState";
import { ConfirmDialog } from "./ConfirmDialog";
import { MergePrDialog, type MergePrState, type MergePrSubmit } from "./MergePrDialog";
import {
	allowedMergeMethods,
	defaultMergeMethod,
	loadMergePrefs,
	saveMergePrefs,
} from "./mergePrefs";
import { promptWorkspaceChat } from "./openChat";
import {
	PrComposeDialog,
	type PrComposeSources,
	type PrComposeState,
	type PrSourcing,
} from "./PrComposeDialog";
import { PrSetupDialog, type PrSetupState } from "./PrSetupDialog";
import { RemoveWorkspaceDialog } from "./RemoveWorkspaceDialog";
import { fixChecksPrompt, integratePrompt, type ShipActionId, syncCommand } from "./shipActions";
import { openReviewLabel } from "./useBranchStatus";
import { settleWorkspace, unsettleWorkspace } from "./workspaceActions";

const PR_OPEN_TIMEOUT_MS = 180_000;

type PrSubmit = {
	branch: string;
	draft: boolean;
	title?: string | undefined;
	body?: string | undefined;
	titleEdited: boolean;
	sourcing?: PrSourcing | undefined;
};

type PushTarget = { branch: string; confirmBase: boolean };

type Retry =
	| { kind: "pr"; submit: PrSubmit }
	| { kind: "push"; target: PushTarget }
	| { kind: "deleteRemote"; branch: string };

export interface ShipRunnerOptions {
	workspace: Workspace | null;
	sessionId: string | null;
	title?: string;
	bodySource?: PrBodySource;
	openReview: OpenBranchReview | null;
	review?: OpenBranchReview | null;
	status: BranchFacts | null;
	analyticsSource?: "plan_page";
	noteOpenReview: (review: OpenBranchReview, url?: string) => void;
	refresh: () => void;
}

export interface ShipRunner {
	busy: boolean;
	submitting: boolean;
	pending: ShipActionId | null;
	integrateCommand: string | null;
	run: (id: ShipActionId) => void;
	openPr: (draft: boolean) => Promise<void>;
	copyIntegrateCommand: () => void;
	dialogs: ReactNode;
}

export function useShipRunner(options: ShipRunnerOptions): ShipRunner {
	const t = useT();
	const { workspace, sessionId, openReview, noteOpenReview, refresh } = options;
	const workspaceId = workspace?.id ?? "";
	const branch = workspace?.branch ?? "";
	const pushToast = useAppStore((s) => s.pushToast);
	const hostPlatform = useAppStore((s) => s.hostPlatform);
	const [pending, setPending] = useState<ShipActionId | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [compose, setCompose] = useState<(PrComposeState & { branch: string }) | null>(null);
	const [setup, setSetup] = useState<PrSetupState | null>(null);
	const [confirmPush, setConfirmPush] = useState<string | null>(null);
	const [syncOpen, setSyncOpen] = useState(false);
	const [merging, setMerging] = useState<MergePrState | null>(null);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [removing, setRemoving] = useState<Workspace | null>(null);
	const lastSubmit = useRef<PrSubmit | null>(null);
	const retry = useRef<Retry | null>(null);
	const onBase = options.status?.onBase === true;
	const ahead = options.status?.ahead ?? 0;
	const integrateCommand = syncCommand(branch, options.status);
	const busy = pending !== null || submitting;

	const copyIntegrateCommand = () => {
		if (!integrateCommand) return;
		void copyText(integrateCommand).then((ok) =>
			pushToast(
				ok
					? {
							variant: "success",
							title: t("panels.ship.copied.title"),
							message: t("panels.ship.copied.message"),
						}
					: {
							variant: "error",
							title: t("panels.ship.copyFailed.title"),
							message: t("panels.ship.copyFailed.message"),
						},
			),
		);
	};

	const preview = (params: { title?: string; source?: PrBodySource; template?: string }) =>
		getTransport().request("pr.preview", {
			workspaceId,
			...(sessionId ? { sessionId } : {}),
			...(options.title ? { title: options.title } : {}),
			...params,
		});

	const sources: PrComposeSources = {
		change: (source, template) =>
			preview({ source, ...(template ? { template } : {}) }).then(
				(next) => next.body,
				(err) => {
					pushToast({
						variant: "error",
						title: t("panels.ship.sourceFailed"),
						message: errorText(err),
					});
					return null;
				},
			),
		generate: (template) =>
			getTransport()
				.request(
					"pr.generate",
					{ workspaceId, ...(sessionId ? { sessionId } : {}), ...(template ? { template } : {}) },
					{ timeoutMs: 60_000 },
				)
				.then(
					({ body }) => {
						if (body === null) {
							pushToast({
								variant: "info",
								title: t("panels.ship.noDraft.title"),
								message: t("panels.ship.noDraft.message"),
							});
						}
						return body;
					},
					(err) => {
						pushToast({
							variant: "error",
							title: t("panels.ship.draftFailed"),
							message: errorText(err),
						});
						return null;
					},
				),
	};

	const toastDirty = (dirtyFiles: number) => {
		if (dirtyFiles === 0) return;
		pushToast({
			variant: "info",
			title: t("panels.ship.dirty.title"),
			message: t("panels.ship.dirty.message", { count: dirtyFiles }),
		});
	};

	const onPrOpened = (submit: PrSubmit, result: OpenPrResult): void => {
		setCompose(null);
		if (result.review) noteOpenReview(result.review, result.url);
		refresh();
		toastDirty(result.dirtyFiles);
		if (result.action === "compare" && result.ghProblem) {
			retry.current = { kind: "pr", submit };
			setSetup({
				kind: "gh",
				problem: result.ghProblem,
				...(result.compareUrl ? { compareUrl: result.compareUrl } : {}),
			});
			return;
		}
		lastSubmit.current = null;
		if (result.action === "compare" && result.compareUrl) {
			window.open(result.compareUrl, "_blank", "noopener,noreferrer");
		}
		const label = result.review ? openReviewLabel(result.review) : null;
		const refreshed = result.bodyRefreshed !== false;
		const toastByAction = {
			created: {
				title: t("panels.ship.pr.openedTitle"),
				message: label
					? t("panels.ship.pr.openedNamed", { review: label })
					: t("panels.ship.pr.opened"),
			},
			updated: {
				title: t("panels.ship.pr.updatedTitle"),
				message: label
					? refreshed
						? t("panels.ship.pr.updatedNamed", { review: label })
						: t("panels.ship.pr.updatedNamedRefreshFailed", { review: label })
					: refreshed
						? t("panels.ship.pr.updated")
						: t("panels.ship.pr.updatedRefreshFailed"),
			},
			pushed: {
				title: t("panels.ship.pr.pushedTitle"),
				message: t("panels.ship.pr.pushedMessage"),
			},
			compare: {
				title: t("panels.ship.pr.pushedTitle"),
				message: t("panels.ship.pr.compareMessage"),
			},
		};
		pushToast({ variant: "success", ...toastByAction[result.action] });
	};

	const onPushFailed = (title: string, err: unknown, failed: Retry): void => {
		if (wsErrorCode(err) === "PUSH_AUTH_FAILED") {
			if (failed.kind === "pr") setCompose(null);
			retry.current = failed;
			setSetup({ kind: "push-auth", detail: errorText(err) });
		} else {
			pushToast({ variant: "error", title, message: errorText(err) });
		}
	};

	const submitPr = (submit: PrSubmit): Promise<void> => {
		const { draft, title, body, titleEdited } = submit;
		lastSubmit.current = submit;
		setSubmitting(true);
		return getTransport()
			.request(
				"pr.open",
				{
					workspaceId,
					branch: submit.branch,
					...(sessionId ? { sessionId } : {}),
					...(title !== undefined ? { title } : {}),
					...(titleEdited ? { titleEdited: true } : {}),
					...(body !== undefined ? { body } : {}),
					...(draft ? { draft: true } : {}),
					...(options.analyticsSource ? { source: options.analyticsSource } : {}),
				},
				{ timeoutMs: PR_OPEN_TIMEOUT_MS },
			)
			.then(
				(result) => onPrOpened(submit, result),
				(err) => onPushFailed(t("panels.ship.pr.openFailed"), err, { kind: "pr", submit }),
			)
			.finally(() => setSubmitting(false));
	};

	const openPr = (draft: boolean): Promise<void> => {
		if (openReview) return submitPr({ branch, draft: false, titleEdited: false });
		const edited = lastSubmit.current;
		if (
			edited &&
			edited.branch === branch &&
			edited.title !== undefined &&
			edited.body !== undefined &&
			edited.draft === draft
		) {
			setCompose({
				branch,
				draft,
				title: edited.title,
				body: edited.body,
				titleEdited: edited.titleEdited,
				...(edited.sourcing ? { sourcing: edited.sourcing } : {}),
			});
			return Promise.resolve();
		}
		setPending(draft ? "openDraftPr" : "openPr");
		return preview(options.bodySource ? { source: options.bodySource } : {})
			.then(
				(draftPreview) =>
					setCompose({
						branch,
						draft,
						title: draftPreview.title,
						body: draftPreview.body,
						...(draftPreview.source
							? {
									sourcing: {
										source: draftPreview.source,
										templates: draftPreview.templates ?? [],
										planAvailable: draftPreview.planAvailable === true,
									},
								}
							: {}),
					}),
				(err) => {
					pushToast({
						variant: "error",
						title: t("panels.ship.pr.prepareFailed"),
						message: errorText(err),
					});
				},
			)
			.finally(() => setPending(null));
	};

	const push = (target: PushTarget): Promise<void> => {
		setPending("push");
		return getTransport()
			.request(
				"workspace.push",
				{
					workspaceId,
					branch: target.branch,
					...(target.confirmBase ? { confirmBase: true } : {}),
				},
				{ timeoutMs: PR_OPEN_TIMEOUT_MS },
			)
			.then(
				(result) => {
					refresh();
					pushToast({
						variant: "success",
						title:
							ahead > 0 ? t("panels.ship.push.pushedTitle") : t("panels.ship.push.publishedTitle"),
						message:
							ahead > 0
								? t("panels.ship.push.pushedMessage", { count: ahead, branch: target.branch })
								: t("panels.ship.push.publishedMessage", { branch: target.branch }),
					});
					toastDirty(result.dirtyFiles);
				},
				(err) => onPushFailed(t("panels.ship.push.failed"), err, { kind: "push", target }),
			)
			.finally(() => setPending(null));
	};

	const review = options.review ?? null;
	const base = workspace?.baseBranch.replace(/^origin\//, "") ?? "";

	const reviewAction = (
		id: "ready" | "reopen",
		failure: string,
		success: (label: string) => { title: string; message: string },
	): void => {
		if (!review) return;
		const label = openReviewLabel(review);
		const params = { workspaceId, branch, number: review.number };
		const timeout = { timeoutMs: PR_OPEN_TIMEOUT_MS };
		setPending(id);
		void (
			id === "ready"
				? getTransport().request("pr.ready", params, timeout)
				: getTransport().request("pr.reopen", params, timeout)
		)
			.then(
				() => pushToast({ variant: "success", ...success(label) }),
				(err) => pushToast({ variant: "error", title: failure, message: errorText(err) }),
			)
			.finally(() => {
				setPending(null);
				refresh();
			});
	};

	const startMerge = (): void => {
		if (!review || !workspace) return;
		const details = review.details;
		const methods = allowedMergeMethods(details?.mergeMethods);
		const remembered = loadMergePrefs(workspace.projectId);
		setMerging({
			number: review.number,
			branch,
			base: details?.base ?? null,
			methods,
			method: defaultMergeMethod(methods, remembered.method),
			deleteBranch: remembered.deleteBranch ?? true,
			autoDeletes: details?.deleteBranchOnMerge === true,
		});
	};

	const merge = (state: MergePrState, submit: MergePrSubmit): void => {
		if (!workspace) return;
		saveMergePrefs(workspace.projectId, {
			method: submit.method,
			deleteBranch: state.autoDeletes ? state.deleteBranch : submit.deleteBranch,
		});
		setPending("mergePr");
		void getTransport()
			.request(
				"pr.merge",
				{ workspaceId, branch: state.branch, number: state.number, ...submit },
				{ timeoutMs: PR_OPEN_TIMEOUT_MS },
			)
			.then(
				(result) => {
					setMerging(null);
					if (!result.merged) {
						pushToast({
							variant: "info",
							title: t("panels.ship.merge.queuedTitle", { number: state.number }),
							message: state.base
								? t("panels.ship.merge.queuedInto", { base: state.base, branch: state.branch })
								: t("panels.ship.merge.queued", { branch: state.branch }),
						});
						return;
					}
					if (submit.deleteBranch && !result.branchDeleted) {
						pushToast({
							variant: "info",
							title: t("panels.ship.merge.mergedTitle", { number: state.number }),
							message: t("panels.ship.merge.branchKept", {
								branch: state.branch,
								error: result.deleteError ?? t("panels.ship.merge.deleteFailed"),
							}),
						});
						return;
					}
					pushToast({
						variant: "success",
						title: t("panels.ship.merge.mergedTitle", { number: state.number }),
						message: state.base
							? result.branchDeleted
								? t("panels.ship.merge.mergedIntoDeleted", {
										base: state.base,
										branch: state.branch,
									})
								: t("panels.ship.merge.mergedInto", { base: state.base })
							: result.branchDeleted
								? t("panels.ship.merge.mergedDeleted", { branch: state.branch })
								: t("panels.ship.merge.merged"),
					});
				},
				(err) =>
					pushToast({
						variant: "error",
						title: t("panels.ship.merge.failed"),
						message: errorText(err),
					}),
			)
			.finally(() => {
				setPending(null);
				refresh();
			});
	};

	const deleteRemote = (target: string): Promise<void> => {
		setPending("deleteRemote");
		return getTransport()
			.request(
				"workspace.deleteRemoteBranch",
				{ workspaceId, branch: target },
				{ timeoutMs: PR_OPEN_TIMEOUT_MS },
			)
			.then(
				() => {
					pushToast({
						variant: "success",
						title: t("panels.ship.deleteRemote.doneTitle"),
						message: t("panels.ship.deleteRemote.doneMessage", { branch: target }),
					});
				},
				(err) =>
					onPushFailed(t("panels.ship.deleteRemote.failed"), err, {
						kind: "deleteRemote",
						branch: target,
					}),
			)
			.finally(() => {
				setPending(null);
				refresh();
			});
	};

	const askAgent = (text: string): void => {
		void promptWorkspaceChat(workspaceId, sessionId, text).catch((err) =>
			pushToast({ variant: "error", title: t("panels.ship.askFailed"), message: errorText(err) }),
		);
	};

	const run = (id: ShipActionId): void => {
		if (!workspace || busy) return;
		switch (id) {
			case "publish":
			case "push":
				if (onBase) setConfirmPush(branch);
				else void push({ branch, confirmBase: false });
				return;
			case "sync":
				setSyncOpen(true);
				return;
			case "openPr":
			case "createMr":
				void openPr(false);
				return;
			case "openDraftPr":
				void openPr(true);
				return;
			case "settle":
				settleWorkspace(workspace.id);
				return;
			case "keepActive":
				unsettleWorkspace(workspace.id);
				return;
			case "remove":
				setRemoving(workspace);
				return;
			case "fixChecks":
				if (review) askAgent(fixChecksPrompt(review, branch, review.details?.base ?? base));
				return;
			case "ready":
				reviewAction("ready", t("panels.ship.ready.failed"), (label) => ({
					title: t("panels.ship.ready.doneTitle"),
					message: t("panels.ship.ready.doneMessage", { review: label }),
				}));
				return;
			case "reopen":
				reviewAction("reopen", t("panels.ship.reopen.failed"), (label) => ({
					title: t("panels.ship.reopen.doneTitle"),
					message: t("panels.ship.reopen.doneMessage", { review: label }),
				}));
				return;
			case "mergePr":
				startMerge();
				return;
			case "deleteRemote":
				setConfirmDelete(branch);
				return;
			case "mergeLocal":
				return;
		}
	};

	const retrySetup = () => {
		setSetup(null);
		const failed = retry.current;
		retry.current = null;
		if (failed?.kind === "pr") void submitPr(failed.submit);
		else if (failed?.kind === "push") void push(failed.target);
		else if (failed?.kind === "deleteRemote") void deleteRemote(failed.branch);
	};
	const runSetupCommand = (command: string) => {
		setSetup(null);
		setSyncOpen(false);
		useAppStore.getState().addTerminal(workspaceId, command);
	};

	const dialogs = (
		<>
			<PrComposeDialog
				state={compose}
				busy={submitting}
				sources={sources}
				onClose={() => {
					lastSubmit.current = null;
					setCompose(null);
				}}
				onSubmit={(submit) => {
					if (compose) void submitPr({ branch: compose.branch, draft: compose.draft, ...submit });
				}}
			/>
			<PrSetupDialog
				state={setup}
				platform={hostPlatform}
				onClose={() => {
					retry.current = null;
					setSetup(null);
				}}
				onRetry={retrySetup}
				onRun={runSetupCommand}
				onCompareOpen={() => {
					setSetup(null);
					retry.current = null;
					lastSubmit.current = null;
				}}
			/>
			<ConfirmDialog
				open={confirmPush !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmPush(null);
				}}
				title={t("panels.ship.confirmPush.title", { branch: confirmPush })}
				description={
					ahead > 0
						? t("panels.ship.confirmPush.descriptionCommits", {
								count: ahead,
								branch: confirmPush,
							})
						: t("panels.ship.confirmPush.description", { branch: confirmPush })
				}
				confirmLabel={t("panels.ship.confirmPush.confirm", { branch: confirmPush })}
				confirmTestId="ship-confirm-base-push"
				onConfirm={() => {
					if (confirmPush !== null) void push({ branch: confirmPush, confirmBase: true });
					setConfirmPush(null);
				}}
			/>
			<MergePrDialog
				state={merging}
				busy={pending === "mergePr"}
				onClose={() => setMerging(null)}
				onSubmit={(submit) => {
					if (merging) merge(merging, submit);
				}}
			/>
			<ConfirmDialog
				open={confirmDelete !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmDelete(null);
				}}
				title={t("panels.ship.confirmDelete.title", { branch: confirmDelete ?? branch })}
				description={t("panels.ship.confirmDelete.description", {
					branch: confirmDelete ?? branch,
				})}
				confirmLabel={t("panels.ship.confirmDelete.confirm")}
				destructive
				confirmTestId="ship-confirm-delete-remote"
				onConfirm={() => {
					if (confirmDelete !== null) void deleteRemote(confirmDelete);
					setConfirmDelete(null);
				}}
			/>
			<Dialog open={syncOpen} onOpenChange={setSyncOpen}>
				<DialogContent data-testid="ship-sync-dialog" className="max-w-[32rem]">
					<DialogHeader>
						<DialogTitle>{t("panels.ship.sync.title")}</DialogTitle>
						<DialogDescription>{t("panels.ship.sync.description", { branch })}</DialogDescription>
					</DialogHeader>
					{integrateCommand ? (
						<code className="rounded-sm border border-border-default bg-container-content-bg px-8 py-4 tr-code-text text-text-default">
							{integrateCommand}
						</code>
					) : (
						<p className="m-0 tr-text-ui text-text-muted">
							{options.status?.pushesElsewhere
								? t("panels.ship.sync.pushesElsewhere", { branch })
								: t("panels.ship.sync.manual", { branch })}
						</p>
					)}
					<DialogFooter>
						{integrateCommand ? (
							<>
								<Button variant="ghost" data-testid="ship-sync-copy" onClick={copyIntegrateCommand}>
									<Copy className="size-14" />
									{t("panels.ship.sync.copy")}
								</Button>
								<Button
									variant="outline"
									data-testid="ship-sync-run"
									onClick={() => runSetupCommand(integrateCommand)}
								>
									<Terminal className="size-14" />
									{t("panels.ship.sync.run")}
								</Button>
							</>
						) : (
							<Button variant="ghost" onClick={() => setSyncOpen(false)}>
								{t("common.close")}
							</Button>
						)}
						<Button
							data-testid="ship-sync-agent"
							onClick={() => {
								setSyncOpen(false);
								askAgent(integratePrompt(branch, options.status));
							}}
						>
							<Robot className="size-14" />
							{t("panels.ship.sync.askAgent")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{removing ? (
				<RemoveWorkspaceDialog
					workspace={removing}
					open
					onOpenChange={(open) => {
						if (!open) setRemoving(null);
					}}
				/>
			) : null}
		</>
	);

	return {
		busy,
		submitting,
		pending,
		integrateCommand,
		run,
		openPr,
		copyIntegrateCommand,
		dialogs,
	};
}
