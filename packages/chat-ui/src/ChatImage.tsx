import { RiImageLine as ImageIcon, RiRefreshLine as RefreshIcon } from "@remixicon/react";
import { isRefImage, type WireImage } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { createContext, useContext, useRef, useState } from "react";

export interface ChatMedia {
	resolveUrl: (ref: string) => string;
	retryEpoch: number;
}

export const ChatMediaContext = createContext<ChatMedia | null>(null);

export interface ImageLoadState {
	failedEpoch: number | null;
	query: string | null;
}

export const INITIAL_IMAGE_LOAD: ImageLoadState = { failedEpoch: null, query: null };

export function imageLoadView(
	state: ImageLoadState,
	epoch: number,
): { query: string | null; unavailable: boolean } {
	const reconnected = state.failedEpoch !== null && state.failedEpoch !== epoch;
	return {
		query: reconnected ? `epoch-${epoch}` : state.query,
		unavailable: state.failedEpoch !== null,
	};
}

export function imageLoadFailed(state: ImageLoadState, epoch: number): ImageLoadState {
	return { failedEpoch: epoch, query: imageLoadView(state, epoch).query };
}

export function imageLoadSucceeded(state: ImageLoadState, epoch: number): ImageLoadState {
	return state.failedEpoch === null
		? state
		: { failedEpoch: null, query: imageLoadView(state, epoch).query };
}

export function imageLoadRetried(
	state: ImageLoadState,
	epoch: number,
	nonce: string,
): ImageLoadState {
	return { failedEpoch: state.failedEpoch === null ? null : epoch, query: `manual-${nonce}` };
}

export function chatImageUrl(
	image: WireImage,
	media: ChatMedia | null,
	query: string | null,
): string | null {
	if (!isRefImage(image)) return `data:${image.mimeType};base64,${image.data}`;
	if (!media) return null;
	const url = media.resolveUrl(image.ref);
	return query === null ? url : `${url}?retry=${encodeURIComponent(query)}`;
}

const FIT_CLASS = {
	thumbnail: "max-h-[240px]",
	screen: "max-h-[78vh]",
} as const;

interface ChatImageProps {
	image: WireImage;
	label: string;
	fit: keyof typeof FIT_CLASS;
	testId?: string;
}

export function ChatImage({ image, label, fit, testId }: ChatImageProps) {
	const t = useT();
	const media = useContext(ChatMediaContext);
	const frame = useRef<HTMLSpanElement>(null);
	const [load, setLoad] = useState(INITIAL_IMAGE_LOAD);
	const epoch = media?.retryEpoch ?? 0;
	const view = imageLoadView(load, epoch);
	const src = chatImageUrl(image, media, view.query);
	const unavailable = src === null || view.unavailable;
	const box =
		isRefImage(image) && image.width !== undefined && image.height !== undefined
			? { width: image.width, height: image.height }
			: null;
	return (
		<span
			ref={frame}
			tabIndex={-1}
			data-testid="chat-image"
			data-state={unavailable ? "unavailable" : undefined}
			className={cn(
				"relative inline-flex max-w-full outline-none",
				unavailable && (box === null || box.width < 160 || box.height < 96) && "min-h-96 min-w-160",
			)}
		>
			{src === null ? null : (
				<img
					data-testid={testId}
					src={src}
					alt={label}
					loading="lazy"
					decoding="async"
					{...box}
					onError={() => setLoad(imageLoadFailed(load, epoch))}
					onLoad={() => {
						if (frame.current?.contains(document.activeElement)) {
							frame.current.focus({ preventScroll: true });
						}
						setLoad(imageLoadSucceeded(load, epoch));
					}}
					className={cn(
						"w-auto max-w-full object-contain",
						box === null && "h-auto",
						FIT_CLASS[fit],
						unavailable && "invisible",
					)}
				/>
			)}
			{unavailable ? (
				<span
					data-testid="chat-image-unavailable"
					className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-hidden rounded-sm border border-border-default bg-sunken p-8 text-center text-text-muted tr-text-metadata"
				>
					<ImageIcon aria-hidden="true" className="size-20 shrink-0" />
					<span>{t("chat.image.unavailable")}</span>
					<span className="max-w-full truncate text-text-subtle">{label}</span>
					{src === null ? null : (
						<Button
							variant="outline"
							size="s"
							iconLeft={RefreshIcon}
							tabIndex={0}
							data-testid="chat-image-retry"
							aria-label={t("chat.image.retryLabel", { label })}
							onClick={() => setLoad(imageLoadRetried(load, epoch, String(Date.now())))}
						>
							{t("chat.image.retry")}
						</Button>
					)}
				</span>
			) : null}
		</span>
	);
}
