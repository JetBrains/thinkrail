interface ElectrobunEvent<T> {
	data: T;
	response?: { allow: boolean };
}

interface WebviewEventData {
	detail: unknown;
}

interface Webview {
	on(name: "dom-ready", handler: (event: ElectrobunEvent<WebviewEventData>) => void): void;
	on(
		name: "will-navigate" | "new-window-open",
		handler: (event: ElectrobunEvent<WebviewEventData>) => void,
	): void;
}

type RpcShape = {
	bun: {
		requests: Record<string, unknown>;
		messages: Record<string, unknown>;
	};
};

type BunMessageHandlers<T extends RpcShape> = {
	[K in keyof T["bun"]["messages"]]: (payload: T["bun"]["messages"][K]) => void;
};

export type ApplicationMenuItemConfig =
	| { type: "divider" | "separator" }
	| {
			type?: "normal";
			label?: string;
			role?: string;
			submenu?: ApplicationMenuItemConfig[];
	  };

export const ApplicationMenu: {
	setApplicationMenu(menu: ApplicationMenuItemConfig[]): void;
};

export const BrowserView: {
	defineRPC<T extends RpcShape>(definition: {
		maxRequestTime: number;
		handlers: {
			requests: Record<string, never>;
			messages: BunMessageHandlers<T>;
		};
	}): unknown;
};

export class BrowserWindow {
	readonly id: number;
	readonly webview: Webview;
	constructor(options: {
		title: string;
		url: string;
		preload: string | null;
		rpc?: unknown;
		hidden: boolean;
		navigationRules: string | null;
		frame: { x: number; y: number; width: number; height: number };
	});
}

export const PATHS: {
	readonly RESOURCES_FOLDER: string;
	readonly VIEWS_FOLDER: string;
};

export const Utils: {
	readonly paths: { readonly userData: string };
	openExternal(url: string): boolean;
	quit(): void;
	showMessageBox(options: {
		type: "error";
		title: string;
		message: string;
		detail: string;
		buttons: string[];
	}): Promise<{ response: number }>;
};

declare const Electrobun: {
	events: {
		on(name: "before-quit", handler: (event: ElectrobunEvent<Record<string, never>>) => void): void;
	};
};

export default Electrobun;
