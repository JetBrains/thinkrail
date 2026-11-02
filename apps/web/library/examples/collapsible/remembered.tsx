import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { CodeBlock } from "@/chat/tools/CodeBlock";
import { Collapsible, countLines } from "@/chat/tools/Collapsible";

const toolCallId = "library-remembered";
const output = Array.from({ length: 30 }, (_, i) => `entry ${i + 1}`).join("\n");

export default function Remembered() {
	const t = useT();
	const [cardOpen, setCardOpen] = useState(true);
	return (
		<div className="flex w-full flex-col items-start gap-8">
			<Button
				variant="ghost"
				size="s"
				iconLeft={cardOpen ? RiArrowDownSLine : RiArrowRightSLine}
				aria-expanded={cardOpen}
				onClick={() => setCardOpen((open) => !open)}
			>
				{cardOpen ? t("resources.inspector.collapse") : t("changes.section.expand")}
			</Button>
			{cardOpen ? (
				<div className="w-full">
					<Collapsible id={`${toolCallId}:content`} lines={countLines(output)}>
						<CodeBlock code={output} lang="text" />
					</Collapsible>
				</div>
			) : null}
		</div>
	);
}
