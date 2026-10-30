import { RiGitBranchLine as GitBranch, RiLoader4Line as Loader2 } from "@remixicon/react";
import { resultText, strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import type { ReactNode } from "react";
import { useChatActions } from "../ChatActions";
import { Collapsible, countLines } from "./Collapsible";

export interface StartedWorkspaceDetails {
	workspaceId: string;
	projectId: string;
	sessionId: string;
	name: string;
	branch: string;
	baseBranch: string;
	model: string | null;
	effort: string;
}

const REQUIRED_STRINGS = [
	"workspaceId",
	"projectId",
	"sessionId",
	"name",
	"branch",
	"baseBranch",
] as const;

export function readStartedWorkspace(result: unknown): StartedWorkspaceDetails | null {
	if (!result || typeof result !== "object" || !("details" in result)) return null;
	const details = (result as { details: unknown }).details;
	if (!details || typeof details !== "object") return null;
	const record = details as Record<string, unknown>;
	if (!REQUIRED_STRINGS.every((key) => typeof record[key] === "string")) return null;
	return {
		...(record as Omit<StartedWorkspaceDetails, "model" | "effort">),
		model: typeof record.model === "string" ? record.model : null,
		effort: typeof record.effort === "string" ? record.effort : "",
	};
}

export function startWorkspaceSummary({ args }: ToolRenderProps): string {
	return strArg(args, "prompt").split("\n", 1)[0] ?? "";
}

export function StartWorkspaceCard({
	toolCallId,
	args,
	result,
	status,
}: ToolRenderProps): ReactNode {
	const t = useT();
	const actions = useChatActions();
	const started = status === "done" ? readStartedWorkspace(result) : null;
	const prompt = strArg(args, "prompt");
	const WorkspaceName = actions?.WorkspaceName;
	const meta = started
		? [
				t("tools.startWorkspace.branchFrom", { branch: started.branch, base: started.baseBranch }),
				started.model ? `${started.model} · ${started.effort}` : null,
			].filter(Boolean)
		: [];

	return (
		<div data-testid="tool-start-workspace" className="flex flex-col gap-4">
			<div className="flex items-center gap-4 tr-text-metadata">
				<GitBranch className="size-12 shrink-0 text-text-muted" />
				{started ? (
					<span className="min-w-0 truncate text-primary" data-testid="start-workspace-name">
						{WorkspaceName ? (
							<WorkspaceName workspaceId={started.workspaceId} fallback={started.name} />
						) : (
							started.name
						)}
					</span>
				) : (
					<span className="text-text-muted">{t("tools.startWorkspace.new")}</span>
				)}
			</div>
			{prompt ? (
				<Collapsible id={`${toolCallId}:prompt`} lines={countLines(prompt)}>
					<div className="whitespace-pre-wrap break-words text-text-muted tr-text-metadata">
						{prompt}
					</div>
				</Collapsible>
			) : null}
			{status === "running" ? (
				<span className="flex items-center gap-4 text-text-muted tr-text-metadata">
					<Loader2 className="size-12 shrink-0 animate-spin motion-reduce:animate-none" />
					{t("tools.startWorkspace.starting")}
				</span>
			) : null}
			{meta.length > 0 ? (
				<span className="text-text-muted tr-text-metadata">{meta.join(" · ")}</span>
			) : null}
			{status === "error" ? (
				<pre className="overflow-auto whitespace-pre-wrap px-8 py-4 text-feedback-error tr-code-text">
					{resultText(result)}
				</pre>
			) : null}
			{started && actions?.openWorkspace ? (
				<button
					type="button"
					data-testid="start-workspace-open"
					onClick={() =>
						actions.openWorkspace?.({
							workspaceId: started.workspaceId,
							projectId: started.projectId,
							sessionId: started.sessionId,
						})
					}
					className="flex items-center gap-4 self-start text-primary tr-text-metadata hover:underline"
				>
					{t("tools.startWorkspace.open")}
				</button>
			) : null}
		</div>
	);
}
