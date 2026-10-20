import type { ComponentProps, ComponentType } from "react";
import { createContext, useContext } from "react";
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
	markdown: ResourceMarkdown;
	code: ResourceCodeHost;
	bytesUrl(workspaceId: string, path: string, oid?: string | null): string;
	openFile(workspaceId: string, path: string): void;
}

export interface ResourcePreferences {
	fileLineWidth: number;
	fileLineWidthBounded: boolean;
}

const ResourceHostContext = createContext<ResourceHost | null>(null);
const ResourcePreferencesContext = createContext<ResourcePreferences | null>(null);

export const ResourceHostProvider = ResourceHostContext.Provider;
export const ResourcePreferencesProvider = ResourcePreferencesContext.Provider;

export function useResourceHost(): ResourceHost {
	const host = useContext(ResourceHostContext);
	if (!host) throw new Error("Resource renderers need a ResourceHostProvider");
	return host;
}

export function useResourcePreferences(): ResourcePreferences {
	const preferences = useContext(ResourcePreferencesContext);
	if (!preferences) throw new Error("Resource renderers need a ResourcePreferencesProvider");
	return preferences;
}
