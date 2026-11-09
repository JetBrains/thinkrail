import { RiFullscreenLine as Maximize2 } from "@remixicon/react";
import type { ImageContent } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@thinkrail/ui/dialog";
import { useState } from "react";

function ToolResultImage({ image, label }: { image: ImageContent; label: string }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const src = `data:${image.mimeType};base64,${image.data}`;
	return (
		<div
			data-testid="tool-result-image-preview"
			className="relative flex min-h-64 w-full items-center justify-center overflow-hidden rounded-sm border border-border-default bg-sunken"
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
					<IconButton
						icon={Maximize2}
						variant="outline"
						data-testid="tool-result-image-fullscreen"
						label={t("chat.toolImages.viewFullScreen", { label })}
						tooltip={t("chat.toolImages.fullScreen")}
						className="absolute top-4 right-4"
					/>
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
	const t = useT();
	if (images.length === 0) return null;
	return (
		<div data-testid="tool-result-images" className="mt-4 flex flex-col gap-4">
			{images.map((image, index) => (
				<ToolResultImage
					key={`${image.mimeType}:${image.data.length}:${image.data.slice(-24)}:${index}`}
					image={image}
					label={
						images.length === 1
							? label
							: t("chat.toolImages.indexed", { label, index: index + 1, total: images.length })
					}
				/>
			))}
		</div>
	);
}
