import type * as AppServer from "@thinkrail/extension-api/server";
import type * as AppResources from "@thinkrail/resource-renderers";
import type * as Server from "../server";
import type * as Resources from "./resources";

type Assignable<From, To> = [From] extends [To] ? true : false;
type Mutual<A, B> = [Assignable<A, B>, Assignable<B, A>] extends [true, true] ? true : false;
type Expect<T extends true> = T;

export type ConformingServer = [
	Expect<Mutual<Server.ServerExtension, AppServer.ServerExtension>>,
	Expect<Mutual<Server.ExtensionSessionServices, AppServer.ExtensionSessionServices>>,
	Expect<Mutual<Server.ExtensionSetting, AppServer.ExtensionSetting>>,
	Expect<Mutual<Server.InteractiveTool, AppServer.InteractiveTool>>,
	Expect<Mutual<Server.ToolResponse, AppServer.ToolResponse>>,
];

export type ConformingResources = [
	Expect<Mutual<Resources.ResourcePreviewProps, AppResources.ResourcePreviewProps>>,
	Expect<Mutual<Resources.FramedResourcePreviewProps, AppResources.FramedResourcePreviewProps>>,
	Expect<Mutual<Resources.ResourcePreviewLayout, AppResources.ResourcePreviewLayout>>,
	Expect<Mutual<Resources.ResourceScope, AppResources.ResourceScope>>,
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
