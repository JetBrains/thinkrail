import type { ExtensionCatalogEntry } from "@thinkrail/contracts";
import type { StatusItemHost, StatusItemProps } from "@thinkrail/extension-api/web";
import { type ComponentType, type LazyExoticComponent, lazy, Suspense, useMemo } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { extensionStatusItems, type RegisteredStatusItem } from "../extensions";
import { selectWorkspaceById, useAppStore } from "../store";
import { supportsExtensionQuery } from "../transport";
import {
	APP_HOST_LINKS,
	createStatusItemHost,
	type ExtensionCatalogRead,
	openableContributions,
	useExtensionCatalog,
} from "./extensionPanelHost";

const lazyItems = new WeakMap<
	RegisteredStatusItem["declaration"],
	LazyExoticComponent<ComponentType<StatusItemProps>>
>();

function lazyItem(
	declaration: RegisteredStatusItem["declaration"],
): LazyExoticComponent<ComponentType<StatusItemProps>> {
	let component = lazyItems.get(declaration);
	if (!component) {
		component = lazy(declaration.load);
		lazyItems.set(declaration, component);
	}
	return component;
}

/** The status items (or container sections) a host mounts: openable like a panel, and only once the host lists the extension. */
export function mountedStatusItems<T extends { extension: string }>(input: {
	disabled: readonly string[];
	protocolVersion: number | null;
	catalog: ExtensionCatalogRead;
	items: readonly T[];
}): { item: T; entry: ExtensionCatalogEntry }[] {
	const { catalog } = input;
	if (!Array.isArray(catalog)) return [];
	return openableContributions(input).flatMap((item) => {
		const entry = catalog.find((candidate) => candidate.name === item.extension);
		return entry ? [{ item, entry }] : [];
	});
}

export function useStatusItemHost(
	extension: string,
	apiVersion: number | undefined,
): StatusItemHost {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const workspaceId = useAppStore((state) => state.activeWorkspaceId);
	const projectId = useAppStore((state) =>
		state.activeWorkspaceId
			? (selectWorkspaceById(state, state.activeWorkspaceId)?.projectId ?? null)
			: null,
	);
	return useMemo(
		() =>
			createStatusItemHost({
				...APP_HOST_LINKS,
				extension,
				peek: workspaceId
					? (entry) => useAppStore.getState().requestPeek(workspaceId, entry)
					: null,
				disabled: () => useAppStore.getState().disabledExtensions.includes(extension),
				scope: workspaceId && projectId ? { workspaceId, projectId } : null,
				hostProtocol: protocolVersion,
				hostApiVersion: apiVersion,
			}),
		[apiVersion, extension, projectId, protocolVersion, workspaceId],
	);
}

function StatusItem({ item, entry }: { item: RegisteredStatusItem; entry: ExtensionCatalogEntry }) {
	const host = useStatusItemHost(item.extension, entry.apiVersion);
	const Item = lazyItem(item.declaration);
	return (
		<ErrorBoundary
			label={`${item.extension}.${item.item}`}
			reportId="extension-status-item"
			resetKeys={[item.extension, item.item]}
			fallback={null}
		>
			<Suspense fallback={null}>
				<Item host={host} />
			</Suspense>
		</ErrorBoundary>
	);
}

/** The extensions' readouts in the topbar's action cluster; none while off, unlisted or on an older host. */
export function ExtensionStatusItems() {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const disabled = useAppStore((state) => state.disabledExtensions);
	const items = extensionStatusItems();
	const { read } = useExtensionCatalog(items.length > 0 && supportsExtensionQuery(protocolVersion));
	return mountedStatusItems({ disabled, protocolVersion, catalog: read, items }).map(
		({ item, entry }) => (
			<StatusItem key={`${item.extension}.${item.item}`} item={item} entry={entry} />
		),
	);
}
