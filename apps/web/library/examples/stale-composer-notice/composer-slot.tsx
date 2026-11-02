import { StaleComposerNotice } from "../../../../../packages/resource-renderers/src/renderers/StaleComposerNotice";

export default function ComposerSlot() {
	return (
		<div className="flex w-full flex-col gap-8">
			<pre className="tr-code-text text-text-default">
				{'{\n  "name": "thinkrail",\n  "private": true\n}'}
			</pre>
			<StaleComposerNotice visible />
		</div>
	);
}
