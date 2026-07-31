/**
 * A ref name we are willing to hand to git as an argument. The threat is **not** a privileged client (one
 * that can call `workspace.setDiffBase` can already open a terminal) — it is an **untrusted repository**:
 * `git update-ref 'refs/heads/--output=x' HEAD` succeeds (only the `git branch` porcelain refuses such a
 * name), `listBranches` reads refs with `for-each-ref`, so an option-shaped branch from somebody else's
 * repo shows up in the BranchPicker and an ordinary user can select it. Opening someone's repo and
 * browsing its changes is literally this product's job, so every ref that can reach a git argument is
 * validated at its **mutation** door (`createWorkspace`'s base, `setWorkspaceDiffBase`'s target), and the
 * read sites additionally pass `--end-of-options` so a ref can never be re-parsed as a flag.
 *
 * The rule set is `git check-ref-format`'s, reproduced in-process (no spawn on a validation path): a
 * name git itself refuses is never a name we accept — that includes the **revision-syntax** forms
 * (`~ ^ : ? * [ \`, `..`, `@{`, a bare `@`), the structural ones (an empty path component, a component
 * starting with `.`, a `.lock` suffix, a trailing `.`), and control characters/space.
 *
 * Deliberately shape-only — never an existence check: a ref that was valid when it was chosen and has
 * since been deleted must still *degrade* (an empty diff), not be rejected as malformed. And deliberately
 * **no length rule** beyond non-empty: `check-ref-format` has none, so a long hierarchical name git accepts
 * (and hands back through `for-each-ref`) must be selectable too — rejecting it here would wedge the picker
 * on a branch the repo really has. Length is not a safety property anyway (every attack shape above is a
 * character or structure rule), and the real limits — the filesystem's per-component cap, `execve`'s argv
 * size — are enforced where they exist, failing loudly as a read error rather than silently as "malformed".
 */
export function isSafeRef(ref: string): boolean {
	if (ref.length === 0) return false;
	if (ref.startsWith("-")) return false; // an option-shaped ref (`--output=…`) is the whole attack
	if (ref.includes("..")) return false; // range/traversal syntax, never a name we were handed
	if (ref.includes("@{")) return false; // reflog/upstream syntax (`main@{yesterday}`, `@{u}`)
	if (ref === "@") return false; // git's own shorthand for HEAD, not a ref name
	if (ref.endsWith(".") || ref.endsWith("/")) return false;
	for (const char of ref) {
		const code = char.codePointAt(0) ?? 0;
		// Control chars and space (git refs forbid both) plus git's own revision metacharacters — a name
		// carrying them is either malformed or trying to mean more than a ref.
		if (code <= 0x20 || code === 0x7f) return false;
		if (REF_METACHARS.includes(char)) return false;
	}
	// Per-component rules: no empty component (`a//b`, `/a`), none starting with `.` (`a/.b`), none ending
	// in `.lock` — all three are names `git check-ref-format` refuses.
	for (const component of ref.split("/")) {
		if (component.length === 0) return false;
		if (component.startsWith(".")) return false;
		if (component.endsWith(".lock")) return false;
	}
	return true;
}

/** Revision-syntax characters `git check-ref-format` also refuses inside a ref name. */
const REF_METACHARS = ["~", "^", ":", "?", "*", "[", "\\"];

/** {@link isSafeRef} as a guard: the one message both mutation doors reject a crafted ref with. */
export function assertSafeRef(ref: string): void {
	if (!isSafeRef(ref)) throw new Error(`Not a usable git ref: ${ref}`);
}
