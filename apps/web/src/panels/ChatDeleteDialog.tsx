import { useT } from "@thinkrail/locales/react";
import { useEffect, useState } from "react";
import { selectChatWorkspaces, useAppStore } from "../store";
import { ConfirmDialog } from "./ConfirmDialog";
import { deleteProjectlessChat, inspectProjectlessChat } from "./chatActions";

export function ChatDeleteDialog({
	workspaceId,
	name,
	onClose,
}: {
	workspaceId: string | null;
	name: string;
	onClose: () => void;
}) {
	const t = useT();
	const [files, setFiles] = useState<{ files: number; truncated: boolean } | null>(null);
	const deletable = useAppStore((s) =>
		workspaceId === null
			? false
			: selectChatWorkspaces(s).some(
					(chat) => chat.id === workspaceId && chat.deletionPending !== true,
				),
	);

	useEffect(() => {
		setFiles(null);
		if (workspaceId === null) return;
		let current = true;
		void inspectProjectlessChat(workspaceId).then((result) => {
			if (current) setFiles(result);
		});
		return () => {
			current = false;
		};
	}, [workspaceId]);

	useEffect(() => {
		if (workspaceId !== null && !deletable) onClose();
	}, [workspaceId, deletable, onClose]);

	const description =
		files === null
			? t("panels.chats.deleteDescription")
			: files.truncated
				? t("panels.chats.deleteDescriptionFilesMany", { count: files.files })
				: t("panels.chats.deleteDescriptionFiles", { count: files.files });

	return (
		<ConfirmDialog
			open={workspaceId !== null && deletable}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title={t("panels.chats.deleteTitle", { name })}
			description={description}
			confirmLabel={t("common.delete")}
			destructive
			confirmTestId="confirm-delete-chat"
			onConfirm={() => {
				if (workspaceId !== null) void deleteProjectlessChat(workspaceId);
			}}
		/>
	);
}
