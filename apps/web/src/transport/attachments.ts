import {
	CHAT_ATTACHMENT_UPLOAD_HEADER,
	CHAT_ATTACHMENT_WORKSPACE_PARAM,
	CHAT_ATTACHMENTS_PROTOCOL_VERSION,
	CHAT_ATTACHMENTS_ROUTE,
	type ChatAttachmentErrorCode,
	type ChatAttachmentResult,
	isChatAttachmentResult,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { t as translate } from "@thinkrail/locales/react";
import type { PromptFile } from "../store";
import { errorText } from "./errorText";
import { hostUrl } from "./fonts";
import { getTransport } from "./wireTransport";

export function supportsChatAttachments(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= CHAT_ATTACHMENTS_PROTOCOL_VERSION;
}

type UploadFailure =
	| { kind: "refused"; code: ChatAttachmentErrorCode }
	| { kind: "status"; status: number }
	| { kind: "unreachable" }
	| { kind: "request"; error: unknown };

export class AttachmentUploadError extends Error {
	readonly fileName: string;
	readonly failure: UploadFailure;

	constructor(fileName: string, failure: UploadFailure) {
		super(`attachment upload failed: ${failure.kind}`);
		this.name = "AttachmentUploadError";
		this.fileName = fileName;
		this.failure = failure;
	}
}

type CopiedReport = ((id: string, path: string) => void) | undefined;

async function uploadBlob(
	workspaceId: string | null,
	{ id, name }: Pick<PromptFile, "id" | "name">,
	blob: Blob,
	signal: AbortSignal | undefined,
	onCopied: CopiedReport,
): Promise<ChatAttachmentResult> {
	const query =
		workspaceId === null
			? ""
			: `?${CHAT_ATTACHMENT_WORKSPACE_PARAM}=${encodeURIComponent(workspaceId)}`;
	let response: Response;
	try {
		response = await fetch(
			hostUrl(`${CHAT_ATTACHMENTS_ROUTE}${encodeURIComponent(name)}${query}`),
			{
				method: "PUT",
				headers: { [CHAT_ATTACHMENT_UPLOAD_HEADER.name]: CHAT_ATTACHMENT_UPLOAD_HEADER.value },
				body: blob,
				...(signal ? { signal } : {}),
			},
		);
	} catch {
		signal?.throwIfAborted();
		throw new AttachmentUploadError(name, { kind: "unreachable" });
	}
	const result: unknown = await response.json().catch(() => null);
	const answered = isChatAttachmentResult(result);
	if (answered && result.ok) onCopied?.(id, result.path);
	signal?.throwIfAborted();
	if (answered) return result;
	throw new AttachmentUploadError(name, { kind: "status", status: response.status });
}

async function requestCopy(
	workspaceId: string | null,
	name: string,
	path: string,
): Promise<ChatAttachmentResult> {
	try {
		return await getTransport().request("attachments.copyLocal", {
			path,
			...(workspaceId === null ? {} : { workspaceId }),
		});
	} catch (error) {
		throw new AttachmentUploadError(name, { kind: "request", error });
	}
}

const localCopies = new Map<string, Promise<ChatAttachmentResult>>();

function copyLocal(
	workspaceId: string | null,
	{ id, name }: Pick<PromptFile, "id" | "name">,
	path: string,
	onCopied: CopiedReport,
): Promise<ChatAttachmentResult> {
	const key = `${workspaceId ?? ""}\n${id}`;
	const running = localCopies.get(key);
	if (running) return running;
	const copy = requestCopy(workspaceId, name, path).then((result) => {
		if (result.ok) onCopied?.(id, result.path);
		return result;
	});
	localCopies.set(key, copy);
	const forget = () => localCopies.delete(key);
	copy.then(forget, forget);
	return copy;
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return work;
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		if (signal.aborted) abort();
		signal.addEventListener("abort", abort, { once: true });
		void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}

const ERROR_REASON: Record<ChatAttachmentErrorCode, MessageKey> = {
	"too-large": "chat.attachments.tooLarge",
	"unknown-workspace": "chat.attachments.unknownWorkspace",
	"invalid-name": "chat.attachments.invalidName",
	"not-a-file": "chat.attachments.notAFile",
	unwritable: "chat.attachments.unwritable",
};

function failureReason(failure: UploadFailure): string {
	switch (failure.kind) {
		case "refused":
			return translate(ERROR_REASON[failure.code]);
		case "status":
			return translate("chat.attachments.hostAnswered", { status: failure.status });
		case "unreachable":
			return translate("chat.attachments.unreachable");
		case "request":
			return errorText(failure.error);
	}
}

export function attachmentFailureText(error: unknown): string {
	if (!(error instanceof AttachmentUploadError)) return errorText(error);
	return translate("chat.attachments.uploadFailed", {
		name: error.fileName,
		reason: failureReason(error.failure),
	});
}

export interface PromptFileUploadOptions {
	signal?: AbortSignal;
	onCopied?: (id: string, path: string) => void;
}

export async function uploadPromptFiles(
	workspaceId: string | null,
	files: readonly Pick<PromptFile, "id" | "name" | "source" | "copied">[],
	{ signal, onCopied }: PromptFileUploadOptions = {},
): Promise<string[]> {
	const paths: string[] = [];
	for (const file of files) {
		signal?.throwIfAborted();
		if (file.copied !== undefined) {
			paths.push(file.copied);
			continue;
		}
		const result =
			file.source.kind === "blob"
				? await uploadBlob(workspaceId, file, file.source.blob, signal, onCopied)
				: await untilAborted(copyLocal(workspaceId, file, file.source.path, onCopied), signal);
		if (!result.ok) {
			throw new AttachmentUploadError(file.name, { kind: "refused", code: result.error });
		}
		paths.push(result.path);
	}
	signal?.throwIfAborted();
	return paths;
}
