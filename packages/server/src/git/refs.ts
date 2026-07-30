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
 * Deliberately shape-only — never an existence check: a ref that was valid when it was chosen and has
 * since been deleted must still *degrade* (an empty diff), not be rejected as malformed.
 */
export function isSafeRef(ref: string): boolean {
	if (ref.length === 0 || ref.length > 255) return false;
	if (ref.startsWith("-")) return false; // an option-shaped ref (`--output=…`) is the whole attack
	if (ref.includes("..")) return false; // range/traversal syntax, never a name we were handed
	for (const char of ref) {
		const code = char.codePointAt(0) ?? 0;
		// Control chars and space (git refs forbid both) plus git's own revision metacharacters — a name
		// carrying them is either malformed or trying to mean more than a ref.
		if (code <= 0x20 || code === 0x7f) return false;
		if (REF_METACHARS.includes(char)) return false;
	}
	return true;
}

/** Revision-syntax characters `git check-ref-format` also refuses inside a ref name. */
const REF_METACHARS = ["~", "^", ":", "?", "*", "[", "\\"];

/** {@link isSafeRef} as a guard: the one message both mutation doors reject a crafted ref with. */
export function assertSafeRef(ref: string): void {
	if (!isSafeRef(ref)) throw new Error(`Not a usable git ref: ${ref}`);
}
