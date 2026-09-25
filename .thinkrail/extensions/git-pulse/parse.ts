import {
	type Commit,
	type Counts,
	type FileChange,
	type Head,
	MAX_FILES,
	type Snapshot,
} from "./model";

const FIELD = "\x1f";
const RECORD = "\x1e";

export const LOG_FORMAT = "%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e";

const PATH_OFFSET = { "1": 8, "2": 9, u: 10 } as const;

const splitAfter = (entry: string, fields: number) => {
	let at = 0;
	for (let i = 0; i < fields; i++) {
		at = entry.indexOf(" ", at) + 1;
		if (at === 0) return undefined;
	}
	return { head: entry.slice(0, at - 1).split(" "), path: entry.slice(at) };
};

const headOf = (oid: string | undefined, name: string | undefined): Head => {
	if (name === undefined || name === "(detached)") return { kind: "detached", oid: oid ?? "" };
	if (oid === undefined || oid === "(initial)") return { kind: "unborn", name };
	return { kind: "branch", name, oid };
};

const count = (value: string | undefined) => Math.abs(Number.parseInt(value ?? "0", 10)) || 0;

export const parseStatus = (stdout: string): Omit<Snapshot, "commits"> => {
	const headers = new Map<string, string>();
	const files: FileChange[] = [];
	const counts: Counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
	const entries = stdout.split("\0");
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i] ?? "";
		if (entry.startsWith("# ")) {
			const space = entry.indexOf(" ", 2);
			if (space > 0) headers.set(entry.slice(2, space), entry.slice(space + 1));
			continue;
		}
		if (entry.startsWith("? ")) {
			counts.untracked++;
			files.push({ path: entry.slice(2), kind: "untracked", index: "?", worktree: "?" });
			continue;
		}
		const type = entry[0];
		if (type !== "1" && type !== "2" && type !== "u") continue;
		const split = splitAfter(entry, PATH_OFFSET[type]);
		if (!split) continue;
		const xy = split.head[1] ?? "..";
		const index = xy[0] ?? ".";
		const worktree = xy[1] ?? ".";
		if (type === "u") {
			counts.conflicted++;
			files.push({ path: split.path, kind: "conflicted", index, worktree });
			continue;
		}
		if (index !== ".") counts.staged++;
		if (worktree !== ".") counts.unstaged++;
		const from = type === "2" ? entries[++i] : undefined;
		files.push({ path: split.path, ...(from ? { from } : {}), kind: "tracked", index, worktree });
	}
	const upstreamName = headers.get("branch.upstream");
	const [ahead, behind] = (headers.get("branch.ab") ?? "").split(" ");
	return {
		head: headOf(headers.get("branch.oid"), headers.get("branch.head")),
		...(upstreamName
			? {
					upstream: {
						name: upstreamName,
						ahead: count(ahead),
						behind: count(behind),
						gone: !headers.has("branch.ab"),
					},
				}
			: {}),
		counts,
		files: files.slice(0, MAX_FILES),
		filesTotal: files.length,
		stash: count(headers.get("stash")),
	};
};

export const parseLog = (stdout: string): Commit[] =>
	stdout.split(RECORD).flatMap((record) => {
		const [hash, short, author, at, subject] = record.trim().split(FIELD);
		if (!hash || !short || author === undefined || !at) return [];
		return [{ hash, short, author, subject: subject ?? "", time: Number(at) * 1000 }];
	});
