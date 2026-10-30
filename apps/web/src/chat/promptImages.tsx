import { RiCloseLine as X } from "@remixicon/react";
import { REQUEST_IMAGE_BASE64_BUDGET } from "@thinkrail/contracts";
import { t as translate, useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import {
	type ClipboardEvent,
	type DragEvent,
	type ReactNode,
	useCallback,
	useRef,
	useState,
} from "react";
import { FileChip } from "./FileChip";
import { fileToAttachedImage } from "./imageAttachment";
import {
	newPromptImagesState,
	type PromptImage,
	type PromptImageError,
	type PromptImagesState,
} from "./promptImageState";
import type { ChatAttachment } from "./types";

export interface PromptImagesOwner {
	state: PromptImagesState;
	read: () => PromptImagesState;
	update: (change: (current: PromptImagesState) => PromptImagesState) => void;
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

export function usePromptImages(owner?: PromptImagesOwner): PromptImagesController {
	const [local, setLocal] = useState(newPromptImagesState);
	const localRef = useRef(local);
	const { images, pending, errors } = owner?.state ?? local;
	const read = useCallback(() => owner?.read() ?? localRef.current, [owner]);
	const update = useCallback(
		(change: (current: PromptImagesState) => PromptImagesState) => {
			if (owner) owner.update(change);
			else {
				localRef.current = change(localRef.current);
				setLocal(localRef.current);
			}
		},
		[owner],
	);

	const addFiles = useCallback(
		(files: File[]) => {
			const picked = files.filter((f) => f.type.startsWith("image/"));
			if (picked.length === 0) return;
			const startedGeneration = read().generation;
			update((current) => ({ ...current, pending: current.pending + picked.length }));
			const decode = async () => {
				const settled = await Promise.allSettled(picked.map(fileToAttachedImage));
				update((current) => {
					if (current.generation !== startedGeneration) return current;
					let used = current.images.reduce((sum, p) => sum + p.content.data.length, 0);
					const additions: PromptImage[] = [];
					const nextErrors: PromptImageError[] = [];
					settled.forEach((result, i) => {
						const name = picked[i]?.name || translate("chat.promptImages.fallbackName");
						if (result.status !== "fulfilled" || result.value === null) {
							nextErrors.push({
								id: crypto.randomUUID(),
								name,
								reason: translate("chat.promptImages.unsupported"),
							});
							return;
						}
						const size = result.value.content.data.length;
						if (used + size > REQUEST_IMAGE_BASE64_BUDGET) {
							nextErrors.push({
								id: crypto.randomUUID(),
								name,
								reason: translate("chat.promptImages.limitReached"),
							});
							return;
						}
						used += size;
						additions.push({ id: crypto.randomUUID(), name, ...result.value });
					});
					return {
						...current,
						images: [...current.images, ...additions],
						errors: [...current.errors, ...nextErrors],
					};
				});
			};
			void decode().finally(() =>
				update((current) =>
					current.generation !== startedGeneration
						? current
						: { ...current, pending: current.pending - picked.length },
				),
			);
		},
		[read, update],
	);

	const removeImage = useCallback(
		(id: string) =>
			update((current) => ({
				...current,
				images: current.images.filter((p) => p.id !== id),
			})),
		[update],
	);

	const dismissError = useCallback(
		(id: string) =>
			update((current) => ({
				...current,
				errors: current.errors.filter((p) => p.id !== id),
			})),
		[update],
	);

	const restore = useCallback(
		(attachments: ChatAttachment[]) => {
			if (attachments.length === 0) return;
			update((current) => ({
				...current,
				images: [
					...attachments.map((attachment) => ({ id: crypto.randomUUID(), ...attachment })),
					...current.images,
				],
			}));
		},
		[update],
	);

	const reset = useCallback(() => {
		update(newPromptImagesState);
	}, [update]);

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
	const t = useT();
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
					title={t("chat.promptImages.attachFailedDetail", { name: err.name, reason: err.reason })}
					label={t("chat.promptImages.attachFailed", { name: err.name })}
					meta={`— ${err.reason}`}
					trailing={
						<button
							type="button"
							aria-label={t("common.dismiss")}
							onClick={() => dismissError(err.id)}
							className="hover:opacity-80"
						>
							<X className="size-14" />
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
						<IconButton
							icon={X}
							size="s"
							label={t("chat.promptImages.remove")}
							onClick={() => removeImage(img.id)}
						/>
					}
				/>
			))}
			{pending > 0 ? (
				<FileChip
					data-testid="composer-image-pending"
					label={
						<span className="text-text-muted">
							{t("chat.promptImages.attaching", { count: pending })}
						</span>
					}
				/>
			) : null}
		</div>
	);
}
