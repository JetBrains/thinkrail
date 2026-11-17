import type * as AppServer from "@thinkrail/extension-api/server";
import type * as AppResources from "@thinkrail/resource-renderers";
import type * as Server from "../server";
import type * as Resources from "./resources";

type Assignable<From, To> = [From] extends [To] ? true : false;
type SameKeys<A, B> = [Exclude<keyof A, keyof B> | Exclude<keyof B, keyof A>] extends [never]
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

type InstalledSettingCopy = "title" | "description";

export type ConformingServer = [
	Expect<Conforms<Server.ServerExtension, AppServer.ServerExtension>>,
	Expect<Conforms<Server.ExtensionSessionServices, AppServer.ExtensionSessionServices>>,
	Expect<Conforms<Server.WorkspaceFiles, AppServer.WorkspaceFiles>>,
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
