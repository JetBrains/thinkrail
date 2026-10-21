import { RiGitMergeLine as GitMerge, RiLoader4Line as Loader2 } from "@remixicon/react";
import type { MergeMethod } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
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
import { Switch } from "@thinkrail/ui/switch";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";

export interface MergePrState {
	number: number;
	branch: string;
	base: string | null;
	methods: MergeMethod[];
	method: MergeMethod;
	deleteBranch: boolean;
	autoDeletes: boolean;
}

export interface MergePrSubmit {
	method: MergeMethod;
	deleteBranch: boolean;
}

const METHOD_LABEL = {
	squash: "panels.mergePr.method.squash",
	merge: "panels.mergePr.method.merge",
	rebase: "panels.mergePr.method.rebase",
} satisfies Record<MergeMethod, MessageKey>;

function MergeForm({
	state,
	busy,
	onSubmit,
}: {
	state: MergePrState;
	busy: boolean;
	onSubmit: (submit: MergePrSubmit) => void;
}) {
	const t = useT();
	const [method, setMethod] = useState(state.method);
	const [deleteBranch, setDeleteBranch] = useState(state.deleteBranch);
	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{state.base
						? t("panels.mergePr.titleInto", { number: state.number, base: state.base })
						: t("panels.mergePr.title", { number: state.number })}
				</DialogTitle>
				<DialogDescription>
					{t("panels.mergePr.description", { branch: state.branch })}
				</DialogDescription>
			</DialogHeader>
			<fieldset
				aria-label={t("panels.mergePr.methodLabel")}
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
						{t(METHOD_LABEL[option])}
					</button>
				))}
			</fieldset>
			{state.autoDeletes ? (
				<p data-testid="merge-pr-auto-delete" className="m-0 tr-text-metadata text-text-subtle">
					{t("panels.mergePr.autoDeletes", { branch: state.branch })}
				</p>
			) : (
				<div className="flex items-center justify-between gap-12">
					<span className="tr-text-ui text-text-default">
						{t("panels.mergePr.deleteBranch", { branch: state.branch })}
					</span>
					<Switch
						checked={deleteBranch}
						label={t("panels.mergePr.deleteBranch", { branch: state.branch })}
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
					{t(METHOD_LABEL[method])}
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
