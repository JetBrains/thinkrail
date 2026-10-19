import { type ComponentType, type LazyExoticComponent, lazy, useCallback, useState } from "react";
import type { ResourceDiffProps, ResourceRenderer, ResourceViewProps } from "../registry";

const viewComponents = new Map<string, LazyExoticComponent<ComponentType<ResourceViewProps>>>();
const diffComponents = new Map<string, LazyExoticComponent<ComponentType<ResourceDiffProps>>>();

export function RendererView({
	renderer,
	implementationKey,
	mobile,
	...props
}: ResourceViewProps & { renderer: ResourceRenderer; implementationKey: string; mobile: boolean }) {
	let Component = viewComponents.get(implementationKey);
	if (!Component) {
		const load = renderer.loadView;
		if (!load) {
			throw new Error(`Resource renderer has no view loader: ${renderer.id}`);
		}
		Component = lazy(() => load({ mobile }));
		viewComponents.set(implementationKey, Component);
	}
	return <Component {...props} />;
}

export function RendererDiff({
	renderer,
	implementationKey,
	...props
}: ResourceDiffProps & { renderer: ResourceRenderer; implementationKey: string }) {
	let Component = diffComponents.get(implementationKey);
	if (!Component) {
		if (!renderer.loadDiff) {
			throw new Error(`Resource renderer has no diff loader: ${renderer.id}`);
		}
		Component = lazy(renderer.loadDiff);
		diffComponents.set(implementationKey, Component);
	}
	return <Component {...props} />;
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
	if (left.size !== right.size) return false;
	for (const id of left) if (!right.has(id)) return false;
	return true;
}

export function usePlacedThreadIds(implementationKey: string): {
	placedThreadIds: ReadonlySet<string> | undefined;
	onPlacedThreadIds: (ids: ReadonlySet<string>) => void;
} {
	const [placement, setPlacement] = useState<{
		implementationKey: string;
		ids: ReadonlySet<string>;
	} | null>(null);
	const onPlacedThreadIds = useCallback(
		(ids: ReadonlySet<string>) => {
			setPlacement((current) => {
				if (current?.implementationKey === implementationKey && sameIds(current.ids, ids)) {
					return current;
				}
				return { implementationKey, ids: new Set(ids) };
			});
		},
		[implementationKey],
	);
	const placedThreadIds =
		placement?.implementationKey === implementationKey ? placement.ids : undefined;
	return { placedThreadIds, onPlacedThreadIds };
}
