import type { ImageContent, Model, ThinkingLevel } from "@thinkrail-pi/contracts";
import { useCallback, useEffect, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { ChatHeader } from "./ChatHeader";
import { Composer, type MentionCandidate, type SubmitBehavior } from "./Composer";
import { ExtUiDialog } from "./ExtUiDialog";
import { ChatTurnView } from "./turns";

/**
 * One chat session as a center tab — the app-integration layer that wires the store + transport to the
 * presentational chat primitives (header pickers, turn list, composer, extension-UI dialog). The renderers
 * stay store-free so they're reusable; this is the only file in `chat/` that touches store/transport.
 */
export default function ChatView({ sessionId }: { sessionId: string }) {
	const turns = useAppStore((s) => s.turns);
	const toolResults = useAppStore((s) => s.toolResults);
	const isStreaming = useAppStore((s) => s.isStreaming);
	const models = useAppStore((s) => s.models);
	const currentModel = useAppStore((s) => s.currentModel);
	const thinkingLevel = useAppStore((s) => s.thinkingLevel);
	const stats = useAppStore((s) => s.stats);
	const commands = useAppStore((s) => s.commands);
	const pendingExtUi = useAppStore((s) => s.pendingExtUi);
	const extUiStatus = useAppStore((s) => s.extUiStatus);
	const extUiWidget = useAppStore((s) => s.extUiWidget);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const draft = useAppStore((s) => s.chatDrafts[sessionId] ?? "");

	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);

	// Models are global to the host — fetch once, then every chat's picker shares them.
	useEffect(() => {
		if (models.length > 0) return;
		getTransport()
			.request("model.list", {})
			.then((m) => useAppStore.getState().setModels(m))
			.catch(() => {});
	}, [models.length]);

	// The skill catalog is per-session; load it when the chat opens.
	useEffect(() => {
		getTransport()
			.request("session.getCommands", { sessionId })
			.then((c) => useAppStore.getState().setCommands(c))
			.catch(() => {});
	}, [sessionId]);

	// Refresh token/cost stats when a turn starts and ends (display only — `pi` owns the numbers).
	// biome-ignore lint/correctness/useExhaustiveDependencies: `isStreaming` is the refetch trigger, not read
	useEffect(() => {
		getTransport()
			.request("session.getStats", { sessionId })
			.then((s) => useAppStore.getState().setStats(s))
			.catch(() => {});
	}, [sessionId, isStreaming]);

	// `@`-mention completion: read the worktree directory implied by the token, filter by its basename.
	useEffect(() => {
		if (mentionQuery === null || !activeWorkspaceId) {
			setMentionCandidates([]);
			return;
		}
		const slash = mentionQuery.lastIndexOf("/");
		const dir = slash >= 0 ? mentionQuery.slice(0, slash) : "";
		const prefix = (slash >= 0 ? mentionQuery.slice(slash + 1) : mentionQuery).toLowerCase();
		let cancelled = false;
		const timer = setTimeout(() => {
			getTransport()
				.request("fs.readDir", { workspaceId: activeWorkspaceId, path: dir })
				.then((nodes) => {
					if (cancelled) return;
					setMentionCandidates(
						nodes
							.filter((n) => n.name.toLowerCase().startsWith(prefix))
							.slice(0, 12)
							.map((n) => ({ path: n.path, name: n.name, kind: n.kind })),
					);
				})
				.catch(() => {
					if (!cancelled) setMentionCandidates([]);
				});
		}, 120);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [mentionQuery, activeWorkspaceId]);

	const onMentionQuery = useCallback((q: string | null) => setMentionQuery(q), []);

	const onSelectModel = (model: Model<string>) => {
		useAppStore.getState().setCurrentModel(model);
		getTransport()
			.request("session.setModel", { sessionId, model })
			.catch(() => {});
	};

	const onSelectThinking = (level: ThinkingLevel) => {
		useAppStore.getState().setThinkingLevel(level);
		getTransport()
			.request("session.setThinkingLevel", { sessionId, level })
			.catch(() => {});
	};

	const onSubmit = (text: string, images: ImageContent[], behavior: SubmitBehavior) => {
		if (text) useAppStore.getState().appendUserMessage(text);
		const params = { sessionId, text, ...(images.length > 0 ? { images } : {}) };
		const method =
			behavior === "steer"
				? "session.steer"
				: behavior === "followUp"
					? "session.followUp"
					: "session.prompt";
		getTransport()
			.request(method, params)
			.catch(() => {});
	};

	const onAbort = () => {
		getTransport()
			.request("session.abort", { sessionId })
			.catch(() => {});
	};

	const onExtUiReply = (value: string | boolean | null) => {
		if (!pendingExtUi) return;
		const id = pendingExtUi.id;
		useAppStore.getState().clearPendingExtUi(id);
		getTransport()
			.request("session.extUiReply", { response: { id, value } })
			.catch(() => {});
	};

	const widgetEntries = Object.entries(extUiWidget);

	return (
		<div className="flex h-full min-h-0 flex-col bg-bg">
			<ChatHeader
				models={models}
				currentModel={currentModel}
				thinkingLevel={thinkingLevel}
				stats={stats}
				statusEntries={Object.entries(extUiStatus)}
				onSelectModel={onSelectModel}
				onSelectThinking={onSelectThinking}
			/>
			<Virtuoso
				data={turns}
				className="min-h-0 flex-1"
				followOutput="smooth"
				itemContent={(_index, turn) => (
					<div className="mx-auto max-w-3xl px-md py-xs">
						<ChatTurnView turn={turn} toolResults={toolResults} />
					</div>
				)}
			/>
			{widgetEntries.length > 0 ? (
				<div className="shrink-0 border-border2 border-t bg-elevated px-md py-xs text-muted text-xs">
					{widgetEntries.map(([key, lines]) => (
						<div key={key}>{lines.join(" ")}</div>
					))}
				</div>
			) : null}
			<Composer
				value={draft}
				onChange={(v) => useAppStore.getState().setChatDraft(sessionId, v)}
				isStreaming={isStreaming}
				commands={commands}
				mentionCandidates={mentionCandidates}
				onMentionQuery={onMentionQuery}
				onSubmit={onSubmit}
				onAbort={onAbort}
			/>
			{pendingExtUi ? (
				<ExtUiDialog key={pendingExtUi.id} request={pendingExtUi} onReply={onExtUiReply} />
			) : null}
		</div>
	);
}
