import { useT } from "@thinkrail/locales/react";
import { Textarea } from "@thinkrail/ui/textarea";
import { useState } from "react";

export default function Preview() {
	const t = useT();
	const [body, setBody] = useState("Summarize the changes on $1 since yesterday.");
	return (
		<Textarea
			aria-label={t("chat.templateEditor.body")}
			value={body}
			onChange={(event) => setBody(event.target.value)}
			placeholder={t("chat.templateEditor.bodyPlaceholder")}
			rows={3}
			className="max-w-[24rem]"
		/>
	);
}
