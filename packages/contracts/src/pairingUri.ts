const SCHEME = "thinkrail:";
const HOST = "pair";
const VERSION = "1";

export interface PairingUriParams {
	signalingUrl: string;
	token: string;
	/** base64url raw Ed25519 host public key, so the device can verify who it paired with. */
	hostPublicKey: string;
	projectRef: string;
}

/** Builds the `thinkrail://pair?…` URI encoded into the QR code. */
export function buildPairingUri(params: PairingUriParams): string {
	const query = new URLSearchParams({
		v: VERSION,
		s: params.signalingUrl,
		t: params.token,
		k: params.hostPublicKey,
		p: params.projectRef,
	});
	return `${SCHEME}//${HOST}?${query.toString()}`;
}

/** Parses a scanned pairing URI, returning null when the scheme, version or any field is wrong. */
export function parsePairingUri(uri: string): PairingUriParams | null {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return null;
	}
	if (url.protocol !== SCHEME || url.host !== HOST || url.searchParams.get("v") !== VERSION) {
		return null;
	}
	const signalingUrl = url.searchParams.get("s");
	const token = url.searchParams.get("t");
	const hostPublicKey = url.searchParams.get("k");
	const projectRef = url.searchParams.get("p");
	if (!signalingUrl || !token || !hostPublicKey || !projectRef) return null;
	return { signalingUrl, token, hostPublicKey, projectRef };
}
