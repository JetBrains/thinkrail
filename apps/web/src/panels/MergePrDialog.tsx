import { RiGitMergeLine as GitMerge, RiLoader4Line as Loader2 } from "@remixicon/react";
import type { MergeMethod } from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { Switch } from "@thinkrail/ui/switch";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";

export interface MergePrState {
	number: number;
	branch: string;
	base: string;
	methods: MergeMethod[];
	method: MergeMethod;
	deleteBranch: boolean;
	autoDeletes: boolean;
}

export interface MergePrSubmit {
	method: MergeMethod;
	deleteBranch: boolean;
}

const METHOD_LABEL: Record<MergeMethod, string> = {
	squash: "Squash and merge",
	merge: "Create a merge commit",
	rebase: "Rebase and merge",
};

function MergeForm({
	state,
	busy,
	onSubmit,
}: {
	state: MergePrState;
	busy: boolean;
	onSubmit: (submit: MergePrSubmit) => void;
}) {
	const [method, setMethod] = useState(state.method);
	const [deleteBranch, setDeleteBranch] = useState(state.deleteBranch);
	return (
		<>
			<DialogHeader>
				<DialogTitle>
					Merge PR #{state.number} into {state.base}?
				</DialogTitle>
				<DialogDescription>
					GitHub merges the pull request. This workspace keeps its local {state.branch} branch.
				</DialogDescription>
			</DialogHeader>
			<fieldset
				aria-label="Merge method"
				data-testid="merge-pr-method"
				className="m-0 flex min-w-0 flex-col gap-2 rounded-sm border border-control-border-default bg-control-bg p-2"
			>
				{state.methods.map((option) => (
					<button
						key={option}
						type="button"
						aria-pressed={method === option}
						data-method={option}
						disabled={busy}
						onClick={() => setMethod(option)}
						className={cn(
							"h-28 rounded-sm px-8 text-left tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text",
							method === option
								? "bg-control-bg-selected text-text-default"
								: "text-text-muted hover:text-text-default",
						)}
					>
						{METHOD_LABEL[option]}
					</button>
				))}
			</fieldset>
			{state.autoDeletes ? (
				<p data-testid="merge-pr-auto-delete" className="m-0 tr-text-metadata text-text-subtle">
					GitHub deletes {state.branch} after the merge — a repository setting.
				</p>
			) : (
				<div className="flex items-center justify-between gap-12">
					<span className="tr-text-ui text-text-default">Delete {state.branch} on GitHub</span>
					<Switch
						checked={deleteBranch}
						label={`Delete ${state.branch} on GitHub`}
						testId="merge-pr-delete-branch"
						disabled={busy}
						onCheckedChange={setDeleteBranch}
					/>
				</div>
			)}
			<DialogFooter>
				<Button
					data-testid="merge-pr-submit"
					disabled={busy}
					onClick={() => onSubmit({ method, deleteBranch: !state.autoDeletes && deleteBranch })}
				>
					{busy ? <Loader2 className="size-14 animate-spin" /> : <GitMerge className="size-14" />}
					{METHOD_LABEL[method]}
				</Button>
			</DialogFooter>
		</>
	);
}

export function MergePrDialog({
	state,
	busy,
	onClose,
	onSubmit,
}: {
	state: MergePrState | null;
	busy: boolean;
	onClose: () => void;
	onSubmit: (submit: MergePrSubmit) => void;
}) {
	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent data-testid="merge-pr-dialog" className="max-w-[28rem]">
				{state ? (
					<MergeForm key={state.number} state={state} busy={busy} onSubmit={onSubmit} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}
