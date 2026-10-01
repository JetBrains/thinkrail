import { RiCloseLine as X } from "@remixicon/react";
import { REQUEST_IMAGE_BASE64_BUDGET } from "@thinkrail/contracts";
import {
	type ClipboardEvent,
	type DragEvent,
	type ReactNode,
	useCallback,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib";
import { FileChip } from "./FileChip";
import { type AttachedImage, fileToAttachedImage } from "./imageAttachment";
import type { ChatAttachment } from "./types";

export interface PromptImage extends AttachedImage {
	id: string;
	name: string;
}

export interface PromptImageError {
	id: string;
	name: string;
	reason: string;
}

export interface PromptImagesController {
	images: PromptImage[];
	pending: number;
	errors: PromptImageError[];
	addFiles: (files: File[]) => void;
	removeImage: (id: string) => void;
	dismissError: (id: string) => void;
	restore: (attachments: ChatAttachment[]) => void;
	reset: () => void;
}

// Adapt a prompt input's paste/drop events onto the controller: forward dropped/pasted image files
// (preventing the default insertion) while leaving text paste/drop untouched. Shared by every
// prompt surface so image attachment behaves identically in the chat composer and the dialogs.
export function imagePasteDropHandlers(controller: Pick<PromptImagesController, "addFiles">): {
	onPaste: (e: ClipboardEvent<HTMLElement>) => void;
	onDrop: (e: DragEvent<HTMLElement>) => void;
} {
	return {
		onPaste: (e) => {
			const files = [...e.clipboardData.files];
			if (files.length === 0) return;
			e.preventDefault();
			controller.addFiles(files);
		},
		onDrop: (e) => {
			const files = [...e.dataTransfer.files];
			if (files.length === 0) return;
			e.preventDefault();
			controller.addFiles(files);
		},
	};
}

export function usePromptImages(): PromptImagesController {
	const [images, setImages] = useState<PromptImage[]>([]);
	const imagesRef = useRef<PromptImage[]>([]);
	const [pending, setPending] = useState(0);
	const [errors, setErrors] = useState<PromptImageError[]>([]);
	// Bumped on reset; a stale-generation decode discards its results (still balancing pending).
	const generation = useRef(0);

	const commit = useCallback((next: PromptImage[]) => {
		imagesRef.current = next;
		setImages(next);
	}, []);

	const addFiles = useCallback(
		(files: File[]) => {
			const picked = files.filter((f) => f.type.startsWith("image/"));
			if (picked.length === 0) return;
			const startedGeneration = generation.current;
			setPending((n) => n + picked.length);
			void (async () => {
				try {
					const settled = await Promise.allSettled(picked.map(fileToAttachedImage));
					if (startedGeneration !== generation.current) return;
					let used = imagesRef.current.reduce((sum, p) => sum + p.content.data.length, 0);
					const additions: PromptImage[] = [];
					const nextErrors: PromptImageError[] = [];
					settled.forEach((result, i) => {
						const name = picked[i]?.name || "image";
						if (result.status !== "fulfilled" || result.value === null) {
							nextErrors.push({
								id: crypto.randomUUID(),
								name,
								reason: "unsupported image format",
							});
							return;
						}
						const size = result.value.content.data.length;
						if (used + size > REQUEST_IMAGE_BASE64_BUDGET) {
							nextErrors.push({
								id: crypto.randomUUID(),
								name,
								reason: "message image limit reached",
							});
							return;
						}
						used += size;
						additions.push({ id: crypto.randomUUID(), name, ...result.value });
					});
					if (additions.length > 0) commit([...imagesRef.current, ...additions]);
					if (nextErrors.length > 0) setErrors((prev) => [...prev, ...nextErrors]);
				} finally {
					setPending((n) => n - picked.length);
				}
			})();
		},
		[commit],
	);

	const removeImage = useCallback(
		(id: string) => commit(imagesRef.current.filter((p) => p.id !== id)),
		[commit],
	);

	const dismissError = useCallback(
		(id: string) => setErrors((prev) => prev.filter((p) => p.id !== id)),
		[],
	);

	const restore = useCallback(
		(attachments: ChatAttachment[]) => {
			if (attachments.length === 0) return;
			commit([
				...attachments.map((attachment) => ({ id: crypto.randomUUID(), ...attachment })),
				...imagesRef.current,
			]);
		},
		[commit],
	);

	const reset = useCallback(() => {
		generation.current += 1;
		commit([]);
		setErrors([]);
	}, [commit]);

	return { images, pending, errors, addFiles, removeImage, dismissError, restore, reset };
}

// Padding presets for the chip strip. Both surfaces align the strip with the input field's left
// edge and leave the same 12px gap below it; they differ only in structure — the composer strip
// sits above a `p-12` input shell (so it owns its own left/top padding), while the dialog textarea
// is flush (so only the bottom gap is needed).
export const PROMPT_IMAGE_CHIPS_PADDING = {
	composer: "px-12 pt-12",
	dialog: "pb-12",
} as const;

export function PromptImageChips({
	controller,
	leading,
	testId = "composer-images",
	className = PROMPT_IMAGE_CHIPS_PADDING.composer,
}: {
	controller: PromptImagesController;
	leading?: ReactNode;
	testId?: string;
	className?: string;
}) {
	const { images, pending, errors, removeImage, dismissError } = controller;
	if (!leading && images.length === 0 && pending === 0 && errors.length === 0) return null;
	return (
		<div className={cn("flex flex-wrap gap-4", className)} data-testid={testId}>
			{leading}
			{errors.map((err) => (
				<FileChip
					key={err.id}
					data-testid="composer-image-error"
					tone="error"
					icon={false}
					title={`Couldn't attach ${err.name} — ${err.reason}`}
					label={`Couldn't attach ${err.name}`}
					meta={`— ${err.reason}`}
					trailing={
						<button
							type="button"
							aria-label="Dismiss"
							onClick={() => dismissError(err.id)}
							className="hover:opacity-80"
						>
							<X className="size-12" />
						</button>
					}
				/>
			))}
			{images.map((img) => (
				<FileChip
					key={img.id}
					data-testid="composer-image"
					data-width={img.width}
					data-height={img.height}
					data-mime={img.content.mimeType}
					title={img.name}
					label={img.name}
					meta={img.width && img.height ? ` · ${img.width}×${img.height}` : undefined}
					trailing={
						<button
							type="button"
							aria-label="Remove image"
							onClick={() => removeImage(img.id)}
							className="text-text-muted hover:text-text-default"
						>
							<X className="size-12" />
						</button>
					}
				/>
			))}
			{pending > 0 ? (
				<FileChip
					data-testid="composer-image-pending"
					label={
						<span className="text-text-muted">
							{pending === 1 ? "Attaching…" : `Attaching ${pending}…`}
						</span>
					}
				/>
			) : null}
		</div>
	);
}
