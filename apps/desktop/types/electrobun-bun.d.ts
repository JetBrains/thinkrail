import type { Pointer } from "bun:ffi";

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
	webview: {
		requests: Record<string, unknown>;
		messages: Record<string, unknown>;
	};
};

type BunMessageHandlers<T extends RpcShape> = {
	[K in keyof T["bun"]["messages"]]: (payload: T["bun"]["messages"][K]) => void;
};

type MessageSenders<T extends Record<string, unknown>> = {
	[K in keyof T]: (payload: T[K]) => void;
};

interface DefinedRpc<T extends RpcShape> {
	readonly send: MessageSenders<T["webview"]["messages"]>;
}

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
	}): DefinedRpc<T>;
};

export class BrowserWindow {
	readonly id: number;
	readonly ptr: Pointer;
	readonly webview: Webview;
	constructor(options: {
		title: string;
		url: string;
		preload: string | null;
		rpc?: unknown;
		hidden: boolean;
		navigationRules: string | null;
		titleBarStyle: "default" | "hidden" | "hiddenInset";
		trafficLightOffset?: { x: number; y: number };
		frame: { x: number; y: number; width: number; height: number };
	});
	show(): void;
	minimize(): void;
	unminimize(): void;
	isMinimized(): boolean;
	maximize(): void;
	unmaximize(): void;
	isMaximized(): boolean;
	requestClose(): void;
	on(name: "resize", handler: (event: ElectrobunEvent<unknown>) => void): void;
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
