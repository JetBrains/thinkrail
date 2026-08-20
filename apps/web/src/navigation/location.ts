/**
 * The client-local, backend-relative location — one serializable route for main/Welcome, Project Home, a
 * workspace, or an exact chat — and its versioned URL-fragment codec. The route carries backend ids only:
 * same-origin web gets backend identity from its origin, native shells pair it with a backend profile, and
 * no credential or transport secret ever belongs in it.
 */
export type NavigationLocation =
	| { kind: "main" }
	| { kind: "project"; projectId: string }
	| { kind: "workspace"; projectId: string; workspaceId: string }
	| { kind: "chat"; projectId: string; workspaceId: string; sessionId: string };

/** The canonical main/Welcome route (also what every invalid fragment canonicalizes to). */
export const MAIN_LOCATION: NavigationLocation = { kind: "main" };

/** One id as one encoded path segment. */
function encodeSegment(id: string): string {
	return encodeURIComponent(id);
}

/** Decode one path segment; `null` for an empty id or malformed percent-encoding. */
function decodeSegment(segment: string | undefined): string | null {
	if (!segment) return null;
	try {
		const decoded = decodeURIComponent(segment);
		return decoded === "" ? null : decoded;
	} catch {
		return null;
	}
}

/** Serialize a location to its canonical `#/v1/…` fragment (leading `#` included). */
export function serializeLocation(location: NavigationLocation): string {
	switch (location.kind) {
		case "main":
			return "#/v1";
		case "project":
			return `#/v1/projects/${encodeSegment(location.projectId)}`;
		case "workspace":
			return `#/v1/projects/${encodeSegment(location.projectId)}/workspaces/${encodeSegment(location.workspaceId)}`;
		case "chat":
			return `#/v1/projects/${encodeSegment(location.projectId)}/workspaces/${encodeSegment(location.workspaceId)}/chats/${encodeSegment(location.sessionId)}`;
	}
}

/**
 * Parse a URL fragment (with or without its leading `#`) into a location. Strict: an unknown version, a
 * wrong collection name, an empty id, malformed encoding, or extra/missing segments all canonicalize
 * safely to {@link MAIN_LOCATION} — an incoming fragment is intent, and unintelligible intent must land
 * the user on Welcome rather than throw or half-parse.
 */
export function parseFragment(fragment: string): NavigationLocation {
	const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
	if (raw === "" || raw === "/v1") return MAIN_LOCATION;
	const segments = raw.split("/");
	// A canonical fragment starts with "/", so segment 0 is the empty string before it.
	if (segments[0] !== "" || segments[1] !== "v1") return MAIN_LOCATION;
	if (segments[2] !== "projects") return MAIN_LOCATION;
	const projectId = decodeSegment(segments[3]);
	if (!projectId) return MAIN_LOCATION;
	if (segments.length === 4) return { kind: "project", projectId };
	if (segments[4] !== "workspaces") return MAIN_LOCATION;
	const workspaceId = decodeSegment(segments[5]);
	if (!workspaceId) return MAIN_LOCATION;
	if (segments.length === 6) return { kind: "workspace", projectId, workspaceId };
	if (segments[6] !== "chats" || segments.length !== 8) return MAIN_LOCATION;
	const sessionId = decodeSegment(segments[7]);
	if (!sessionId) return MAIN_LOCATION;
	return { kind: "chat", projectId, workspaceId, sessionId };
}
