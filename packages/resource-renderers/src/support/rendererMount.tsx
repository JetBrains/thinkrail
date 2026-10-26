import {
	type ComponentType,
	type LazyExoticComponent,
	lazy,
	useCallback,
	useMemo,
	useState,
} from "react";
import { type ResourceHost, useResourceEnvironment, useResourceHost } from "../host";
import {
	type ResourceDescriptor,
	type ResourceDiffProps,
	type ResourceIntent,
	type ResourceRenderer,
	type ResourceViewModule,
	type ResourceViewProps,
	rendererImplementationKey,
	resolveRenderers,
	selectResourceRenderer,
} from "../registry";

const viewComponents = new Map<string, ComponentType<ResourceViewProps>>();
const lazyViews = new Map<string, ComponentType<ResourceViewProps>>();
const pendingViews = new Map<string, Promise<ResourceViewModule>>();
const failedViews = new Set<string>();
const diffComponents = new Map<string, LazyExoticComponent<ComponentType<ResourceDiffProps>>>();

function loadView(renderer: ResourceRenderer, mobile: boolean): Promise<ResourceViewModule> {
	const key = rendererImplementationKey(renderer.id, mobile);
	const pending = pendingViews.get(key);
	if (pending) return pending;
	const load = renderer.loadView;
	if (!load) throw new Error(`Resource renderer has no view loader: ${renderer.id}`);
	const next = load({ mobile }).then(
		(module) => {
			if (!viewComponents.has(key) || failedViews.delete(key)) {
				viewComponents.set(key, module.default);
				lazyViews.delete(key);
			}
			return module;
		},
		(error: unknown) => {
			pendingViews.delete(key);
			if (lazyViews.has(key) && viewComponents.get(key) === lazyViews.get(key))
				failedViews.add(key);
			throw error;
		},
	);
	pendingViews.set(key, next);
	return next;
}

function nextTask(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

export function preloadRendererView(
	renderer: ResourceRenderer,
	mobile: boolean,
	host: ResourceHost,
	resource: ResourceDescriptor,
): Promise<void> {
	if (!renderer.loadView) return Promise.resolve();
	return loadView(renderer, mobile)
		.then(async (module) => {
			await nextTask();
			module.warm?.(host, resource);
		})
		.catch((error: unknown) =>
			console.warn(`[resource-renderers] view preload failed: ${renderer.id}`, error),
		);
}

export function usePreloadResourceView(): (resource: ResourceDescriptor) => void {
	const host = useResourceHost();
	const { mobile } = useResourceEnvironment();
	return useCallback(
		(resource: ResourceDescriptor) => {
			const candidates = resolveRenderers(resource, "view", { mobile });
			const renderer = selectResourceRenderer(candidates, undefined, resource.path);
			if (renderer.capabilities.preload) void preloadRendererView(renderer, mobile, host, resource);
		},
		[host, mobile],
	);
}

export function RendererView({
	renderer,
	mobile,
	...props
}: ResourceViewProps & { renderer: ResourceRenderer; mobile: boolean }) {
	const key = rendererImplementationKey(renderer.id, mobile);
	let Component = viewComponents.get(key);
	if (!Component) {
		Component = lazy(() => loadView(renderer, mobile));
		viewComponents.set(key, Component);
		lazyViews.set(key, Component);
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

export function useRendererSelection(
	resource: ResourceDescriptor,
	intent: ResourceIntent,
	rendererId: string | undefined,
) {
	const { mobile } = useResourceEnvironment();
	const candidates = useMemo(
		() => resolveRenderers(resource, intent, { mobile }),
		[resource, intent, mobile],
	);
	const renderer = selectResourceRenderer(candidates, rendererId, resource.path);
	const implementationKey = rendererImplementationKey(renderer.id, mobile);
	const { placedThreadIds, onPlacedThreadIds } = usePlacedThreadIds(implementationKey);
	return { mobile, candidates, renderer, implementationKey, placedThreadIds, onPlacedThreadIds };
}
