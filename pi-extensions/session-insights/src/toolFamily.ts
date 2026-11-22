import { SUBAGENT_TOOLS, type ToolFamily } from "./core.ts";
import { safeCut } from "./redact.ts";

const MULTI_WORD = new Set([
	"git",
	"gh",
	"bun",
	"bunx",
	"npm",
	"npx",
	"pnpm",
	"yarn",
	"cargo",
	"go",
	"docker",
	"make",
	"turbo",
	"python",
	"python3",
	"node",
	"pip",
	"pip3",
	"uv",
	"kubectl",
	"dotnet",
	"gradle",
	"mvn",
	"systemctl",
	"tsc",
	"pi",
	"jj",
	"tmux",
	"deno",
	"brew",
	"apt",
	"pacman",
	"biome",
]);
const SKIP_HEAD = new Set([
	"cd",
	"pushd",
	"popd",
	"export",
	"set",
	"source",
	".",
	"true",
	":",
	"unset",
	"shopt",
	"local",
]);
const WRAPPERS = new Set([
	"timeout",
	"time",
	"env",
	"nice",
	"sudo",
	"command",
	"exec",
	"nohup",
	"xargs",
	"stdbuf",
]);
const OPTION_WITH_VALUE: Readonly<Record<string, ReadonlySet<string>>> = {
	git: new Set(["-C", "-c", "--git-dir", "--work-tree"]),
	gh: new Set(["-R", "--repo"]),
	bun: new Set(["--cwd", "--filter", "-F"]),
	npm: new Set(["--prefix", "-w", "--workspace"]),
	pnpm: new Set(["-C", "--dir", "--filter", "-F"]),
	turbo: new Set(["--filter", "-F"]),
	make: new Set(["-C", "-f"]),
	cargo: new Set(["--manifest-path", "-p", "--package"]),
	docker: new Set(["-f", "--file", "--context"]),
	tmux: new Set(["-L", "-S", "-t"]),
};
const NO_OPTIONS: ReadonlySet<string> = new Set();

const DISCOVERY = new Set([
	"ls",
	"find",
	"fd",
	"rg",
	"grep",
	"tree",
	"which",
	"du",
	"stat",
	"git ls-files",
	"git grep",
	"git status",
	"git branch",
	"gh pr list",
	"gh issue list",
	"gh search",
	"gh run list",
	"gh pr checks",
	"gh pr status",
	"locate",
	"ag",
	"pwd",
	"realpath",
	"readlink",
]);
const READING = new Set([
	"cat",
	"sed",
	"head",
	"tail",
	"less",
	"nl",
	"awk",
	"jq",
	"wc",
	"diff",
	"cut",
	"sort",
	"uniq",
	"git diff",
	"git show",
	"git log",
	"git blame",
	"git rev-parse",
	"git merge-base",
	"git cat-file",
	"git rev-list",
	"gh pr view",
	"gh pr diff",
	"gh issue view",
	"gh api",
	"gh run view",
	"gh repo view",
	"curl",
	"xxd",
	"od",
	"strings",
	"file",
]);
const WRITING = new Set([
	"rm",
	"mv",
	"cp",
	"mkdir",
	"touch",
	"chmod",
	"ln",
	"tee",
	"patch",
	"rmdir",
	"git add",
	"git commit",
	"git checkout",
	"git switch",
	"git reset",
	"git rebase",
	"git merge",
	"git cherry-pick",
	"git stash",
	"git push",
	"git restore",
	"git apply",
	"git rm",
	"git mv",
	"git tag",
	"gh pr create",
	"gh pr edit",
	"gh pr comment",
	"gh pr close",
	"gh pr merge",
	"gh pr review",
	"gh issue comment",
	"gh issue create",
	"gh issue close",
	"gh issue edit",
	"truncate",
	"unzip",
	"tar",
]);

const SEARCH_TOOLS = new Set(["grep", "find", "ls", "web_search", "source_check"]);
const READ_TOOLS = new Set(["read", "fetch_content", "get_search_content"]);
const WRITE_TOOLS = new Set(["edit", "write"]);
const SHELL_TOOLS = new Set(["bash", "background_command"]);
const SUBAGENT = new Set(SUBAGENT_TOOLS);

function baseName(path: string): string {
	const at = path.lastIndexOf("/");
	return at >= 0 ? path.slice(at + 1) : path;
}

function stripWrappers(tokens: string[]): string[] {
	const out = [...tokens];
	while (out.length > 0) {
		const first = (out[0] ?? "").replace(/^[({]+/, "");
		if (!first) {
			out.shift();
			continue;
		}
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
			out.shift();
			continue;
		}
		if (WRAPPERS.has(first)) {
			out.shift();
			while (out.length > 0 && (/^-/.test(out[0] ?? "") || /^\d+[smh]?$/.test(out[0] ?? "")))
				out.shift();
			continue;
		}
		out[0] = first;
		break;
	}
	return out;
}

/** The first one to three tokens of the first meaningful command (pass it masked): `cd x && bun test a.ts` → `bun test`. */
export function bashHead(command: unknown): string | null {
	if (typeof command !== "string" || !command.trim()) return null;
	for (const segment of command.split(/&&|\|\||;|\n|\|/)) {
		const tokens = stripWrappers(segment.trim().split(/\s+/).filter(Boolean));
		if (tokens.length === 0) continue;
		let head = (tokens[0] ?? "").replace(/^["']|["']$/g, "");
		if (SKIP_HEAD.has(head)) continue;
		if (head.includes("/")) head = baseName(head);
		if (!/^[A-Za-z0-9._+-]+$/.test(head)) return head.slice(0, safeCut(head, 20)) || null;
		const out = [head];
		if (MULTI_WORD.has(head)) {
			const withValue = OPTION_WITH_VALUE[head] ?? NO_OPTIONS;
			for (let at = 1; at < tokens.length && out.length < 3; at += 1) {
				const token = tokens[at] ?? "";
				if (token.startsWith("-")) {
					if (withValue.has(token)) at += 1;
					continue;
				}
				if (
					/^[a-z][a-z0-9:_.-]*$/i.test(token) &&
					token.length <= 24 &&
					!/\.(ts|tsx|js|mjs|json|md|py|sh|txt)$/.test(token)
				)
					out.push(token);
				else break;
			}
		}
		return out.join(" ");
	}
	return null;
}

const QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"/g;
const HEREDOC = /(?<!<)<<(?!<)-?\s*(['"]?)(\w+)\1/;
const REDIRECT = /(?:^|[\s;&|(])(?:\d*|&)>>?(?!&)\s*([^\s;&|<>()]+)/g;
const TEE = /(?:^|[;&|(\s])tee(?:\s+-\S+)*\s+([^\s;&|<>()-]\S*)/;
const IN_PLACE = /(?:^|[\s;&|(])(?:sed|perl)\s(?:[^;&|]*\s)?(?:-[A-Za-z]*i(?=[\s.]|$)|--in-place)/;

/** Whether a shell command writes into a file: an output redirection, `tee` or an in-place `sed` / `perl`. */
export function shellWrites(command: string): boolean {
	let delimiter: string | null = null;
	for (const raw of command.split("\n")) {
		if (delimiter !== null) {
			if (raw.trim() === delimiter) delimiter = null;
			continue;
		}
		delimiter = HEREDOC.exec(raw)?.[2] ?? null;
		const line = raw.replace(QUOTED, "q").replace(/["']/g, "");
		for (const match of line.matchAll(REDIRECT))
			if (!(match[1] ?? "").startsWith("/dev/")) return true;
		const tee = TEE.exec(line)?.[1];
		if ((tee && !tee.startsWith("/dev/")) || IN_PLACE.test(line)) return true;
	}
	return false;
}

function shellFamily(head: string | null): ToolFamily {
	if (!head) return "execution";
	const first = head.split(" ")[0] ?? head;
	const twoWords = head.split(" ").slice(0, 2).join(" ");
	for (const candidate of [head, twoWords, first]) {
		if (DISCOVERY.has(candidate)) return "discovery";
		if (READING.has(candidate)) return "reading";
		if (WRITING.has(candidate)) return "writing";
	}
	return "execution";
}

/** The activity family of a tool call, for colour and grouping; bash is split by its command head. */
export function toolFamily(tool: string, head: string | null): ToolFamily {
	if (SHELL_TOOLS.has(tool)) return shellFamily(head);
	if (SEARCH_TOOLS.has(tool)) return "discovery";
	if (READ_TOOLS.has(tool)) return "reading";
	if (WRITE_TOOLS.has(tool)) return "writing";
	if (SUBAGENT.has(tool)) return "subagent";
	if (tool === "ask_user_question") return "ask";
	if (/^(todo_|spec_)/.test(tool)) return "planning";
	return "other";
}
