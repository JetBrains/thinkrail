import { openSurface, remixicon, type SurfaceProps, ui } from "@thinkrail/ext/view";
import { DRIFT_KINDS, type Drift, isRecord } from "./model";
import { DriftLine } from "./parts";

const { RiGitBranchLine, RiNodeTree } = remixicon;
const SHOWN = 6;

const isDrift = (value: unknown): value is Drift =>
	isRecord(value) &&
	typeof value.key === "string" &&
	typeof value.detail === "string" &&
	DRIFT_KINDS.some((kind) => kind === value.kind);

const itemsOf = (details: unknown) =>
	isRecord(details) && Array.isArray(details.items) ? details.items.filter(isDrift) : [];

const DriftCard = ({ message }: SurfaceProps) => {
	const items = itemsOf(message?.details);
	return (
		<div
			data-testid="railmap-drift-card"
			className="flex flex-col gap-8 rounded-md border border-feedback-error-muted bg-feedback-error-subtle p-12"
		>
			<div className="flex items-center gap-8">
				<RiGitBranchLine className="size-16 text-feedback-error" />
				<span className="tr-title-compact text-text-default" data-testid="railmap-drift-card-title">
					This run added {items.length} spec drift item{items.length === 1 ? "" : "s"}
				</span>
				<ui.Button
					className="ml-auto"
					variant="ghost"
					size="sm"
					onClick={() => openSurface("railmap", "drift")}
				>
					<RiNodeTree className="size-14" /> Open drift
				</ui.Button>
			</div>
			<ul className="flex flex-col gap-8">
				{items.slice(0, SHOWN).map((item) => (
					<li key={item.key} data-testid="railmap-drift-card-item">
						<DriftLine item={item} />
					</li>
				))}
			</ul>
			{items.length > SHOWN && (
				<span className="tr-text-metadata text-text-muted">… {items.length - SHOWN} more</span>
			)}
		</div>
	);
};

export default DriftCard;
