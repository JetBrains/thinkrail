import { useT } from "@thinkrail/locales/react";
import { Textarea } from "@thinkrail/ui/textarea";
import { useId, useState } from "react";
import { parseMcpServersJson } from "@/panels/mcpEntries";

export default function JsonValidation() {
	const t = useT();
	const id = useId();
	const [text, setText] = useState('{ "mcpServers": { "docs": { "command": "npx" ');
	const parsed = text.trim() ? parseMcpServersJson(t, text) : null;
	return (
		<div className="flex w-full flex-col gap-4">
			<label htmlFor={id} className="tr-title-compact text-text-default">
				{t("mcp.import.label")}
			</label>
			<Textarea
				id={id}
				rows={8}
				value={text}
				placeholder={'{ "mcpServers": { … } }'}
				onChange={(event) => setText(event.currentTarget.value)}
				className="px-8 py-4 tr-code-text"
			/>
			{parsed && !parsed.ok ? (
				<p role="alert" className="text-feedback-error tr-text-metadata">
					{parsed.error}
				</p>
			) : (
				<span className="text-text-muted tr-text-metadata">{t("mcp.import.hint")}</span>
			)}
		</div>
	);
}
