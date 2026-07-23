/**
 * Frontmatter split/assemble for prompt-template files — the client-side mirror of pi's own
 * `stripFrontmatter`/`parseFrontmatter` (`@earendil-works/pi-coding-agent`'s `dist/utils/frontmatter.js`,
 * pinned against pi v0.80.6 — the same pin `packages/server/src/templates/SPEC.md` uses for the server
 * side; re-verify both on a pi version bump). pi's real parser is server-only (real YAML via the `yaml`
 * package, `node:fs`) and never reaches the browser bundle, so this file is a small, hand-rolled mirror —
 * not a general YAML parser, since our own frontmatter only ever has two possible keys (`description`,
 * `argument-hint`), each written on its own single line, `JSON.stringify`-quoted by {@link assembleTemplate}.
 *
 * The rule that matters, ported byte-for-byte from pi's `extractFrontmatter`: content must start with the
 * literal `---`; the frontmatter block ends at the FIRST later `\n---` line (never one embedded inside a
 * value — our values can't contain a raw newline, since they're single-line JSON-quoted); the body is
 * everything after that closing fence's own `---`, run through `String.prototype.trim()` — every
 * leading/trailing blank line and space, not just one `\n`. No closing fence anywhere → the WHOLE content
 * is body, completely untouched (not even trimmed) — pi treats a dangling `---` opener with no closer as
 * plain content, not a parse error.
 *
 * `ChatView.tsx` (composer pick) and `TemplateEditorDialog.tsx` (settings edit / save-as-template) both
 * import this one module rather than keeping their own splitter. A prior version had two independently
 * hand-rolled regex splitters (one per file), each consuming only a single *optional* `\n` after the
 * closing fence instead of trimming — a leading blank line leaked into the body on every pick and every
 * edit-reopen, and *compounded* by one more `\n` per edit-save cycle (the leaked line got saved back into
 * the body field and re-wrapped the next save). `templateText.test.ts` pins the round-trip properties this
 * fix depends on.
 */

/** CRLF/CR → LF, exactly like pi's own `normalizeNewlines` — a file saved on one platform round-trips the
 * same everywhere. */
function normalizeNewlines(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Locates the frontmatter block's boundary exactly the way pi's own `extractFrontmatter` does.
 * `yamlString` is `null` when there's no frontmatter block at all (content doesn't start with `---`, or a
 * `---` opener never finds a closing `\n---`) — in that case `body` is the untouched (only
 * newline-normalized) content. `yamlString` is `""` (falsy, but not `null`) for a block that's present but
 * empty (`---\n---\n...`) — `body` is still correctly boundary-found and trimmed in that case, same as a
 * non-empty block.
 */
function extractFrontmatterBlock(content: string): { yamlString: string | null; body: string } {
	const normalized = normalizeNewlines(content);
	if (!normalized.startsWith("---")) return { yamlString: null, body: normalized };
	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) return { yamlString: null, body: normalized };
	return { yamlString: normalized.slice(4, endIndex), body: normalized.slice(endIndex + 4).trim() };
}

/**
 * Best-effort single-line scalar read for a `key: value` frontmatter line. Handles exactly the two shapes
 * {@link assembleTemplate} ever writes — a bare scalar (also what a hand-authored file like the seed
 * fixture's `description: Review a file for issues` uses), or one `JSON.stringify`-quoted by this module —
 * not general YAML.
 */
function readFrontmatterKey(block: string, key: string): string {
	const line = block.split("\n").find((l) => l.startsWith(`${key}:`));
	if (!line) return "";
	const raw = line.slice(key.length + 1).trim();
	if (raw.startsWith('"') && raw.endsWith('"')) {
		try {
			return JSON.parse(raw) as string;
		} catch {
			return raw;
		}
	}
	return raw;
}

/** The body pi's own loader would hand to `expandPromptTemplate` — used by `ChatView.tsx`'s composer-pick
 * path (never a frontmatter *value*; those come from `TemplateInfo.description`/`argumentHint`, already
 * parsed server-side). */
export function stripFrontmatter(content: string): string {
	return extractFrontmatterBlock(content).body;
}

/** Splits a template file's leading frontmatter block from its body. Used by `TemplateEditorDialog.tsx`,
 * which (unlike `stripFrontmatter` above) also needs the two field values to populate its form. */
export function splitTemplate(content: string): {
	description: string;
	argumentHint: string;
	body: string;
} {
	const { yamlString, body } = extractFrontmatterBlock(content);
	if (!yamlString) return { description: "", argumentHint: "", body };
	return {
		description: readFrontmatterKey(yamlString, "description"),
		argumentHint: readFrontmatterKey(yamlString, "argument-hint"),
		body,
	};
}

/**
 * Assembles a template file's full text from form fields — the inverse of {@link splitTemplate}. Omits
 * either frontmatter key when its field is empty, and omits the frontmatter block entirely when both are
 * empty *and* `body` doesn't start with `---` (see below). Each present value is `JSON.stringify`-quoted:
 * YAML's double-quoted scalar escape set is a superset of JSON's, so this is always valid YAML without a
 * `yaml` package dependency (see the seed fixture's own quoted `argument-hint: "[file] [scope]"`).
 *
 * **The `---`-body case**: a body that itself starts with `---`, saved with no frontmatter keys, would be
 * written bare — and pi's own loader (and this module's `extractFrontmatterBlock`) would then go hunting
 * for a *later* `\n---` line inside that body to treat as a closing fence, silently swallowing real body
 * content as if it were YAML the moment the body ever contains (now, or after some future edit) a second
 * line that looks like a fence. Emitting an explicit block — even an empty one, `---\n---\n\n` —
 * sidesteps this unconditionally: the boundary search always finds *this* fence first, since it's the
 * earliest possible `\n---` in the file (our own values can't contain a raw newline), so the body's own
 * `---`-looking lines are never reinterpreted, no matter what they say or how many of them there are.
 */
export function assembleTemplate(description: string, argumentHint: string, body: string): string {
	const lines: string[] = [];
	const d = description.trim();
	const a = argumentHint.trim();
	if (d) lines.push(`description: ${JSON.stringify(d)}`);
	if (a) lines.push(`argument-hint: ${JSON.stringify(a)}`);
	if (lines.length === 0) {
		return body.startsWith("---") ? `---\n---\n\n${body}` : body;
	}
	return `---\n${lines.join("\n")}\n---\n\n${body}`;
}
