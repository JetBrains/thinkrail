import type { AssetResolver } from "@thinkrail/extension-api/web";
import { resourceBytesUrl } from "./resourcePane";

export const MAX_MOCKUP_ASSET_BYTES = 2 * 1024 * 1024;

function blobDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

export interface WorkspaceAssetIo {
	bytesUrl: (workspaceId: string, path: string) => string;
	fetchBytes: (url: string) => Promise<Response>;
	toDataUrl: (blob: Blob) => Promise<string>;
}

const DEFAULT_IO: WorkspaceAssetIo = {
	bytesUrl: resourceBytesUrl,
	fetchBytes: (url) => fetch(url),
	toDataUrl: blobDataUrl,
};

export function createWorkspaceAssetResolver(
	workspaceId: string,
	io: Partial<WorkspaceAssetIo> = {},
): AssetResolver {
	const { bytesUrl, fetchBytes, toDataUrl } = { ...DEFAULT_IO, ...io };
	return async (path) => {
		const response = await fetchBytes(bytesUrl(workspaceId, path));
		if (!response.ok) return null;
		const declared = Number(response.headers.get("content-length"));
		if (Number.isFinite(declared) && declared > MAX_MOCKUP_ASSET_BYTES) return null;
		const blob = await response.blob();
		if (blob.size > MAX_MOCKUP_ASSET_BYTES) return null;
		return toDataUrl(blob);
	};
}
