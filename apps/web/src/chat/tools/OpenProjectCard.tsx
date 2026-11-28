import { RiLoader4Line as Loader2, RiGitRepositoryLine as Repository } from "@remixicon/react";
import { resultText, strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import type { ReactNode } from "react";
import { useChatActions } from "../ChatActions";

export type OpenProjectOutcome = "open" | "opened" | "cloned";

export interface OpenedProjectDetails {
	projectId: string;
	name: string;
	path: string;
	outcome: OpenProjectOutcome;
	notice: boolean;
}

export interface OpenProjectStage {
	stage: "approval" | "cloning";
	url: string;
	destination: string;
	notice: boolean;
}

const OUTCOMES: Record<OpenProjectOutcome, MessageKey> = {
	open: "tools.openProject.outcome.open",
	opened: "tools.openProject.outcome.opened",
	cloned: "tools.openProject.outcome.cloned",
};

function detailsOf(result: unknown): Record<string, unknown> | null {
	if (!result || typeof result !== "object" || !("details" in result)) return null;
	const details = (result as { details: unknown }).details;
	return details && typeof details === "object" ? (details as Record<string, unknown>) : null;
}

export function readOpenedProject(result: unknown): OpenedProjectDetails | null {
	const record = detailsOf(result);
	if (!record) return null;
	const { projectId, name, path, outcome } = record;
	if (typeof projectId !== "string" || typeof name !== "string" || typeof path !== "string")
		return null;
	if (outcome !== "open" && outcome !== "opened" && outcome !== "cloned") return null;
	return { projectId, name, path, outcome, notice: record.notice === true };
}

export function readOpenProjectStage(result: unknown): OpenProjectStage | null {
	const record = detailsOf(result);
	if (!record) return null;
	const { stage, url, destination } = record;
	if (stage !== "approval" && stage !== "cloning") return null;
	if (typeof url !== "string" || typeof destination !== "string") return null;
	return { stage, url, destination, notice: record.notice === true };
}

export function openProjectSummary({ args }: ToolRenderProps): string {
	return strArg(args, "repository");
}

export function OpenProjectCard({ args, result, status }: ToolRenderProps): ReactNode {
	const t = useT();
	const actions = useChatActions();
	const opened = status === "done" ? readOpenedProject(result) : null;
	const stage = status === "running" ? readOpenProjectStage(result) : null;
	const notice = opened?.notice === true || stage?.notice === true;
	const openSettings = actions?.openWorkspacesSettings;

	return (
		<div data-testid="tool-open-project" className="flex flex-col gap-4">
			<div className="flex items-center gap-4 tr-text-metadata">
				<Repository className="size-12 shrink-0 text-text-muted" />
				{opened ? (
					<span className="min-w-0 truncate text-primary" data-testid="open-project-name">
						{opened.name}
					</span>
				) : (
					<span className="min-w-0 truncate text-text-muted">{strArg(args, "repository")}</span>
				)}
			</div>
			{stage ? (
				<span
					data-testid="open-project-stage"
					data-stage={stage.stage}
					className="flex items-center gap-4 text-text-muted tr-text-metadata"
				>
					{stage.stage === "cloning" ? (
						<Loader2 className="size-12 shrink-0 animate-spin motion-reduce:animate-none" />
					) : null}
					<span className="min-w-0 break-all">
						{t(
							stage.stage === "cloning"
								? "tools.openProject.cloning"
								: "tools.openProject.awaitingApproval",
							{ destination: stage.destination },
						)}
					</span>
				</span>
			) : null}
			{opened ? (
				<span
					className="break-all text-text-muted tr-text-metadata"
					data-testid="open-project-path"
				>
					{t(OUTCOMES[opened.outcome], { path: opened.path })}
				</span>
			) : null}
			{notice ? (
				<span
					data-testid="open-project-notice"
					className="flex flex-wrap items-center gap-4 text-text-muted tr-text-metadata"
				>
					{t("tools.openProject.defaultFolder")}
					{openSettings ? (
						<button
							type="button"
							data-testid="open-project-change-folder"
							onClick={openSettings}
							className="text-primary hover:underline"
						>
							{t("tools.openProject.changeFolder")}
						</button>
					) : null}
				</span>
			) : null}
			{status === "error" ? (
				<pre className="overflow-auto whitespace-pre-wrap px-8 py-4 text-feedback-error tr-code-text">
					{resultText(result)}
				</pre>
			) : null}
		</div>
	);
}
