import type { ExtensionCatalogEntry } from "@thinkrail/contracts";
import type { ContainerSectionProps } from "@thinkrail/extension-api/web";
import { type ComponentType, type LazyExoticComponent, lazy, Suspense } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { extensionContainerSections, type RegisteredContainerSection } from "../extensions";
import { useAppStore } from "../store";
import { supportsExtensionQuery } from "../transport";
import { mountedStatusItems, useStatusItemHost } from "./ExtensionStatusItems";
import { useExtensionCatalog } from "./extensionPanelHost";

const lazySections = new WeakMap<
	RegisteredContainerSection["declaration"],
	LazyExoticComponent<ComponentType<ContainerSectionProps>>
>();

function lazySection(
	declaration: RegisteredContainerSection["declaration"],
): LazyExoticComponent<ComponentType<ContainerSectionProps>> {
	let component = lazySections.get(declaration);
	if (!component) {
		component = lazy(declaration.load);
		lazySections.set(declaration, component);
	}
	return component;
}

function ContainerSection({
	item,
	entry,
	containerId,
}: {
	item: RegisteredContainerSection;
	entry: ExtensionCatalogEntry;
	containerId: string;
}) {
	const host = useStatusItemHost(item.extension, entry.apiVersion);
	const Section = lazySection(item.declaration);
	return (
		<ErrorBoundary
			label={`${item.extension}.${item.section}`}
			reportId="extension-container-section"
			resetKeys={[item.extension, item.section, containerId]}
			fallback={null}
		>
			<Suspense fallback={null}>
				<Section host={host} containerId={containerId} />
			</Suspense>
		</ErrorBoundary>
	);
}

/** The extensions' sections of a container's overview; none while off, unlisted or on an older host. */
export function ExtensionContainerSections({ containerId }: { containerId: string }) {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const disabled = useAppStore((state) => state.disabledExtensions);
	const items = extensionContainerSections();
	const { read } = useExtensionCatalog(items.length > 0 && supportsExtensionQuery(protocolVersion));
	return mountedStatusItems({ disabled, protocolVersion, catalog: read, items }).map(
		({ item, entry }) => (
			<ContainerSection
				key={`${item.extension}.${item.section}`}
				item={item}
				entry={entry}
				containerId={containerId}
			/>
		),
	);
}
