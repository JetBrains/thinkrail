import { type UIEvent, useState } from "react";
import { type QuietScrollEdges, QuietScrollFrame } from "@/components/QuietScrollArea";

const OUTPUT = Array.from(
	{ length: 40 },
	(_, index) => `[${index + 1}] compiling chunk ${index + 1}`,
);

function ThirdPartyLog({ onEdges }: { onEdges: (edges: QuietScrollEdges) => void }) {
	const report = (event: UIEvent<HTMLDivElement>) => {
		const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
		onEdges({
			top: scrollTop > 0,
			right: false,
			bottom: scrollTop < scrollHeight - clientHeight - 1,
			left: false,
		});
	};
	return (
		<div className="log-viewport absolute inset-0 overflow-auto" onScroll={report}>
			<pre className="tr-code-text text-text-default">{OUTPUT.join("\n")}</pre>
		</div>
	);
}

export default function Frame() {
	const [edges, setEdges] = useState<QuietScrollEdges>({
		top: false,
		right: false,
		bottom: true,
		left: false,
	});
	return (
		<div className="relative h-160 w-full bg-container-terminal-bg">
			<QuietScrollFrame
				viewportSelector=".log-viewport"
				surface="terminal"
				edges={edges}
				className="absolute inset-12"
			>
				<ThirdPartyLog onEdges={setEdges} />
			</QuietScrollFrame>
		</div>
	);
}
