import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { SharedExportName } from "@thinkrail/extension-api/installed";
import type * as AppServer from "@thinkrail/extension-api/server";
import type * as AppWeb from "@thinkrail/extension-api/web";
import type * as AppResources from "@thinkrail/resource-renderers";
import type * as Server from "../server";
import type * as Resources from "./resources";
import type * as UiButton from "./ui/button";
import type * as UiTheme from "./ui/theme";
import type * as UiUtils from "./ui/utils";
import type * as Web from "./web";

type Assignable<From, To> = [From] extends [To] ? true : false;
type Keys<T> = T extends unknown ? keyof T : never;
type SameKeys<A, B> = [Exclude<Keys<A>, Keys<B>> | Exclude<Keys<B>, Keys<A>>] extends [never]
	? true
	: false;
type Conforms<A, B> = [Assignable<A, B>, Assignable<B, A>, SameKeys<A, B>] extends [
	true,
	true,
	true,
]
	? true
	: false;
type Expect<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type ValueExports<M> = Extract<keyof M, string>;
type Sdk = "@thinkrail/extension-sdk";

type InstalledSettingCopy = "title" | "description";

type BuiltInOnlyServerFields = "supersedesPackages" | "apiVersion" | "queries";
type InstalledWorkspaceFiles = Omit<AppServer.WorkspaceFiles, "checkArtifacts">;
type InstalledSessionServices = Omit<AppServer.ExtensionSessionServices, "workspaceFiles"> & {
	workspaceFiles: InstalledWorkspaceFiles;
};
type InstalledArtifactTool = Omit<AppServer.ArtifactTool, "published">;
type InstalledServerExtension = Omit<
	AppServer.ServerExtension,
	BuiltInOnlyServerFields | "sessionExtensions" | "artifactTools"
> & {
	sessionExtensions?: (session: InstalledSessionServices) => ExtensionFactory[];
	artifactTools?: Record<string, InstalledArtifactTool>;
};

export type ConformingServer = [
	Expect<Conforms<Server.ServerExtension, InstalledServerExtension>>,
	Expect<Assignable<Server.ServerExtension, AppServer.ServerExtension>>,
	Expect<Conforms<Server.ExtensionSessionServices, InstalledSessionServices>>,
	Expect<Assignable<AppServer.ExtensionSessionServices, Server.ExtensionSessionServices>>,
	Expect<Conforms<Server.WorkspaceFiles, InstalledWorkspaceFiles>>,
	Expect<
		Conforms<
			Omit<Server.ExtensionBooleanSetting, InstalledSettingCopy>,
			Omit<AppServer.ExtensionBooleanSetting, InstalledSettingCopy>
		>
	>,
	Expect<
		Conforms<
			Pick<Server.ExtensionBooleanSetting, InstalledSettingCopy>,
			{ title?: string; description?: string }
		>
	>,
	Expect<Conforms<Server.InteractiveTool, AppServer.InteractiveTool>>,
	Expect<Conforms<Server.ArtifactTool, InstalledArtifactTool>>,
	Expect<Conforms<Server.ToolResponse, AppServer.ToolResponse>>,
];

export type ConformingResources = [
	Expect<Conforms<Resources.ResourcePreviewProps, AppResources.ResourcePreviewProps>>,
	Expect<Conforms<Resources.FramedResourcePreviewProps, AppResources.FramedResourcePreviewProps>>,
	Expect<Conforms<Resources.ResourcePreviewLayout, AppResources.ResourcePreviewLayout>>,
	Expect<Conforms<Resources.ResourceScope, AppResources.ResourceScope>>,
	Expect<
		Conforms<
			Resources.ResourceHost,
			Pick<AppResources.ResourceHost, "openFile" | "openComparison"> & {
				markdown: Resources.ResourceHost["markdown"];
			}
		>
	>,
	Expect<Assignable<AppResources.ResourceHost, Resources.ResourceHost>>,
	Expect<Assignable<typeof AppResources.ResourcePreview, typeof Resources.ResourcePreview>>,
	Expect<
		Assignable<typeof AppResources.FramedResourcePreview, typeof Resources.FramedResourcePreview>
	>,
	Expect<Assignable<typeof AppResources.useResourceScope, typeof Resources.useResourceScope>>,
	Expect<
		Assignable<
			typeof AppResources.useOptionalResourceHost,
			typeof Resources.useOptionalResourceHost
		>
	>,
];

export type AllowListedValues = [
	Expect<Equal<ValueExports<typeof Web>, SharedExportName<`${Sdk}/web`>>>,
	Expect<Equal<ValueExports<typeof Resources>, SharedExportName<`${Sdk}/resources`>>>,
	Expect<Equal<ValueExports<typeof UiButton>, SharedExportName<`${Sdk}/ui/button`>>>,
	Expect<Equal<ValueExports<typeof UiTheme>, SharedExportName<`${Sdk}/ui/theme`>>>,
	Expect<Equal<ValueExports<typeof UiUtils>, SharedExportName<`${Sdk}/ui/utils`>>>,
];

export type ConformingWeb = [
	Expect<Assignable<Web.WebExtension, AppWeb.WebExtension>>,
	Expect<Conforms<Web.ToolRegistrationOptions, AppWeb.ToolRegistrationOptions>>,
	Expect<Conforms<Web.ToolRenderProps, AppWeb.ToolRenderProps>>,
	Expect<Equal<keyof Web.WebExtension, Exclude<keyof AppWeb.WebExtension, BuiltInOnlyWebFields>>>,
	Expect<
		Assignable<
			typeof AppWeb.defineWebExtension<Web.WebExtension>,
			(e: Web.WebExtension) => Web.WebExtension
		>
	>,
];

type BuiltInOnlyWebFields =
	| "title"
	| "description"
	| "globalOverlay"
	| "commands"
	| "shortcuts"
	| "panels";
