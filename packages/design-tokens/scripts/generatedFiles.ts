import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

export type GeneratedFile = { path: string; content: string };

export const normalizeEol = (text: string): string => text.replaceAll("\r\n", "\n");

const onDisk = (path: string): string => (existsSync(path) ? readFileSync(path, "utf8") : "");

export const isStale = ({ path, content }: GeneratedFile): boolean =>
	normalizeEol(onDisk(path)) !== normalizeEol(content);

export function writeOrCheck({
	label,
	version,
	outputs,
	check,
}: {
	label: string;
	version: string;
	outputs: GeneratedFile[];
	check: boolean;
}): void {
	if (!check) {
		for (const { path, content } of outputs) {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, content);
			console.log(`${label}: wrote ${relative(process.cwd(), path)}`);
		}
		return;
	}

	const stale = outputs.filter(isStale);
	if (stale.length > 0) {
		for (const { path } of stale) {
			console.error(`${label}: ${relative(process.cwd(), path)} is STALE`);
		}
		console.error(`Run \`bun run ${label}:generate\` and commit the result.`);
		process.exit(1);
	}
	console.log(`${label}: generated output is up to date (v${version})`);
}
