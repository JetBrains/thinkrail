import { createReadStream } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import { CodedError } from "@thinkrail/shared/codedError";
import type { SpeechArtifact } from "./manifest";

export type DownloadProgress = (receivedBytes: number) => void;

async function sizeOf(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch {
		return 0;
	}
}

async function hashPrefix(path: string, hasher: Bun.CryptoHasher): Promise<void> {
	for await (const chunk of createReadStream(path)) hasher.update(chunk);
}

function failed(message: string): CodedError {
	return new CodedError("SPEECH_DOWNLOAD_FAILED", message);
}

/**
 * Downloads one pinned artifact to `dest`, resuming `${dest}.partial` with an HTTP range when the
 * server honours it. The file appears at `dest` only once its size and SHA-256 match the pin; a
 * mismatch deletes the partial, a network failure keeps it for the next attempt.
 */
export async function downloadVerified(
	artifact: SpeechArtifact,
	dest: string,
	opts: { signal: AbortSignal; onProgress: DownloadProgress; fetchImpl?: typeof fetch },
): Promise<void> {
	const partial = `${dest}.partial`;
	const hasher = new Bun.CryptoHasher("sha256");
	let offset = await sizeOf(partial);
	if (offset > artifact.bytes) {
		await rm(partial, { force: true });
		offset = 0;
	}
	const headers: Record<string, string> = {};
	if (offset > 0) headers.Range = `bytes=${offset}-`;
	let response: Response;
	try {
		response = await (opts.fetchImpl ?? fetch)(artifact.url, {
			headers,
			redirect: "follow",
			signal: opts.signal,
		});
	} catch (err) {
		if (opts.signal.aborted) throw err;
		throw failed(`request failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (response.status === 200) {
		offset = 0;
	} else if (response.status === 206 && offset > 0) {
		await hashPrefix(partial, hasher);
	} else if (response.status === 416 && offset === artifact.bytes) {
		await hashPrefix(partial, hasher);
	} else {
		throw failed(`unexpected HTTP status ${response.status}`);
	}
	const handle = await open(partial, offset === 0 ? "w" : "a");
	let received = offset;
	opts.onProgress(received);
	try {
		if (response.status !== 416 && response.body) {
			const reader = response.body.getReader();
			while (true) {
				const chunk = await reader.read().catch((err: unknown) => {
					if (opts.signal.aborted) throw err;
					throw failed(`transfer interrupted: ${err instanceof Error ? err.message : String(err)}`);
				});
				if (chunk.done) break;
				received += chunk.value.byteLength;
				if (received > artifact.bytes) {
					await reader.cancel().catch(() => {});
					throw new CodedError("SPEECH_CHECKSUM_MISMATCH", "download is larger than pinned");
				}
				hasher.update(chunk.value);
				await handle.write(chunk.value);
				opts.onProgress(received);
			}
		}
	} catch (err) {
		await handle.close();
		if (err instanceof CodedError && err.code === "SPEECH_CHECKSUM_MISMATCH") {
			await rm(partial, { force: true });
		}
		throw err;
	}
	await handle.close();
	if (received !== artifact.bytes) {
		throw failed(`download ended at ${received} of ${artifact.bytes} bytes`);
	}
	if (hasher.digest("hex") !== artifact.sha256) {
		await rm(partial, { force: true });
		throw new CodedError("SPEECH_CHECKSUM_MISMATCH", "download does not match its pinned SHA-256");
	}
	await rename(partial, dest);
}
