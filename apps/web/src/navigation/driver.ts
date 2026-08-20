export interface NavigationDriver {
	read(): string;
	replace(fragment: string): void;
	onIncoming(handler: (fragment: string) => void): () => void;
}

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
