import {
	RiGitBranchLine as GitBranch,
	RiHome2Line as House,
	type RemixiconComponentType as LucideIcon,
	RiSkipForwardLine as SkipForward,
} from "@remixicon/react";
import type { AskUserQuestionResult } from "@thinkrail/contracts";
import { useState } from "react";
import { cn } from "@/lib";
import { useAskState } from "../askState";
import { useChatActions } from "../ChatActions";
import type { ToolRenderProps } from "../toolRegistry";

const SEPARATE_TASK = "Start a separate task";
const CONTINUE_DEFAULT = "Continue in the Default workspace";
const QUESTION = "How do you want to continue?";

function choiceResult(answer: string): AskUserQuestionResult {
	return {
		answers: [{ questionIndex: 0, question: QUESTION, kind: "option", answer }],
		cancelled: false,
	};
}

export function NextStepsCard({ toolCallId, status, streaming }: ToolRenderProps) {
	const actions = useChatActions();
	const ask = useAskState(toolCallId);
	const [submitted, setSubmitted] = useState(false);

	if (ask?.answer) {
		const chosen = ask.answer.answers[0]?.answer ?? null;
		return <ResolvedRow chosen={chosen} />;
	}
	if (ask?.superseded || status === "error") {
		return (
			<div
				data-testid="next-steps"
				data-tone="superseded"
				className="flex items-center gap-4 text-text-muted tr-text-metadata"
			>
				<SkipForward className="size-14 shrink-0" /> Next-step choice dismissed.
			</div>
		);
	}
	if (streaming) return null;

	const choose = (answer: string, thenSeparate: boolean) => {
		if (!actions || submitted) return;
		setSubmitted(true);
		actions
			.answerQuestion(toolCallId, choiceResult(answer))
			.then(() => {
				if (thenSeparate) actions.startSeparateTask();
			})
			.catch(() => setSubmitted(false));
	};

	return (
		<div
			data-testid="next-steps"
			data-tone="active"
			className="flex flex-col gap-8 motion-safe:animate-reveal sm:flex-row"
		>
			<NextStepCard
				testid="next-step-separate"
				icon={GitBranch}
				title={SEPARATE_TASK}
				description="Create an isolated workspace for one feature or task."
				recommended
				disabled={!actions || submitted}
				onClick={() => choose(SEPARATE_TASK, true)}
			/>
			<NextStepCard
				testid="next-step-default"
				icon={House}
				title={CONTINUE_DEFAULT}
				description="Keep developing the main version of your project here."
				disabled={!actions || submitted}
				onClick={() => choose(CONTINUE_DEFAULT, false)}
			/>
		</div>
	);
}

function ResolvedRow({ chosen }: { chosen: string | null }) {
	return (
		<div
			data-testid="next-steps"
			data-tone="answered"
			className="flex items-center gap-4 text-text-muted tr-text-metadata"
		>
			<span className="tr-text-emphasis text-text-default">{chosen ?? "Choice made"}</span>
		</div>
	);
}

function NextStepCard({
	testid,
	icon: Icon,
	title,
	description,
	recommended,
	disabled,
	onClick,
}: {
	testid: string;
	icon: LucideIcon;
	title: string;
	description: string;
	recommended?: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-testid={testid}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"flex min-w-0 flex-1 flex-col items-start gap-4 rounded-[var(--radius-sm)] border bg-clip-padding p-12 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60",
				recommended
					? "border-primary-muted bg-primary-subtle hover:bg-primary-soft"
					: "border-border-default bg-container-workspace-bg hover:border-primary-muted hover:bg-container-elevated-bg",
			)}
		>
			<span
				className={cn(
					"flex size-28 items-center justify-center rounded-[var(--radius-sm)]",
					recommended
						? "bg-primary text-text-on-primary"
						: "bg-control-bg-selected text-text-muted",
				)}
			>
				<Icon className="size-14" />
			</span>
			<span className="tr-title-card text-text-default">{title}</span>
			<span className="text-text-muted tr-text-metadata leading-snug">{description}</span>
		</button>
	);
}
