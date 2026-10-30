import { DiffStatBadge } from "@/panels/DiffStatBadge";
import { TreeRow } from "@/panels/TreeRow";

export default function Narrow() {
	return (
		<div className="w-full max-w-[12rem]">
			<TreeRow
				testid="change-item"
				kind="file"
				label="ChangesReviewPane.integration.test.tsx"
				onClick={() => {}}
				trailing={<DiffStatBadge added={1204} removed={387} />}
			/>
		</div>
	);
}
