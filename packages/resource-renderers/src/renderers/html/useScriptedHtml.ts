import { useSyncExternalStore } from "react";
import { useOptionalResourceHost } from "../../host";
import type { ResourceDescriptor } from "../../registry";

const noSubscription = () => () => {};

export function useScriptedHtml({
	workspaceId,
	path,
}: Pick<ResourceDescriptor, "workspaceId" | "path">) {
	const scripted = useOptionalResourceHost()?.scriptedHtml;
	const allows = () => scripted?.allows(workspaceId, path) ?? false;
	return useSyncExternalStore(scripted?.subscribe ?? noSubscription, allows, allows);
}
