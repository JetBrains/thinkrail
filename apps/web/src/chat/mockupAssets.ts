import type { AssetResolver } from "@thinkrail/extension-api/web";
import { createContext, useContext } from "react";

export const MockupAssetsContext = createContext<AssetResolver | undefined>(undefined);

export function useMockupAssets(): AssetResolver | undefined {
	return useContext(MockupAssetsContext);
}
