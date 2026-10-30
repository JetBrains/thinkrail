import { useT } from "@thinkrail/locales/react";
import { Textarea } from "@thinkrail/ui/textarea";
import { useId, useState } from "react";

export default function Labelled() {
	const t = useT();
	const id = useId();
	const [body, setBody] = useState("");
	return (
		<div className="flex w-full flex-col gap-4 tr-text-ui">
			<label htmlFor={id} className="tr-text-emphasis text-text-default">
				{t("chat.templateEditor.body")}
			</label>
			<Textarea
				id={id}
				value={body}
				onChange={(event) => setBody(event.target.value)}
				placeholder={t("chat.templateEditor.bodyPlaceholder")}
				spellCheck={false}
				rows={8}
			/>
			<p className="text-text-muted tr-text-metadata">{t("chat.templateEditor.syntaxHint")}</p>
		</div>
	);
}
