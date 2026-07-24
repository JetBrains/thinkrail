/**
 * Every string and fact the worktree game shows. Copy centralized here per the module SPEC: the game
 * asks "will this travel?" — never reuse the Changes panel's VCS colors/status semantics for it.
 */
export type DemoFileStatus = "committed" | "modified" | "untracked" | "ignored";

export interface DemoFile {
	path: string;
	status: DemoFileStatus;
	/** Neutral pill text shown in the predict phase (never a color that leaks the answer). */
	pill?: string;
}

export interface TapBeat {
	kind: "tap";
	id: "carries";
	prompt: string;
	/** Paths present in the new workspace — the correct tap set (committed content only). */
	answers: string[];
	whyline: string;
}

export interface ChoiceBeat {
	kind: "choice";
	id: "location" | "environment" | "history" | "payoff";
	prompt: string;
	choices: { id: string; label: string }[];
	correctId: string;
	/** Which reveal panel Task 8 renders for this beat. */
	reveal: "tree" | "hooks" | "history" | "payoff";
	whyline: string;
}

export type Beat = TapBeat | ChoiceBeat;

export const DEMO_PROJECT = "guitar-tuner";
export const DEMO_WORKSPACE = "fix-pitch-bug";
export const DEMO_BASE = "main";
export const WORKTREES_ROOT = "~/.thinkrail/worktrees";

export const BASE_RULE_HINT =
	"any local or origin/… branch — the workspace gets its own fresh branch cut from it";

export const DEMO_FILES: DemoFile[] = [
	{ path: "src/app.ts", status: "committed" },
	{ path: "src/tuner.ts", status: "modified", pill: "modified" },
	{ path: "README.md", status: "committed" },
	{ path: ".env", status: "untracked", pill: "untracked" },
	{ path: "notes.todo", status: "untracked", pill: "untracked" },
	{ path: "node_modules/", status: "ignored", pill: "ignored" },
];

export const GAME_BEATS: Beat[] = [
	{
		kind: "tap",
		id: "carries",
		prompt: "Tap every file you'll find inside it.",
		answers: ["src/app.ts", "src/tuner.ts", "README.md"],
		whyline:
			"A workspace starts from a commit, not from your folder — and your folder keeps everything.",
	},
	{
		kind: "choice",
		id: "location",
		prompt: `Where does ${DEMO_WORKSPACE} live?`,
		choices: [
			{ id: "inside", label: `Inside my project folder — ${DEMO_PROJECT}/${DEMO_WORKSPACE}/` },
			{ id: "own", label: "In its own folder, outside my project" },
			{ id: "replaces", label: "It replaces my project folder" },
		],
		correctId: "own",
		reveal: "tree",
		whyline: "Two folders, side by side — the original stays exactly as you left it.",
	},
	{
		kind: "choice",
		id: "environment",
		prompt: "First npm start inside the new workspace — what happens?",
		choices: [
			{ id: "runs", label: "Runs — same as in my project folder" },
			{ id: "fails", label: "Fails — dependencies & secrets are missing" },
		],
		correctId: "fails",
		reveal: "hooks",
		whyline: "Environment isn't history — it's rebuilt. Automatically, if you tell us how.",
	},
	{
		kind: "choice",
		id: "history",
		prompt:
			"You commit in the workspace. Back in your main folder — is that commit in the repo's history?",
		choices: [
			{ id: "yes", label: "Yes — one repository, shared history" },
			{ id: "no", label: "No — the workspace is its own repo" },
		],
		correctId: "yes",
		reveal: "history",
		whyline: "Workspaces share the repository — they never share uncommitted mess.",
	},
	{
		kind: "choice",
		id: "payoff",
		prompt: "Your main folder is mid-mess; an urgent fix is needed. What do you do?",
		choices: [
			{ id: "stash", label: "Stash or commit the mess first" },
			{ id: "workspace", label: "Just create another workspace" },
		],
		correctId: "workspace",
		reveal: "payoff",
		whyline: "Every task gets a clean, parallel, disposable folder.",
	},
];

export const RECAP: string[] = [
	"A workspace = a fresh branch cut from a base you pick (any local or remote branch) — uncommitted & untracked files stay in your folder",
	`Default workspace = your project folder; created workspaces = fresh parallel folders under ${WORKTREES_ROOT}`,
	"Environment is rebuilt, not copied — setup hooks automate it, cleanup hooks tidy up",
];

/** Warm, never shaming. The near-universal miss is the environment beat (#3). */
export function scoreLine(score: number): string {
	if (score >= 5) return "5 / 5 — you already think in worktrees";
	if (score >= 4) return `${score} / 5 — most git veterans miss #3`;
	return `${score} / 5 — almost everyone expects this to work differently`;
}
