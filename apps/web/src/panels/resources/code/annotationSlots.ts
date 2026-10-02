export interface AnnotationSlot<T> {
	id: string;
	annotation: T;
}

export function reconcileAnnotationSlots<T>(
	previous: readonly AnnotationSlot<T>[],
	current: readonly AnnotationSlot<T>[],
	equal: (left: T, right: T) => boolean,
): AnnotationSlot<T>[] {
	const currentById = new Map(current.map((slot) => [slot.id, slot]));
	const known = new Set(previous.map((slot) => slot.id));
	const slots = previous.map((slot) => {
		const next = currentById.get(slot.id);
		if (!next || equal(slot.annotation, next.annotation)) return slot;
		return next;
	});
	for (const slot of current) {
		if (!known.has(slot.id)) slots.push(slot);
	}
	return slots;
}
