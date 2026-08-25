export function isSafeRef(ref: string): boolean {
	if (ref.length === 0) return false;
	if (ref.startsWith("-")) return false; // an option-shaped ref (`--output=…`) is the whole attack
	if (ref.includes("..")) return false; // range/traversal syntax, never a name we were handed
	if (ref.includes("@{")) return false; // reflog/upstream syntax (`main@{yesterday}`, `@{u}`)
	if (ref === "@") return false; // git's own shorthand for HEAD, not a ref name
	if (ref.endsWith(".") || ref.endsWith("/")) return false;
	for (const char of ref) {
		const code = char.codePointAt(0) ?? 0;
		if (code <= 0x20 || code === 0x7f) return false;
		if (REF_METACHARS.includes(char)) return false;
	}
	for (const component of ref.split("/")) {
		if (component.length === 0) return false;
		if (component.startsWith(".")) return false;
		if (component.endsWith(".lock")) return false;
	}
	return true;
}

const REF_METACHARS = ["~", "^", ":", "?", "*", "[", "\\"];

export function assertSafeRef(ref: string): void {
	if (!isSafeRef(ref)) throw new Error(`Not a usable git ref: ${ref}`);
}

export function remoteTrackingRef(ref: string): string | null {
	return ref.startsWith("origin/") ? `refs/remotes/${ref}` : null;
}
