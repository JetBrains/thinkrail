import { useEffect, useRef, useState } from "react";
import type { ResourceContent, ResourceDiffProps } from "@/resources";
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

function caption(label: string, size: Size | null, content: ResourceContent): string {
	const dimensions = size ? `${size.width} × ${size.height}` : "No dimensions";
	const bytes = content.kind === "bytes" ? formatByteLength(content.byteLength) : "No image";
	return `${label}: ${dimensions} · ${bytes}`;
}

export default function ImageDiff({
	resource,
	original,
	modified,
	review,
	onPlacedThreadIds,
	viewState,
	onViewState,
}: ResourceDiffProps) {
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
				path={resource.path}
				identity={originalIdentity}
				onSize={setLoadedOriginal}
			/>
		),
		caption: caption("Old", originalSize, original),
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
		caption: caption("New", modifiedSize, modified),
		intrinsicSize: modifiedSize,
		review: review?.worktree,
	};
	return (
		<VisualDiff
			prefix="image"
			noun="image"
			regionLabel="image region"
			original={originalSide}
			modified={modifiedSide}
			contentStamp={diffContentStamp(original, modified)}
			onPlacedThreadIds={onPlacedThreadIds}
			initialMode={imageDiffViewState(viewState)}
			onViewState={onViewState}
		/>
	);
}
