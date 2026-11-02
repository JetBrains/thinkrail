import { EditCard } from "@/chat/tools/EditCard";

const oldText = Array.from({ length: 14 }, (_, i) => `const limit${i + 1} = ${i + 1};`).join("\n");
const newText = Array.from({ length: 14 }, (_, i) => `const limit${i + 1} = ${(i + 1) * 2};`).join(
	"\n",
);

export default function EditCardExample() {
	return (
		<div className="w-full">
			<EditCard
				toolCallId="library-edit-card"
				toolName="edit"
				args={{ path: "src/limits.ts", oldText, newText }}
				result={{ content: [{ type: "text", text: "Edited src/limits.ts" }] }}
				status="done"
				streaming={false}
			/>
		</div>
	);
}
