import { RiCloseLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useState } from "react";
import { FileChip } from "@/chat/FileChip";

const IMAGES = [
	{ id: "a", name: "screenshot.png", width: 1280, height: 720 },
	{ id: "b", name: "mockup-final-v3.jpg", width: 2048, height: 1536 },
];

export default function AttachmentStrip() {
	const t = useT();
	const [images, setImages] = useState(IMAGES);
	const [errors, setErrors] = useState([{ id: "e", name: "photo.heic" }]);
	return (
		<div className="flex flex-wrap gap-4">
			{errors.map((err) => (
				<FileChip
					key={err.id}
					tone="error"
					icon={false}
					title={t("chat.promptImages.attachFailedDetail", {
						name: err.name,
						reason: t("chat.promptImages.unsupported"),
					})}
					label={t("chat.promptImages.attachFailed", { name: err.name })}
					meta={`— ${t("chat.promptImages.unsupported")}`}
					trailing={
						<IconButton
							icon={RiCloseLine}
							size="s"
							label={t("common.dismiss")}
							onClick={() => setErrors((list) => list.filter((item) => item.id !== err.id))}
						/>
					}
				/>
			))}
			{images.map((img) => (
				<FileChip
					key={img.id}
					data-width={img.width}
					data-height={img.height}
					title={img.name}
					label={img.name}
					meta={` · ${img.width}×${img.height}`}
					trailing={
						<IconButton
							icon={RiCloseLine}
							size="s"
							label={t("chat.promptImages.remove")}
							onClick={() => setImages((list) => list.filter((item) => item.id !== img.id))}
						/>
					}
				/>
			))}
			<FileChip
				label={
					<span className="text-text-muted">{t("chat.promptImages.attaching", { count: 1 })}</span>
				}
			/>
		</div>
	);
}
