/**
 * Every narrative string and fact the worktree game shows (generic control chrome — Reveal/Next/Skip —
 * stays in components). Copy centralized here per the module SPEC: the game asks "will this travel?" —
 * never reuse the Changes panel's VCS colors/status semantics for it.
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

/** The "You create workspace <ws> [from <base>]. <prompt>" sentence scaffold every beat opens with. */
export const PROMPT_FRAME = {
	subject: "You create workspace",
	base: "from",
	glue: ".",
};

/**
 * Beat 1's two-folder board (`FoldersBoard.tsx`): header lines for each folder in each phase, and the
 * fate tags stamped on individual files during reveal. Never a color-only signal (see module SPEC).
 */
export const BOARD_COPY = {
	projectHeader(phase: "predict" | "reveal"): string {
		return phase === "reveal"
			? `~/projects/${DEMO_PROJECT} — untouched: all six files still here`
			: `~/projects/${DEMO_PROJECT} — your project folder`;
	},
	workspaceHeader(phase: "predict" | "reveal"): string {
		return phase === "predict"
			? `${WORKTREES_ROOT}/${DEMO_PROJECT}/${DEMO_WORKSPACE}`
			: `${DEMO_WORKSPACE} — a fresh branch, cut from ${DEMO_BASE} at its last commit`;
	},
	/** Gold tag on untracked/ignored files left behind in the project folder. */
	staysHereTag: "stays here",
	/** Gold tag on the modified file's copy — it travels at its last commit, not its working-tree edit. */
	staleCommitTag: "at its last commit — without your edit",
};

/**
 * The reveal prose for beats 2–5 (`reveals.tsx`), keyed by `ChoiceBeat["reveal"]`. Multi-part beats
 * (hooks/history) are split into the segments the JSX wraps in styled `<span>`s (bold/mono), so the
 * component can compose them without owning any copy itself. `satisfies Record<...>` keeps this
 * exhaustive over every reveal kind at compile time.
 */
export const REVEAL_COPY = {
	tree: {
		projectAnnotation: "your project — untouched",
		workspaceAnnotation: "◀ your new workspace",
	},
	hooks: {
		errorLine: "Error: Cannot find module — node_modules/ and .env never travel",
		leadIn: "That's why ThinkRail has ",
		setupHooksLabel: "setup hooks",
		afterLabel: " — declare ",
		npmInstall: "npm install",
		copyGlue: " + copy ",
		envFile: ".env",
		tail: " once; they run on every new workspace.",
	},
	history: {
		lead: "Yes — one shared ",
		gitLabel: ".git",
		tail: ": branches and commits are visible everywhere; only working files are separate.",
	},
	payoff:
		"Another workspace: your mess stays exactly as-is, the fix ships in parallel, and the workspace is deleted after merge.",
} satisfies Record<ChoiceBeat["reveal"], unknown>;
