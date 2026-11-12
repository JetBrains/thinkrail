import {
	RiArrowRightSLine as ChevronRight,
	RiCheckLine,
	RiCloseLine,
	RiLoader4Line,
} from "@remixicon/react";
import type { McpServerStatus } from "@thinkrail/contracts";
import type { ToolStatus } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { turnTimeLabel } from "@/lib";
import { EMPTY_RUNTIME, useAppStore } from "@/store";
import { type McpServerCall, mcpServerCalls } from "./mcpServerCalls";
import { ToolRendererBody } from "./ToolRendererBody";
import { mcpArgsSummary } from "./tools/mcp/mcpResult";

function CallStatus({ status }: { status: ToolStatus }) {
	const t = useT();
	return (
		<>
			{status === "running" ? (
				<RiLoader4Line className="size-12 shrink-0 animate-spin text-text-muted motion-reduce:animate-none" />
			) : status === "error" ? (
				<RiCloseLine className="size-12 shrink-0 text-feedback-error" />
			) : (
				<RiCheckLine className="size-12 shrink-0 text-feedback-success" />
			)}
			<span className="sr-only">
				{status === "running"
					? t("resources.state.running")
					: status === "error"
						? t("resources.state.failed")
						: t("resources.state.done")}
			</span>
		</>
	);
}

function McpCallRow({ call }: { call: McpServerCall }) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const status: ToolStatus = call.result?.status ?? (call.dead ? "error" : "running");
	return (
		<li
			data-testid="resource-mcp-call"
			data-tool-call-id={call.toolCallId}
			data-status={status}
			data-expanded={expanded}
			className="rounded-sm border border-border-default bg-container-elevated-bg"
		>
			<button
				type="button"
				data-testid="resource-mcp-call-toggle"
				aria-expanded={expanded}
				onClick={() => setExpanded(!expanded)}
				className="flex w-full cursor-pointer select-none items-center gap-8 px-8 py-4 text-left tr-text-metadata outline-none focus-visible:ring-2 focus-visible:ring-primary"
			>
				<CallStatus status={status} />
				<span className="shrink-0 text-text-default">{call.tool}</span>
				<span className="min-w-0 flex-1 truncate text-text-muted tr-code-text-small">
					{mcpArgsSummary(call.args)}
				</span>
				<span className="shrink-0 text-text-subtle tabular-nums">{turnTimeLabel(t, call.at)}</span>
				<ChevronRight
					className={cn(
						"size-16 shrink-0 text-text-muted transition-transform",
						expanded && "rotate-90",
					)}
				/>
			</button>
			{expanded ? (
				<div className={cn("px-8 pb-4", status === "error" && "text-feedback-error")}>
					<ToolRendererBody
						toolCallId={call.toolCallId}
						toolName={call.toolName}
						args={call.args}
						result={call.result?.raw}
						status={status}
						streaming={call.streaming}
						imageLabel={call.tool}
					/>
				</div>
			) : null}
		</li>
	);
}

function serverStatus(
	statuses: readonly McpServerStatus[] | undefined,
	server: string,
): McpServerStatus | undefined {
	return statuses?.find((status) => status.name === server);
}

export function McpServerDetail({
	workspaceId,
	sessionId,
	server,
	servers,
}: {
	workspaceId: string;
	sessionId: string;
	server: string;
	servers: readonly string[];
}) {
	const { turns, toolResults } = useAppStore(
		useShallow((s) => {
			const runtime = s.sessions[sessionId] ?? EMPTY_RUNTIME;
			return { turns: runtime.turns, toolResults: runtime.toolResults };
		}),
	);
	const status = useAppStore((s) =>
		serverStatus(s.mcpByWorkspace[workspaceId]?.sessions[sessionId]?.snapshot.servers, server),
	);
	return (
		<McpServerDetailView
			status={status}
			calls={mcpServerCalls(turns, toolResults, server, servers)}
		/>
	);
}

export function McpServerDetailView({
	status,
	calls,
}: {
	status: McpServerStatus | undefined;
	calls: readonly McpServerCall[];
}) {
	const t = useT();
	const heading = "flex items-baseline gap-4 tr-text-eyebrow text-text-subtle";
	return (
		<div
			data-testid="resource-mcp-body"
			className="flex min-h-0 flex-1 flex-col gap-12 overflow-y-auto"
		>
			{status?.detail ? (
				<section data-testid="resource-mcp-status" className="flex flex-col gap-4">
					<h3 className={heading}>
						{t("resources.mcp.statusAt", { time: turnTimeLabel(t, status.updatedAt) })}
					</h3>
					<pre className="whitespace-pre-wrap break-words rounded-sm border border-border-default bg-container-header-bg px-8 py-4 tr-code-text-small text-text-default">
						{status.detail}
					</pre>
				</section>
			) : null}
			<section data-testid="resource-mcp-calls" className="flex flex-col gap-4">
				<h3 className={heading}>
					{t("resources.mcp.calls")}
					<span className="tr-text-metadata">· {calls.length}</span>
				</h3>
				{calls.length === 0 ? (
					<p className="text-text-subtle tr-text-metadata">{t("resources.mcp.callsEmpty")}</p>
				) : (
					<ul className="flex flex-col gap-4">
						{calls.map((call) => (
							<McpCallRow key={call.toolCallId} call={call} />
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
