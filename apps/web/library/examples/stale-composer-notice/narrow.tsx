import { StaleComposerNotice } from "../../../../../packages/resource-renderers/src/renderers/StaleComposerNotice";

export default function Narrow() {
	return (
		<div className="w-[10rem]">
			<StaleComposerNotice visible />
		</div>
	);
}
