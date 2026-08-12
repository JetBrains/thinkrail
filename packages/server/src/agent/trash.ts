import trash from "trash";

export type TrashImplementation = (
	input: string | readonly string[],
	options?: { readonly glob?: boolean },
) => Promise<void>;

/** Move one literal path to the OS trash. Failures propagate; a recoverable action never falls back to unlink. */
export async function trashFile(
	path: string,
	implementation: TrashImplementation = trash,
): Promise<void> {
	await implementation(path, { glob: false });
}
