import {
	CapacitorBarcodeScanner,
	CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";

const PAIR_LINK = /^thinkrail:\/\/pair\b/;
const CANCELLED = "OS-PLUG-BARC-0006";
const CAMERA_DENIED = "OS-PLUG-BARC-0007";

export const isPairLink = (value: string | undefined): value is string =>
	value !== undefined && PAIR_LINK.test(value.trim());

export type ScanOutcome =
	| { kind: "link"; link: string }
	| { kind: "cancelled" }
	| { kind: "notPairLink" }
	| { kind: "cameraDenied" }
	| { kind: "noCamera" }
	| { kind: "failed"; reason: string };

/** False only when the WebView can list devices and none is a camera (the iOS Simulator); the native scanner then shows nothing and never answers. */
async function hasCamera(): Promise<boolean> {
	const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => undefined);
	return devices === undefined || devices.some((device) => device.kind === "videoinput");
}

export async function scanPairLink(labels: {
	instructions: string;
	cancel: string;
}): Promise<ScanOutcome> {
	if (!(await hasCamera())) return { kind: "noCamera" };
	try {
		const { ScanResult } = await CapacitorBarcodeScanner.scanBarcode({
			hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
			scanInstructions: labels.instructions,
			cancelButtonAccessibilityLabel: labels.cancel,
		});
		const value = ScanResult.trim();
		return isPairLink(value) ? { kind: "link", link: value } : { kind: "notPairLink" };
	} catch (error) {
		const code = (error as { code?: unknown }).code;
		if (code === CANCELLED) return { kind: "cancelled" };
		if (code === CAMERA_DENIED) return { kind: "cameraDenied" };
		return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
	}
}
