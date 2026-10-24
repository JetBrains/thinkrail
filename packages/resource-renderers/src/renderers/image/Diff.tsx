import { type Translator, useT } from "@thinkrail/locales/react";
import { useEffect, useRef, useState } from "react";
import type { ResourceContent, ResourceDiffProps } from "../../registry";
import type { Size } from "../regionReview";
import { contentStamp, diffContentStamp } from "../reviewComposerState";
import { VisualDiff, type VisualDiffSide } from "../VisualDiff";
import { formatByteLength, imageDiffViewState, imageSourceUrl } from "./imageState";

type LoadedSize = { identity: string; size: Size } | null;

function imageIdentity(content: ResourceContent): string {
	return content.kind === "bytes"
		? JSON.stringify([contentStamp(content), content.url])
		: contentStamp(content);
}

function ImageContent({
	content,
	path,
	identity,
	onSize,
}: {
	content: ResourceContent;
	path: string;
	identity: string;
	onSize: (loaded: LoadedSize) => void;
}) {
	const identityRef = useRef(identity);
	identityRef.current = identity;
	if (content.kind !== "bytes") return null;
	return (
		<img
			key={identity}
			src={imageSourceUrl(content.url, content.hash)}
			alt={path}
			className="block h-full w-full object-contain"
			draggable={false}
			onLoad={(event) => {
				if (identityRef.current !== identity) return;
				const size = {
					width: event.currentTarget.naturalWidth,
					height: event.currentTarget.naturalHeight,
				};
				onSize(size.width > 0 && size.height > 0 ? { identity, size } : null);
			}}
			onError={() => {
				if (identityRef.current === identity) onSize(null);
			}}
		/>
	);
}

function caption(
	t: Translator,
	side: "old" | "new",
	size: Size | null,
	content: ResourceContent,
): string {
	const dimensions = size ? `${size.width} × ${size.height}` : t("viewer.image.noDimensions");
	const bytes =
		content.kind === "bytes" ? formatByteLength(t, content.byteLength) : t("viewer.image.noImage");
	return t(side === "old" ? "viewer.side.oldCaption" : "viewer.side.newCaption", {
		detail: `${dimensions} · ${bytes}`,
	});
}

export default function ImageDiff({
	resource,
	originalResource = resource,
	original,
	modified,
	review,
	onPlacedThreadIds,
	viewState,
	onViewState,
}: ResourceDiffProps) {
	const t = useT();
	const originalIdentity = imageIdentity(original);
	const modifiedIdentity = imageIdentity(modified);
	const [loadedOriginal, setLoadedOriginal] = useState<LoadedSize>(null);
	const [loadedModified, setLoadedModified] = useState<LoadedSize>(null);
	const originalSize = loadedOriginal?.identity === originalIdentity ? loadedOriginal.size : null;
	const modifiedSize = loadedModified?.identity === modifiedIdentity ? loadedModified.size : null;

	useEffect(() => {
		setLoadedOriginal((current) => (current?.identity === originalIdentity ? current : null));
	}, [originalIdentity]);
	useEffect(() => {
		setLoadedModified((current) => (current?.identity === modifiedIdentity ? current : null));
	}, [modifiedIdentity]);

	const originalSide: VisualDiffSide = {
		present: original.kind === "bytes",
		content: (
			<ImageContent
				content={original}
				path={originalResource.path}
				identity={originalIdentity}
				onSize={setLoadedOriginal}
			/>
		),
		caption: caption(t, "old", originalSize, original),
		intrinsicSize: originalSize,
		review: review?.base,
	};
	const modifiedSide: VisualDiffSide = {
		present: modified.kind === "bytes",
		content: (
			<ImageContent
				content={modified}
				path={resource.path}
				identity={modifiedIdentity}
				onSize={setLoadedModified}
			/>
		),
		caption: caption(t, "new", modifiedSize, modified),
		intrinsicSize: modifiedSize,
		review: review?.worktree,
	};
	return (
		<VisualDiff
			prefix="image"
			noun="image"
			selectionKey="image region"
			commentLabel={t("viewer.region.commentOnImageRegion")}
			original={originalSide}
			modified={modifiedSide}
			contentStamp={diffContentStamp(original, modified)}
			onPlacedThreadIds={onPlacedThreadIds}
			initialMode={imageDiffViewState(viewState)}
			onViewState={onViewState}
		/>
	);
}
