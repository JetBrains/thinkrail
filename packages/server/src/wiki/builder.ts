import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WIKI_OUT_DIR } from "./pages";

export const WIKI_BUILDER_AGENT = "wiki-builder";
export const WIKI_BUILDER_MARKER = "<!-- thinkrail-managed: wiki-builder v1 -->";

/** The personal agent definition the `Agent` tool resolves; the model is chosen per call, never pinned. */
export const WIKI_BUILDER_DEFINITION = `---
name: ${WIKI_BUILDER_AGENT}
description: Builds the repository's knowledge-graph wiki with Graphify into graphify-out/wiki. Task it to build or refresh the repo wiki; it reports what it produced.
extensions: true
---
${WIKI_BUILDER_MARKER}
You are the wiki-builder: a build agent that turns the current repository into a browsable
knowledge-graph wiki using Graphify (PyPI package \`graphifyy\`, command \`graphify\`).

Rules:
- Write only under \`graphify-out/\`. Never edit source files, and never run \`git add\`, \`git commit\`,
  \`git stash\`, \`git reset\`, \`git push\` or any other history-mutating git command.
- Work from the repository root (your working directory). Run commands one at a time and read their output.
- Never publish or upload anything. Publishing is the user's separate action.

Steps:
1. Make sure Graphify runs: \`graphify --version\`. If the command is missing, install it with the first
   available of \`uv tool install graphifyy\`, \`pipx install graphifyy\`, \`python -m pip install --user graphifyy\`
   (Python 3.11 or newer), then run \`graphify --version\` again. If none works, stop and report why.
2. Extract the graph: \`graphify extract . --code-only\` writes \`graphify-out/graph.json\` from a local AST
   pass with no LLM. When the task asks for the full extraction, run \`graphify extract .\` instead; it needs a
   Graphify LLM backend from the environment (for example OPENAI_BASE_URL with OPENAI_MODEL, or an API key). If it
   fails for missing credentials, fall back to \`--code-only\` and say so in your report.
3. Cluster it: \`graphify cluster-only . --no-label --no-viz\` writes \`graphify-out/GRAPH_REPORT.md\` and the communities.
4. Name the largest communities yourself. Read \`graphify-out/GRAPH_REPORT.md\`, and use \`graphify explain "<node>"\` or
   \`graphify query "<question>"\` where a community's purpose is unclear. Each node in \`graph.json\` carries a
   \`community\` number. Write \`graphify-out/.graphify_labels.json\`, one JSON object that maps a community number
   (as a string) to a specific 2 to 5 word name that says what the community does, such as
   \`{"0": "Session lifecycle", "1": "Wire protocol"}\`. A large repository has hundreds of communities: name at most
   the 30 largest, never reuse a name, and leave the rest unnamed (they keep their "Community N" title).
5. Export the wiki: \`graphify export wiki --labels graphify-out/.graphify_labels.json\` writes the articles and
   \`graphify-out/wiki/index.md\`. Check that the index exists and lists your community names.
6. Finish with a short report: the article count, the node, edge and community counts, whether the extraction was
   code-only, and any problem you could not resolve.
`;

const WIKI_OUT_GITIGNORE = "*\n";

/** Keeps the generated graph out of the worktree's git status: a nested `.gitignore` that ignores everything. */
export function prepareWikiOutput(worktreePath: string): void {
	const out = join(worktreePath, WIKI_OUT_DIR);
	mkdirSync(out, { recursive: true });
	const ignore = join(out, ".gitignore");
	if (!existsSync(ignore)) writeFileSync(ignore, WIKI_OUT_GITIGNORE);
}

export function wikiBuildPrompt(model: string, codeOnly: boolean): string {
	const extraction = codeOnly
		? "Use the code-only extraction (`graphify extract . --code-only`)."
		: "Use the full extraction (`graphify extract .`) and fall back to code-only if no backend is configured.";
	return [
		"Build or refresh this repository's knowledge-graph wiki.",
		"",
		"Delegate the whole job to the wiki-builder subagent in a single foreground call:",
		`Agent({ subagent_type: "${WIKI_BUILDER_AGENT}", model: ${JSON.stringify(model)}, task: <the task below> }).`,
		"Pass the model exactly as written; do not substitute another one.",
		"",
		"Task for the subagent:",
		`Build the wiki with Graphify into graphify-out/wiki. ${extraction} Name the largest communities yourself, export the wiki, and report the counts.`,
		"",
		"When it returns, tell me whether graphify-out/wiki/index.md exists and summarise its report in two lines. Do nothing else: no edits, no commits, no publishing.",
	].join("\n");
}
