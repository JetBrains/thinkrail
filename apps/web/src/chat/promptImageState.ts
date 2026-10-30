import { randomId } from "../lib";
import type { AttachedImage } from "./imageAttachment";

export interface PromptImage extends AttachedImage {
	id: string;
	name: string;
}

export interface PromptImageError {
	id: string;
	name: string;
	reason: string;
}

export interface PromptImagesState {
	images: PromptImage[];
	pending: number;
	errors: PromptImageError[];
	generation: string;
}

export function newPromptImagesState(): PromptImagesState {
	return { images: [], pending: 0, errors: [], generation: randomId("prompt-images") };
}
