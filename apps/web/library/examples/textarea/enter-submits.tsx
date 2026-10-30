import { useT } from "@thinkrail/locales/react";
import { Textarea } from "@thinkrail/ui/textarea";
import { useState } from "react";
import { isPromptKeyEventComposing } from "@/prompt/SlashCommandCompletion";

export default function EnterSubmits() {
	const t = useT();
	const [prompt, setPrompt] = useState("");
	const [created, setCreated] = useState<string[]>([]);
	return (
		<div className="flex w-full flex-col gap-8">
			<Textarea
				value={prompt}
				onChange={(event) => setPrompt(event.target.value)}
				placeholder={t("panels.newWorkspace.promptPlaceholder")}
				spellCheck={false}
				rows={6}
				onKeyDown={(event) => {
					if (isPromptKeyEventComposing(event.nativeEvent)) return;
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						if (!prompt.trim()) return;
						setCreated((list) => [...list, prompt.trim()]);
						setPrompt("");
					}
				}}
			/>
			<output className="tr-text-metadata text-text-muted">{created.length}</output>
		</div>
	);
}
