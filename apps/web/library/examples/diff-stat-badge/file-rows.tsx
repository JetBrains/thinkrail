import type { GitFileChange } from "@thinkrail/contracts";
import { FileRow } from "@/panels/planFileRow";

const FILES: GitFileChange[] = [
	{ path: "apps/web/src/chat/Composer.tsx", status: "modified", added: 42, removed: 17 },
	{ path: "apps/web/src/chat/FileChip.tsx", status: "added", added: 61 },
	{ path: "apps/web/src/chat/legacyChip.tsx", status: "deleted", removed: 38 },
	{ path: "apps/web/public/preview.png", status: "added" },
];

export default function FileRows() {
	return (
		<ul className="flex w-full max-w-[28rem] flex-col">
			{FILES.map((file) => (
				<FileRow key={file.path} file={file} onOpen={() => {}} />
			))}
		</ul>
	);
}
