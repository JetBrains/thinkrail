import type { AttachedImage } from "../chat/imageAttachment";
import { randomId } from "../lib";

export interface PromptImage extends AttachedImage {
	id: string;
	name: string;
}

export type PromptFileSource = { kind: "blob"; blob: Blob } | { kind: "local"; path: string };

export interface PromptFile {
	id: string;
	name: string;
	size: number;
	source: PromptFileSource;
	copied?: string;
}

export interface PromptImageError {
	id: string;
	name: string;
	reason: string;
}

export interface PromptImagesState {
	images: PromptImage[];
	files: PromptFile[];
	pending: number;
	errors: PromptImageError[];
	upload: AbortController | null;
	generation: string;
}

export function newPromptImagesState(): PromptImagesState {
	return {
		images: [],
		files: [],
		pending: 0,
		errors: [],
		upload: null,
		generation: randomId("prompt-images"),
	};
}

export function withoutPromptChips(
	state: PromptImagesState,
	ids: readonly string[],
): PromptImagesState {
	const gone = new Set(ids);
	return {
		...state,
		images: state.images.filter((image) => !gone.has(image.id)),
		files: state.files.filter((file) => !gone.has(file.id)),
		errors: state.errors.filter((error) => !gone.has(error.id)),
	};
}

export function withPendingWork(
	state: PromptImagesState,
	generation: string,
	delta: number,
): PromptImagesState {
	if (state.generation !== generation) return state;
	return { ...state, pending: state.pending + delta };
}

export function withCopiedPromptFile(
	state: PromptImagesState,
	id: string,
	path: string,
): PromptImagesState {
	if (!state.files.some((file) => file.id === id)) return state;
	return {
		...state,
		files: state.files.map((file) => (file.id === id ? { ...file, copied: path } : file)),
	};
}
