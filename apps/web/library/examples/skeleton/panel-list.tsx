import { LoadingRegion } from "@thinkrail/ui/skeleton";

export default function PanelList() {
	return (
		<div className="w-full max-w-[20rem]">
			<LoadingRegion rows={5} className="px-8 py-4" />
		</div>
	);
}
