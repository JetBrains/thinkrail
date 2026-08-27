import { RiFullscreenLine as Maximize2 } from "@remixicon/react";
import type { ImageContent } from "@thinkrail/contracts";
import { useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";

function ToolResultImage({ image, label }: { image: ImageContent; label: string }) {
	const [open, setOpen] = useState(false);
	const src = `data:${image.mimeType};base64,${image.data}`;
	return (
		<div
			data-testid="tool-result-image-preview"
			className="relative flex min-h-64 w-full items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-border-default bg-sunken"
		>
			<img
				data-testid="tool-result-image-thumbnail"
				src={src}
				alt={label}
				loading="lazy"
				decoding="async"
				className="block max-h-[240px] max-w-full object-contain"
			/>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger asChild>
					<button
						type="button"
						data-testid="tool-result-image-fullscreen"
						aria-label={`View ${label} full screen`}
						title="Full screen"
						className="absolute top-4 right-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg p-4 text-text-muted transition-colors hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
					>
						<Maximize2 className="size-14" />
					</button>
				</DialogTrigger>
				<DialogContent
					data-testid="tool-result-image-dialog"
					className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-8"
				>
					<DialogHeader>
						<DialogTitle>{label}</DialogTitle>
					</DialogHeader>
					<div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-sunken">
						<img
							src={src}
							alt={label}
							decoding="async"
							className="max-h-[80vh] max-w-full object-contain"
						/>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

export function ToolResultImages({ images, label }: { images: ImageContent[]; label: string }) {
	if (images.length === 0) return null;
	return (
		<div data-testid="tool-result-images" className="mt-4 flex flex-col gap-4">
			{images.map((image, index) => (
				<ToolResultImage
					key={`${image.mimeType}:${image.data.length}:${image.data.slice(-24)}:${index}`}
					image={image}
					label={images.length === 1 ? label : `${label} (${index + 1} of ${images.length})`}
				/>
			))}
		</div>
	);
}
