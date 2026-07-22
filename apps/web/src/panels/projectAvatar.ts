// Placeholder project-avatar palette: the app's existing color tokens (no raw hex / new tokens). A
// stable hash of the project id picks one, so a project always shows the same color — shared by the
// left-panel project rows and the read-only project view.
const PROJECT_AVATAR_COLORS = ["bg-primary", "bg-blue", "bg-green", "bg-gold", "bg-red"];

export function projectAvatarColor(seed: string): string {
	let hash = 0;
	for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return PROJECT_AVATAR_COLORS[hash % PROJECT_AVATAR_COLORS.length] ?? "bg-primary";
}
