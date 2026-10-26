import type { MonacoReviewZoneState } from "./reviewWidgets";

function sameZones(a: MonacoReviewZoneState, b: MonacoReviewZoneState): boolean {
	return (
		a.composer?.node === b.composer?.node &&
		a.threads.length === b.threads.length &&
		a.threads.every((zone, index) => zone.node === b.threads[index]?.node)
	);
}

export function emitChangedZones(
	onZones: (zones: MonacoReviewZoneState) => void,
): (zones: MonacoReviewZoneState) => void {
	let last: MonacoReviewZoneState = { threads: [], composer: null };
	return (zones) => {
		if (sameZones(last, zones)) return;
		last = zones;
		onZones(zones);
	};
}
