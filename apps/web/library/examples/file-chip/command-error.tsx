import { FileChip } from "@/chat/FileChip";

export default function CommandError() {
	const message = "Unknown command: /deploy";
	return (
		<div className="flex flex-wrap gap-4">
			<FileChip tone="error" icon={false} title={message} label={message} />
		</div>
	);
}
