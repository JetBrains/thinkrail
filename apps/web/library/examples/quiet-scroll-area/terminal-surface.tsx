import { QuietScrollArea } from "@/components/QuietScrollArea";

const OUTPUT = Array.from(
	{ length: 30 },
	(_, index) => `✓ src/panels/test-${index + 1}.test.ts (${index + 3} tests)`,
);

export default function TerminalSurface() {
	return (
		<div className="h-160 w-full bg-container-terminal-bg">
			<QuietScrollArea surface="terminal" className="h-full" viewportClassName="p-12">
				<pre className="tr-code-text text-text-default">{OUTPUT.join("\n")}</pre>
			</QuietScrollArea>
		</div>
	);
}
