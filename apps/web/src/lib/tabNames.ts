import type { GitDiffScope } from "@thinkrail/contracts";
import { localeOf, type Translator } from "@thinkrail/locales/react";
import { fileName } from "./utils";

const DEFAULT_TERMINAL_TITLE = /^Terminal (\d+)$/;

export function chatName(t: Translator, name: string | null | undefined): string {
	return name?.trim() || t("store.chatTab.defaultName");
}

export function defaultTerminalTitle(index: number): string {
	return `Terminal ${index}`;
}

export function defaultTerminalIndex(title: string): number | null {
	const match = DEFAULT_TERMINAL_TITLE.exec(title);
	return match ? Number(match[1]) : null;
}

export function terminalName(t: Translator, title: string): string {
	const index = defaultTerminalIndex(title);
	return index === null ? title : t("store.terminal.defaultTitle", { index });
}

export function turnTimeLabel(t: Translator, startedAt: number): string {
	return new Date(startedAt).toLocaleTimeString(localeOf(t), {
		hour: "2-digit",
		minute: "2-digit",
	});
}

function scopeSuffix(t: Translator, scope: GitDiffScope): string {
	switch (scope.kind) {
		case "branch":
			return "";
		case "uncommitted":
			return t("changes.scope.uncommittedSuffix");
		case "pinned":
			return scope.baseRef.slice(0, 7);
		case "commit":
			return scope.sha.slice(0, 7);
		case "turn":
			return t("changes.scope.turnSuffix", { time: turnTimeLabel(t, scope.startedAt) });
	}
}

export function changesTabName(t: Translator, scope: GitDiffScope): string {
	const suffix = scopeSuffix(t, scope);
	return suffix ? t("changes.tab.nameScoped", { suffix }) : t("changes.tab.name");
}

export function diffTabName(t: Translator, scope: GitDiffScope, path: string): string {
	const base = fileName(path);
	const suffix = scopeSuffix(t, scope);
	return suffix ? `${base} · ${suffix}` : base;
}

export function planDocumentName(t: Translator, chat: string): string {
	return t("chat.todo.planDocName", { title: chatName(t, chat) });
}
