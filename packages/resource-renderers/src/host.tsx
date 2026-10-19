import type { ComponentProps, ComponentType } from "react";
import { createContext, use, useContext } from "react";
import type ReactMarkdown from "react-markdown";
import type { LanguageRegistration, ThemeRegistration } from "shiki/core";

type ReactMarkdownProps = ComponentProps<typeof ReactMarkdown>;

export type MarkdownRehypePlugins = ReactMarkdownProps["rehypePlugins"];

export interface ResourceMarkdownProps {
	text: string;
	className?: string;
	remarkPlugins?: ReactMarkdownProps["remarkPlugins"];
	rehypePlugins?: MarkdownRehypePlugins;
	urlTransform?: ReactMarkdownProps["urlTransform"];
	components?: ReactMarkdownProps["components"];
}

export type ResourceMarkdown = ComponentType<ResourceMarkdownProps>;

export interface ResourceCodeLanguage {
	id: string;
	extensions: readonly string[];
	aliases: readonly string[];
	filenames?: readonly string[];
	load: () => Promise<{ default: LanguageRegistration[] }>;
}

export interface ResourceCodeHost {
	languages: readonly ResourceCodeLanguage[];
	languageId(value: string): string | null;
	theme(options: {
		name: string;
		type: "light" | "dark";
		readVariable: (name: string) => string;
	}): ThemeRegistration;
}

export interface ResourceHost {
	loadMarkdown(): Promise<ResourceMarkdown>;
	loadCode(): Promise<ResourceCodeHost>;
	bytesUrl(workspaceId: string, path: string, oid?: string | null): string;
	openFile(workspaceId: string, path: string): void;
	fileLineWidth: number;
	fileLineWidthBounded: boolean;
}

const ResourceHostContext = createContext<ResourceHost | null>(null);

export const ResourceHostProvider = ResourceHostContext.Provider;

export function useResourceHost(): ResourceHost {
	const host = useContext(ResourceHostContext);
	if (!host) throw new Error("Resource renderers need a ResourceHostProvider");
	return host;
}

const loaded = new WeakMap<() => Promise<unknown>, Promise<unknown>>();

function once<T>(load: () => Promise<T>): Promise<T> {
	let pending = loaded.get(load) as Promise<T> | undefined;
	if (!pending) {
		pending = load();
		loaded.set(load, pending);
	}
	return pending;
}

export function useResourceCode(): ResourceCodeHost {
	return use(once(useResourceHost().loadCode));
}

export function useResourceMarkdown(): ResourceMarkdown {
	return use(once(useResourceHost().loadMarkdown));
}
