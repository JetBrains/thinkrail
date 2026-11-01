import { RiArrowLeftSLine, RiSendPlane2Line } from "@remixicon/react";
import type { SessionEventPayload, TranscriptMessage } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import type { RemoteSessionsController } from "@thinkrail/remote-client";
import { Button } from "@thinkrail/ui/button";
import { Textarea } from "@thinkrail/ui/textarea";
import { useEffect, useRef, useState } from "react";
import { type TranscriptLine, transcriptLine } from "./transcript";

export interface OpenSession {
	hostKey: string;
	sessionId: string;
	workspaceId: string;
	title: string;
}

const REFRESH_COALESCE_MS = 400;

export function SessionScreen({
	session,
	controller,
	onBack,
}: {
	session: OpenSession;
	controller: RemoteSessionsController;
	onBack: () => void;
}) {
	const t = useT();
	const { hostKey, sessionId, workspaceId } = session;
	const client = controller.clientFor(hostKey);
	const [lines, setLines] = useState<TranscriptLine[] | null>(null);
	const [text, setText] = useState("");
	const [sendError, setSendError] = useState<string | null>(null);
	const bottom = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!client) return;
		let cancelled = false;
		let pending: ReturnType<typeof setTimeout> | undefined;
		const refresh = (): void => {
			client
				.request<{ messages: TranscriptMessage[] }>("session.getMessages", {
					sessionId,
					workspaceId,
				})
				.then((result) => {
					if (!cancelled) setLines(result.messages.flatMap((m) => transcriptLine(m) ?? []));
				})
				.catch(() => {
					if (!cancelled) setLines((current) => current ?? []);
				});
		};
		refresh();
		const unsubscribe = client.subscribe(WS_CHANNELS.piEvent, (data) => {
			if ((data as SessionEventPayload).sessionId !== sessionId || pending) return;
			pending = setTimeout(() => {
				pending = undefined;
				refresh();
			}, REFRESH_COALESCE_MS);
		});
		return () => {
			cancelled = true;
			if (pending) clearTimeout(pending);
			unsubscribe();
		};
	}, [client, sessionId, workspaceId]);

	useEffect(() => {
		if (lines?.length) bottom.current?.scrollIntoView({ block: "end" });
	}, [lines]);

	const send = async (): Promise<void> => {
		const value = text.trim();
		if (!value || !client) return;
		setText("");
		setSendError(null);
		try {
			await client.request("session.followUp", { sessionId, text: value });
		} catch (error) {
			setText(value);
			setSendError(error instanceof Error ? error.message : String(error));
		}
	};

	return (
		<main className="flex h-full flex-col pt-safe-top">
			<header className="flex items-center gap-4 border-b border-border-default bg-container-header-bg px-8 py-4">
				<Button
					variant="ghost"
					className="h-touch shrink-0 rounded-md px-8"
					iconLeft={RiArrowLeftSLine}
					onClick={onBack}
				>
					{t("mobile.session.back")}
				</Button>
				<h1 className="m-0 min-w-0 flex-1 truncate pr-8 text-text-default tr-title-card">
					{session.title || t("mobile.sessions.untitled")}
				</h1>
			</header>

			<div className="flex flex-1 flex-col gap-16 overflow-y-auto px-16 py-16">
				{lines === null ? (
					<p className="m-0 py-40 text-center text-text-muted tr-text-ui">
						{t("mobile.session.loading")}
					</p>
				) : lines.length === 0 ? (
					<p className="m-0 py-40 text-center text-text-muted tr-text-ui">
						{t("mobile.session.empty")}
					</p>
				) : (
					lines.map((line, index) => <Message key={`${index}:${line.role}`} line={line} />)
				)}
				<div ref={bottom} />
			</div>

			<footer className="border-t border-border-default bg-container-header-bg px-12 pt-8 pb-[max(var(--spacing-safe-bottom),8px)]">
				{sendError ? (
					<p role="alert" className="mt-0 mb-8 text-feedback-error tr-text-metadata">
						{t("mobile.session.sendFailed", { reason: sendError })}
					</p>
				) : null}
				<form
					className="flex items-end gap-8"
					onSubmit={(event) => {
						event.preventDefault();
						void send();
					}}
				>
					<Textarea
						value={text}
						onChange={(event) => setText(event.target.value)}
						placeholder={t("mobile.session.composerPlaceholder")}
						aria-label={t("mobile.session.composerPlaceholder")}
						rows={1}
						className="max-h-[120px] min-h-touch rounded-md py-12 [field-sizing:content]"
					/>
					<Button
						type="submit"
						className="h-touch shrink-0 rounded-md px-12"
						iconLeft={RiSendPlane2Line}
						disabled={!text.trim() || !client}
					>
						{t("mobile.session.send")}
					</Button>
				</form>
			</footer>
		</main>
	);
}

function Message({ line }: { line: TranscriptLine }) {
	if (line.role === "user") {
		return (
			<div className="flex justify-end">
				<p className="m-0 max-w-[85%] whitespace-pre-wrap break-words rounded-lg border border-bubble-user-border bg-bubble-user-bg px-12 py-8 text-text-default tr-text-reading">
					{line.text}
				</p>
			</div>
		);
	}
	return (
		<p
			className={
				line.role === "assistant"
					? "m-0 whitespace-pre-wrap break-words text-text-default tr-text-reading"
					: "m-0 whitespace-pre-wrap break-words border-l-2 border-border-default pl-8 text-text-muted tr-text-metadata"
			}
		>
			{line.text}
		</p>
	);
}
