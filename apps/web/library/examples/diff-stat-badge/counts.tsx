import { DiffStatBadge } from "@/panels/DiffStatBadge";

export default function Counts() {
	return (
		<div className="flex flex-col items-end gap-4">
			<DiffStatBadge added={12} removed={4} />
			<DiffStatBadge added={34} removed={0} />
			<DiffStatBadge added={0} removed={7} />
			<DiffStatBadge added={12045} removed={3871} />
		</div>
	);
}
