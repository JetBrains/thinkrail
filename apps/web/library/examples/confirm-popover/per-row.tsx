import { RiDeleteBin6Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { PopoverTrigger } from "@thinkrail/ui/popover";
import { useState } from "react";
import { ConfirmPopover } from "@/panels/ConfirmPopover";

const DRAFTS = ["Rename this prop", "Missing null check", "Split this effect"];

function DraftRow({ text, onDelete }: { text: string; onDelete: () => void }) {
	const t = useT();
	const [confirmDelete, setConfirmDelete] = useState(false);
	return (
		<li className="flex items-center gap-8 px-8 py-4">
			<span className="min-w-0 flex-1 truncate tr-text-ui">{text}</span>
			<ConfirmPopover
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title={t("review.panel.deleteTitle")}
				confirmLabel={t("common.delete")}
				destructive
				onConfirm={onDelete}
				align="end"
			>
				<PopoverTrigger asChild>
					<IconButton
						size="s"
						icon={RiDeleteBin6Line}
						label={t("review.comment.deleteDraft")}
						tone="danger"
						wrapTrigger
					/>
				</PopoverTrigger>
			</ConfirmPopover>
		</li>
	);
}

export default function PerRow() {
	const t = useT();
	const [drafts, setDrafts] = useState(DRAFTS);
	if (drafts.length === 0)
		return <p className="tr-text-metadata text-text-subtle">{t("review.panel.empty")}</p>;
	return (
		<ul className="flex w-full max-w-[24rem] flex-col">
			{drafts.map((text) => (
				<DraftRow
					key={text}
					text={text}
					onDelete={() => setDrafts((current) => current.filter((draft) => draft !== text))}
				/>
			))}
		</ul>
	);
}
