import { mulberry32 } from "../src/stats.ts";

/** A PEM private-key block shaped like an RSA-4096 key (2,349 bytes of DER, 64-character lines). */
export interface PemKey {
	block: string;
	/** The base64 body without line breaks. */
	body: string;
	lines: readonly string[];
}

/** A deterministic, fake RSA-4096-shaped private key block (random bytes, real layout). */
export function rsa4096Key(seed = 4096): PemKey {
	const random = mulberry32(seed);
	const der = Buffer.alloc(2_349);
	der.set([0x30, 0x82, 0x09, 0x29, 0x02, 0x01, 0x00, 0x02, 0x82, 0x02, 0x01, 0x00]);
	for (let at = 12; at < der.length; at++) der[at] = Math.floor(random() * 256);
	const body = der.toString("base64");
	const lines = body.match(/.{1,64}/g) ?? [];
	return {
		block: `-----BEGIN RSA PRIVATE KEY-----\n${lines.join("\n")}\n-----END RSA PRIVATE KEY-----`,
		body,
		lines,
	};
}

/** Lines of compiler-style diagnostics, `chars` long, that a key block can follow. */
export function diagnostics(chars: number): string {
	let out = "";
	for (let n = 1; out.length < chars; n++)
		out += `src/module${n % 37}.ts:${n}:${n % 80} warning  Unused variable 'value${n}'  no-unused-vars\n`;
	return out.slice(0, chars);
}

/**
 * Pieces of the key's body (12 base64 characters or more) that survive in `output`: every 12-character
 * window of the body, line breaks removed from both sides, so a fragment cut anywhere is still found.
 */
export function keyLeaks(output: string, key: PemKey, window = 12): string[] {
	const flat = output.replace(/\\n|\r?\n/g, "");
	const grams = new Set<string>();
	for (let at = 0; at + window <= flat.length; at++) grams.add(flat.slice(at, at + window));
	const found: string[] = [];
	for (let at = 0; at + window <= key.body.length; at += 1) {
		const piece = key.body.slice(at, at + window);
		if (grams.has(piece)) found.push(piece);
	}
	return found;
}
