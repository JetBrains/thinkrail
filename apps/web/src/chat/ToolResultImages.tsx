import { RiFullscreenLine as Maximize2 } from "@remixicon/react";
import type { WireImage } from "@thinkrail/contracts";
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
import { ChatImage } from "./ChatImage";

function ToolResultImage({ image, label }: { image: WireImage; label: string }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<div
			data-testid="tool-result-image-preview"
			className="relative flex min-h-64 w-full items-center justify-center overflow-hidden rounded-sm border border-border-default bg-sunken"
		>
			<ChatImage
				image={image}
				label={label}
				testId="tool-result-image-thumbnail"
				className="block max-h-[240px] w-auto object-contain"
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
					className="h-[90vh] w-[95vw] max-w-[95vw] gap-8"
				>
					<DialogHeader>
						<DialogTitle>{label}</DialogTitle>
					</DialogHeader>
					<div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-sunken">
						<ChatImage image={image} label={label} className="max-h-full w-auto object-contain" />
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

export function ToolResultImages({ images, label }: { images: WireImage[]; label: string }) {
	const t = useT();
	if (images.length === 0) return null;
	return (
		<div data-testid="tool-result-images" className="mt-4 flex flex-col gap-4">
			{images.map((image, index) => (
				<ToolResultImage
					key={`${index}:${image.mimeType}`}
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
