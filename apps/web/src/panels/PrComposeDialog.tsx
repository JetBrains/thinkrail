import {
	RiGitPullRequestLine as GitPullRequestArrow,
	RiLoader4Line as Loader2,
} from "@remixicon/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export interface PrComposeState {
	draft: boolean;
	title: string;
	body: string;
	titleEdited?: boolean;
}

function ComposeForm({
	state,
	updating,
	busy,
	onSubmit,
}: {
	state: PrComposeState;
	updating: boolean;
	busy: boolean;
	onSubmit: (title: string, body: string, titleEdited: boolean) => void;
}) {
	const [title, setTitle] = useState(state.title);
	const [body, setBody] = useState(state.body);
	const action = updating ? "Push updates" : state.draft ? "Open draft PR" : "Open PR";
	return (
		<>
			<DialogHeader>
				<DialogTitle>{action}</DialogTitle>
				<DialogDescription>
					{updating
						? "Review the refreshed description before pushing — it overwrites the open PR's."
						: "Review the title and description before the PR is created — both came from this plan."}
				</DialogDescription>
			</DialogHeader>
			<label className="flex flex-col gap-4">
				<span className="tr-text-eyebrow text-text-subtle">Title</span>
				<input
					type="text"
					data-testid="open-pr-compose-title"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					className="w-full rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active"
				/>
			</label>
			<div className="flex min-h-0 flex-1 flex-col gap-4">
				<label htmlFor="open-pr-compose-body" className="tr-text-eyebrow text-text-subtle">
					Description
				</label>
				<Textarea
					id="open-pr-compose-body"
					data-testid="open-pr-compose-body"
					value={body}
					onChange={(e) => setBody(e.target.value)}
					rows={14}
					className="min-h-160 flex-1 resize-y tr-code-text"
				/>
			</div>
			<DialogFooter>
				<Button
					data-testid="open-pr-compose-submit"
					disabled={busy || title.trim().length === 0}
					onClick={() =>
						onSubmit(title, body, Boolean(state.titleEdited) || title.trim() !== state.title.trim())
					}
				>
					{busy ? (
						<Loader2 className="size-14 animate-spin" />
					) : (
						<GitPullRequestArrow className="size-14" />
					)}
					{action}
				</Button>
			</DialogFooter>
		</>
	);
}

export function PrComposeDialog({
	state,
	updating,
	busy,
	onClose,
	onSubmit,
}: {
	state: PrComposeState | null;
	updating: boolean;
	busy: boolean;
	onClose: () => void;
	onSubmit: (title: string, body: string, titleEdited: boolean) => void;
}) {
	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent
				data-testid="open-pr-compose-dialog"
				className="max-w-[40rem] max-h-[85vh] overflow-y-auto"
			>
				{state ? (
					<ComposeForm
						key={`${state.draft}-${state.title}`}
						state={state}
						updating={updating}
						busy={busy}
						onSubmit={onSubmit}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
