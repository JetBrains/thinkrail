import { useT } from "@thinkrail/locales/react";
import { Textarea } from "@thinkrail/ui/textarea";
import { useId, useState } from "react";

export default function Code() {
	const t = useT();
	const id = useId();
	const [args, setArgs] = useState("");
	return (
		<div className="flex w-full flex-col gap-4">
			<label htmlFor={id} className="tr-title-compact text-text-default">
				{t("mcp.form.args")}
			</label>
			<Textarea
				id={id}
				rows={3}
				value={args}
				placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
				onChange={(event) => setArgs(event.currentTarget.value)}
				className="px-8 py-4 tr-code-text"
			/>
			<span className="text-text-muted tr-text-metadata">{t("mcp.form.argsHint")}</span>
		</div>
	);
}
