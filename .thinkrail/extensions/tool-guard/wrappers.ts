import { basename } from "node:path";

interface Wrapper {
	values: string;
	long?: readonly string[];
	chdir?: readonly string[];
	split?: readonly string[];
	operands?: number;
}

const WRAPPERS = new Map<string, Wrapper>([
	[
		"sudo",
		{
			values: "ughpCDrtUT",
			long: [
				"--user",
				"--group",
				"--host",
				"--prompt",
				"--close-from",
				"--chdir",
				"--role",
				"--type",
				"--other-user",
				"--command-timeout",
			],
			chdir: ["-D", "--chdir"],
		},
	],
	["doas", { values: "uC" }],
	[
		"env",
		{
			values: "uCS",
			long: ["--unset", "--chdir", "--split-string"],
			chdir: ["-C", "--chdir"],
			split: ["-S", "--split-string"],
		},
	],
	["command", { values: "" }],
	["builtin", { values: "" }],
	["exec", { values: "a" }],
	["nohup", { values: "" }],
	["time", { values: "fo", long: ["--format", "--output"] }],
	["nice", { values: "n", long: ["--adjustment"] }],
	["timeout", { values: "sk", long: ["--signal", "--kill-after"], operands: 1 }],
	["stdbuf", { values: "ioe", long: ["--input", "--output", "--error"] }],
	["ionice", { values: "cnpPu", long: ["--class", "--classdata", "--pid", "--pgid", "--uid"] }],
]);

const KEYWORDS = new Set(["{", "!", "if", "then", "else", "elif", "while", "until", "do"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const skipOptions = (words: readonly string[], wrapper: Wrapper) => {
	const chdir: string[] = [];
	let split: string | undefined;
	const take = (option: string, value: string | undefined) => {
		if (value === undefined) return;
		if (wrapper.chdir?.includes(option)) chdir.push(value);
		if (wrapper.split?.includes(option)) split = value;
	};
	let i = 0;
	while (i < words.length) {
		const word = words[i] ?? "";
		if (word === "--") {
			i++;
			break;
		}
		if (!word.startsWith("-")) break;
		i++;
		if (word.startsWith("--")) {
			const eq = word.indexOf("=");
			if (eq > 0) take(word.slice(0, eq), word.slice(eq + 1));
			else if (wrapper.long?.includes(word)) take(word, words[i++]);
			continue;
		}
		for (let k = 1; k < word.length; k++) {
			const flag = word.charAt(k);
			if (!wrapper.values.includes(flag)) continue;
			const attached = word.slice(k + 1);
			take(`-${flag}`, attached || words[i++]);
			break;
		}
	}
	return { next: i + (wrapper.operands ?? 0), chdir, split };
};

export const stripWrappers = (words: readonly string[]) => {
	let rest = [...words];
	const chdir: string[] = [];
	while (rest.length > 0) {
		const word = rest[0] ?? "";
		const wrapper = WRAPPERS.get(basename(word));
		if (ASSIGNMENT.test(word) || KEYWORDS.has(word)) rest = rest.slice(1);
		else if (wrapper) {
			const skipped = skipOptions(rest.slice(1), wrapper);
			chdir.push(...skipped.chdir);
			const spliced = skipped.split?.split(/\s+/).filter(Boolean) ?? [];
			rest = [...spliced, ...rest.slice(1 + skipped.next)];
		} else break;
	}
	return { argv: rest, chdir };
};
