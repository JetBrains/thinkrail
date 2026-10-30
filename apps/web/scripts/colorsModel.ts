export const paletteVar = (key: string) =>
	`--${key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;

export interface Role {
	readonly from: string;
	readonly alpha?: string;
	readonly fallback?: string;
	readonly publish: boolean;
	readonly note?: string;
}

export interface Effect {
	readonly dark: string;
	readonly light: string;
	readonly publish: boolean;
	readonly note?: string;
}

export interface Colors {
	readonly metadata: { readonly version: string; readonly note?: string };
	readonly scale: Readonly<Record<string, number>>;
	readonly roles: Readonly<Record<string, Role>>;
	readonly effects: Readonly<Record<string, Effect>>;
}
