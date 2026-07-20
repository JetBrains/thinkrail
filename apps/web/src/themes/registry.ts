import type { ThemeId } from "@thinkrail/contracts";
import {
	assertThemeManifest,
	type ThemeAppearance,
	type ThemeContrast,
	type ThemeManifest,
} from "./schema";

export interface ThemeDescriptor {
	readonly id: ThemeId;
	readonly label: string;
	readonly order: number;
	readonly appearance: ThemeAppearance;
	readonly contrast: ThemeContrast;
}

export interface ThemeRegistration {
	readonly theme: ThemeManifest;
	dispose(): void;
}

type Listener = () => void;

function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function descriptor(theme: ThemeManifest): ThemeDescriptor {
	return Object.freeze({
		id: theme.id,
		label: theme.label,
		order: theme.order,
		appearance: theme.appearance,
		contrast: theme.contrast,
	});
}

/** Pure catalog/validation core; DOM application lives in runtime.ts. */
export class ThemeRegistry {
	readonly #defaultId: ThemeId;
	readonly #themes = new Map<ThemeId, ThemeManifest>();
	readonly #listeners = new Set<Listener>();
	#snapshot: readonly ThemeDescriptor[] = Object.freeze([]);

	constructor(defaultId: ThemeId) {
		this.#defaultId = defaultId;
	}

	register(input: unknown): ThemeRegistration {
		const theme = assertThemeManifest(input);
		if (this.#themes.has(theme.id)) throw new Error(`Theme id is already registered: ${theme.id}`);
		this.#themes.set(theme.id, theme);
		this.#rebuildSnapshot();

		let disposed = false;
		return {
			theme,
			dispose: () => {
				if (disposed) return;
				disposed = true;
				if (this.#themes.get(theme.id) !== theme) return;
				this.#themes.delete(theme.id);
				this.#rebuildSnapshot();
			},
		};
	}

	has(id: ThemeId): boolean {
		return this.#themes.has(id);
	}

	get(id: ThemeId): ThemeManifest | undefined {
		return this.#themes.get(id);
	}

	resolve(id: ThemeId): ThemeManifest | undefined {
		return this.#themes.get(id) ?? this.#themes.get(this.#defaultId);
	}

	getSnapshot(): readonly ThemeDescriptor[] {
		return this.#snapshot;
	}

	resolveDescriptor(id: ThemeId): ThemeDescriptor | undefined {
		const resolved = this.resolve(id);
		return resolved ? descriptor(resolved) : undefined;
	}

	subscribe(listener: Listener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#rebuildSnapshot(): void {
		this.#snapshot = Object.freeze(
			[...this.#themes.values()]
				.sort((a, b) => {
					if (a.id === this.#defaultId) return -1;
					if (b.id === this.#defaultId) return 1;
					return a.order - b.order || compareText(a.label, b.label) || compareText(a.id, b.id);
				})
				.map(descriptor),
		);
		for (const listener of this.#listeners) listener();
	}
}
