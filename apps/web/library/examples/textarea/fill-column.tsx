import { useT } from "@thinkrail/locales/react";
import { Textarea } from "@thinkrail/ui/textarea";
import { useId, useState } from "react";

export default function FillColumn() {
	const t = useT();
	const id = useId();
	const [body, setBody] = useState(
		"## Summary\n\n- Moves the prompt field to the shared Textarea.\n\n## Testing\n\n- bun test",
	);
	return (
		<div className="flex h-[20rem] w-full flex-col">
			<div className="flex min-h-0 flex-1 flex-col gap-4">
				<label htmlFor={id} className="tr-text-eyebrow text-text-subtle">
					{t("panels.prCompose.bodyLabel")}
				</label>
				<Textarea
					id={id}
					value={body}
					onChange={(event) => setBody(event.target.value)}
					rows={14}
					className="min-h-160 flex-1 resize-y tr-code-text"
				/>
			</div>
		</div>
	);
}
