import { toString as toQrString } from "qrcode";

/** Renders text as a scannable QR in the terminal (UTF-8 blocks), for printing a pairing link. */
export function renderQr(text: string): Promise<string> {
	return toQrString(text, { type: "terminal", small: true });
}
