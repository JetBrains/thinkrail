import { useState } from "react";
import { ExtUiPrompt } from "@/chat/ExtUiPrompt";

export default function ExtUiPromptExample() {
	const [reply, setReply] = useState<string | boolean | null | undefined>(undefined);
	if (reply !== undefined)
		return <output className="tr-code-text text-text-muted">{String(reply)}</output>;
	return (
		<ExtUiPrompt
			className="w-full"
			request={{
				id: "ext-1",
				sessionId: "session-1",
				kind: "confirm",
				title: "Deploy to staging?",
				message: "The extension will push the current branch and run the deploy script.",
			}}
			onReply={setReply}
		/>
	);
}
