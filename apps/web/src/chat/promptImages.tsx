import { RiCloseLine as X } from "@remixicon/react";
import { REQUEST_IMAGE_BASE64_BUDGET } from "@thinkrail/contracts";
import { type ReactNode, useCallback, useRef, useState } from "react";
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

export function PromptImageChips({
	controller,
	leading,
	testId = "composer-images",
}: {
	controller: PromptImagesController;
	leading?: ReactNode;
	testId?: string;
}) {
	const { images, pending, errors, removeImage, dismissError } = controller;
	if (!leading && images.length === 0 && pending === 0 && errors.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-4 px-12 pt-12" data-testid={testId}>
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
