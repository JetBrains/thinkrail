import { RiArrowRightSLine, RiCheckLine, RiGitBranchLine } from "@remixicon/react";
import type {
	BranchList,
	ModelDefault,
	Project,
	ThinkingLevel,
	WireModel,
	Workspace,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import type { DeviceWireClient } from "@thinkrail/remote-client";
import { Button } from "@thinkrail/ui/button";
import { Textarea } from "@thinkrail/ui/textarea";
import { useState } from "react";
import { reasonOf } from "./async";
import { Screen } from "./layout";
import { ModelSheet } from "./ModelSheet";
import {
	baseBranches,
	type StartedWorktree,
	startWorktree,
	WorktreeStartError,
} from "./newWorktree";
import { PageSheet } from "./sheet";
import { useHostRequest } from "./useHostRequest";

const NO_PARAMS = {};

/**
 * New worktree on a phone, as the IDE's New workspace dialog: the task for the agent (optional), the base
 * branch and the model + effort, then one button that creates the worktree, starts its chat with that model
 * and sends the task. Nothing here takes focus by itself, so the keyboard comes up only when the user taps
 * the task field.
 */
export function NewWorktreeScreen({
	project,
	client,
	backLabel,
	onBack,
	onStarted,
}: {
	project: Project;
	client: DeviceWireClient | null;
	backLabel: string;
	onBack: () => void;
	onStarted: (started: StartedWorktree, prompt: string) => void;
}) {
	const t = useT();
	const branches = useHostRequest<BranchList>(client, "git.listBranches", {
		projectId: project.id,
	});
	const models = useHostRequest<WireModel[]>(client, "model.list", NO_PARAMS);
	const fallback = useHostRequest<ModelDefault>(client, "model.default", NO_PARAMS);
	const [prompt, setPrompt] = useState("");
	const [baseRef, setBaseRef] = useState<string | null>(null);
	const [picked, setPicked] = useState<{ model: WireModel; thinkingLevel: ThinkingLevel } | null>(
		null,
	);
	const [branchSheet, setBranchSheet] = useState(false);
	const [creating, setCreating] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const [created, setCreated] = useState<Workspace | null>(null);

	const defaultBranch = branches.kind === "ready" ? branches.value.defaultBranch : null;
	const base = baseRef ?? defaultBranch;
	const shownModel = picked?.model ?? (fallback.kind === "ready" ? fallback.value.model : null);
	const shownLevel: ThinkingLevel =
		picked?.thinkingLevel ?? (fallback.kind === "ready" ? fallback.value.thinkingLevel : "off");
	const hasTask = prompt.trim() !== "";

	const create = (): void => {
		if (!client || creating) return;
		setCreating(true);
		setFailure(null);
		startWorktree((method, params) => client.request(method, params), {
			projectId: project.id,
			baseRef: baseRef && baseRef !== defaultBranch ? baseRef : null,
			model: picked,
			prompt,
			created,
		}).then(
			(started) => {
				onStarted(started, prompt.trim());
			},
			(error: unknown) => {
				setCreating(false);
				if (error instanceof WorktreeStartError && error.workspace) setCreated(error.workspace);
				const reason = reasonOf(error);
				setFailure(
					error instanceof WorktreeStartError && error.step === "chat"
						? t("mobile.newWorktree.chatFailed", { reason })
						: t("mobile.newWorktree.createFailed", { reason }),
				);
			},
		);
	};

	return (
		<Screen
			title={t("mobile.tree.newWorktree")}
			back={{ label: backLabel, onBack }}
			footer={
				<footer className="flex flex-col gap-8 border-t border-border-default bg-container-workspace-bg px-16 pt-12 pb-safe-bottom">
					{failure ? (
						<p role="alert" className="m-0 text-feedback-error tr-text-metadata">
							{failure}
						</p>
					) : null}
					<Button
						data-testid="new-worktree-create"
						className="mb-12 h-touch rounded-md"
						loading={creating}
						disabled={!client || creating}
						onClick={create}
					>
						{creating
							? t("panels.newWorkspace.creating")
							: hasTask
								? t("mobile.newWorktree.createAndStart")
								: t("mobile.newWorktree.create")}
					</Button>
				</footer>
			}
		>
			<div className="flex flex-col gap-16 px-16 py-16">
				<p className="m-0 text-text-muted tr-text-metadata">
					{t("mobile.newWorktree.intro", { project: project.name })}
				</p>
				<div className="flex flex-col gap-8">
					<label htmlFor="new-worktree-prompt" className="text-text-subtle tr-text-eyebrow">
						{t("mobile.newWorktree.task")}
					</label>
					<Textarea
						id="new-worktree-prompt"
						data-testid="new-worktree-prompt"
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						placeholder={t("panels.newWorkspace.promptPlaceholder")}
						rows={5}
						disabled={creating}
						className="rounded-md px-12 py-12 tr-text-reading"
					/>
					<span className="text-text-subtle tr-text-metadata">
						{t("mobile.newWorktree.taskHint")}
					</span>
				</div>

				<ul className="m-0 list-none overflow-hidden rounded-lg border border-border-default bg-container-elevated-bg p-0">
					<li className="border-b border-border-muted">
						<button
							type="button"
							data-testid="new-worktree-base"
							disabled={branches.kind !== "ready" || creating || created !== null}
							onClick={() => setBranchSheet(true)}
							className="flex min-h-touch w-full items-center gap-12 border-0 bg-transparent px-16 py-12 text-left active:bg-control-bg-hovered disabled:opacity-60"
						>
							<RiGitBranchLine aria-hidden className="size-20 shrink-0 text-text-muted" />
							<span className="min-w-0 flex-1 text-text-default tr-text-ui">
								{t("mobile.newWorktree.base")}
							</span>
							<span className="min-w-0 truncate text-text-muted tr-text-ui">
								{branches.kind === "failed"
									? t("mobile.newWorktree.baseUnknown")
									: (base ?? t("mobile.list.loading"))}
							</span>
							<RiArrowRightSLine aria-hidden className="size-20 shrink-0 text-text-subtle" />
						</button>
					</li>
					<li className="flex min-h-touch items-center gap-12 py-4 pr-8 pl-16">
						<span className="shrink-0 text-text-default tr-text-ui">
							{t("mobile.newWorktree.model")}
						</span>
						<span className="flex min-w-0 flex-1 justify-end">
							<ModelSheet
								models={models.kind === "ready" ? models.value : []}
								current={shownModel}
								level={shownLevel}
								onSelect={({ model, level }) =>
									setPicked({
										model,
										thinkingLevel:
											level ??
											(model.thinkingLevels.includes(shownLevel)
												? shownLevel
												: (model.thinkingLevels[0] ?? "off")),
									})
								}
								onSelectLevel={(level) => {
									if (shownModel) setPicked({ model: shownModel, thinkingLevel: level });
								}}
							/>
						</span>
					</li>
				</ul>
			</div>

			<PageSheet
				open={branchSheet}
				onOpenChange={setBranchSheet}
				title={t("mobile.newWorktree.base")}
				testId="new-worktree-branches"
			>
				{branches.kind === "ready"
					? baseBranches(branches.value).map((branch) => {
							const selected = branch === base;
							return (
								<button
									key={branch}
									type="button"
									data-testid="new-worktree-branch"
									data-branch={branch}
									aria-pressed={selected}
									onClick={() => {
										setBaseRef(branch);
										setBranchSheet(false);
									}}
									className={`flex min-h-touch w-full items-center gap-12 border-0 border-b border-border-muted px-16 py-12 text-left active:bg-control-bg-hovered ${selected ? "bg-primary-subtle" : "bg-transparent"}`}
								>
									<RiGitBranchLine aria-hidden className="size-20 shrink-0 text-text-muted" />
									<span className="min-w-0 flex-1 truncate text-text-default tr-text-ui">
										{branch}
									</span>
									{branch === defaultBranch ? (
										<span className="shrink-0 text-text-subtle tr-text-metadata">
											{t("mobile.newWorktree.default")}
										</span>
									) : null}
									{selected ? (
										<RiCheckLine aria-hidden className="size-20 shrink-0 text-primary" />
									) : null}
								</button>
							);
						})
					: null}
			</PageSheet>
		</Screen>
	);
}
