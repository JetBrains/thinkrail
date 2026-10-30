import { StaleComposerNotice } from "../../../../../packages/resource-renderers/src/renderers/StaleComposerNotice";

const LINES = Array.from(
	{ length: 12 },
	(_, index) => `${index + 1}  const step${index + 1} = load(${index + 1});`,
);

export default function DiffTop() {
	return (
		<div className="h-128 w-full overflow-auto">
			<StaleComposerNotice visible />
			<pre className="tr-code-text text-text-default">{LINES.join("\n")}</pre>
		</div>
	);
}
