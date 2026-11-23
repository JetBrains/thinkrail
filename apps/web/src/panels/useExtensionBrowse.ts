import { useCallback, useEffect, useRef, useState } from "react";
import type { ExtensionCatalogRead } from "@/store";
import { getTransport, wsErrorCode } from "@/transport";
import type { ExtensionBrowseRead } from "./ExtensionBrowse";

const BROWSE_TIMEOUT_MS = 30_000;

export function useExtensionBrowse({
	enabled,
	installedCatalog,
}: {
	enabled: boolean;
	installedCatalog: ExtensionCatalogRead;
}): { read: ExtensionBrowseRead; retry: () => void } {
	const [read, setRead] = useState<ExtensionBrowseRead>({ status: "loading" });
	const generation = useRef(0);

	const load = useCallback((force: boolean) => {
		const request = ++generation.current;
		const current = () => request === generation.current;
		if (force) setRead({ status: "loading" });
		return getTransport()
			.request("extensions.browse", force ? { force: true } : {}, { timeoutMs: BROWSE_TIMEOUT_MS })
			.then((result) => {
				if (current()) setRead({ status: "loaded", result });
			})
			.catch((error: unknown) => {
				if (current()) setRead({ status: "failed", code: wsErrorCode(error) });
			});
	}, []);

	useEffect(() => {
		if (enabled && installedCatalog !== "loading") void load(false);
	}, [enabled, installedCatalog, load]);

	return { read, retry: () => void load(true) };
}
