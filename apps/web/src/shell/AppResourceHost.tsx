import {
	type ResourceHost,
	ResourceHostProvider,
	registerBundledResourceRenderers,
} from "@thinkrail/resource-renderers";
import { type ReactNode, useMemo } from "react";
import { openFileInTab } from "../panels/openTabs";
import { resourceBytesUrl } from "../panels/resourcePane";
import { useAppStore } from "../store";

registerBundledResourceRenderers();

const loadMarkdown = () => import("../chat/Markdown").then((module) => module.Markdown);

const loadCode = () => import("./resourceCode").then((module) => module.resourceCode);

const openFile = (workspaceId: string, path: string) => {
	void openFileInTab(workspaceId, path, "preview");
};

export function AppResourceHost({ children }: { children: ReactNode }) {
	const fileLineWidth = useAppStore((state) => state.fileLineWidth);
	const fileLineWidthBounded = useAppStore((state) => state.fileLineWidthBounded);
	const host = useMemo<ResourceHost>(
		() => ({
			loadMarkdown,
			loadCode,
			bytesUrl: resourceBytesUrl,
			openFile,
			fileLineWidth,
			fileLineWidthBounded,
		}),
		[fileLineWidth, fileLineWidthBounded],
	);
	return <ResourceHostProvider value={host}>{children}</ResourceHostProvider>;
}
