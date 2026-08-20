/**
 * The seam between the navigation coordinator and wherever a client keeps its location. The browser
 * driver below reads/writes `location.hash`; a later Electrobun/mobile adapter persists the same
 * backend-relative fragment per backend profile and window/device without touching store or transport.
 */
export interface NavigationDriver {
	/** The current serialized fragment (leading `#` included; `""` when the URL carries none). */
	read(): string;
	/** Replace the current fragment in place — never a new history entry (`history.replaceState`). */
	replace(fragment: string): void;
	/**
	 * Subscribe to fragment changes arriving from OUTSIDE the app — the user editing the address bar or
	 * following a shared link in place. Our own `replace` writes never fire it (`history.replaceState`
	 * dispatches no `hashchange`), which is what keeps the store→URL sync loop-free.
	 */
	onIncoming(handler: (fragment: string) => void): () => void;
}

/** The V1 browser driver: `location.hash` + `history.replaceState` + `hashchange`. */
export function browserNavigationDriver(): NavigationDriver {
	return {
		read: () => window.location.hash,
		replace: (fragment) => {
			history.replaceState(history.state, "", fragment);
		},
		onIncoming: (handler) => {
			const listener = () => handler(window.location.hash);
			window.addEventListener("hashchange", listener);
			return () => window.removeEventListener("hashchange", listener);
		},
	};
}
