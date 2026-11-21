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

async function uploadBlob(
	workspaceId: string | null,
	name: string,
	blob: Blob,
	signal: AbortSignal | undefined,
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
	signal?.throwIfAborted();
	if (isChatAttachmentResult(result)) return result;
	throw new AttachmentUploadError(name, { kind: "status", status: response.status });
}

async function copyLocal(
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
				? await uploadBlob(workspaceId, file.name, file.source.blob, signal)
				: await copyLocal(workspaceId, file.name, file.source.path);
		if (!result.ok) {
			throw new AttachmentUploadError(file.name, { kind: "refused", code: result.error });
		}
		onCopied?.(file.id, result.path);
		paths.push(result.path);
	}
	signal?.throwIfAborted();
	return paths;
}
