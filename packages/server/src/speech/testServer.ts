import { createHash } from "node:crypto";

export interface ServedFile {
	body: Uint8Array;
	/** Serve 200 for every request, ignoring Range. */
	ignoreRange?: boolean;
	/** End the body early, as a dropped connection would. */
	truncateAt?: number;
}

export function sha256(body: Uint8Array): string {
	return createHash("sha256").update(body).digest("hex");
}

/** A loopback HTTP server for speech download tests: Range-aware, scriptable truncation. */
export function serveFiles(files: Map<string, ServedFile>) {
	const requests: { path: string; range: string | null }[] = [];
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(req) {
			const url = new URL(req.url);
			const range = req.headers.get("range");
			requests.push({ path: url.pathname, range });
			const file = files.get(url.pathname);
			if (!file) return new Response("missing", { status: 404 });
			let start = 0;
			const match = range ? /^bytes=(\d+)-$/.exec(range) : null;
			if (match && !file.ignoreRange) {
				start = Number(match[1]);
				if (start >= file.body.byteLength) return new Response(null, { status: 416 });
			}
			const end = file.truncateAt ?? file.body.byteLength;
			const slice = file.body.slice(start, Math.max(start, end));
			const status = start > 0 ? 206 : 200;
			return new Response(slice, { status });
		},
	});
	return {
		url: (path: string) => `http://127.0.0.1:${server.port}${path}`,
		requests,
		stop: () => server.stop(true),
	};
}
