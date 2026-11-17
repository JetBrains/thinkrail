import type { SharedSpecifier } from "../src/shared";

export interface SharedSource {
	module: string;
	pick?: readonly string[];
}

export const RESOURCE_EXPORTS = [
	"FramedResourcePreview",
	"ResourcePreview",
	"useOptionalResourceHost",
	"useResourceScope",
] as const;

export const SHARED_SOURCES: Record<SharedSpecifier, SharedSource> = {
	react: { module: "react" },
	"react/jsx-runtime": { module: "react/jsx-runtime" },
	"react-dom": { module: "react-dom" },
	"@thinkrail/extension-sdk/web": { module: "@thinkrail/extension-api/web" },
	"@thinkrail/extension-sdk/resources": {
		module: "@thinkrail/resource-renderers",
		pick: RESOURCE_EXPORTS,
	},
	"@thinkrail/extension-sdk/ui/attention-line": { module: "@thinkrail/ui/attention-line" },
	"@thinkrail/extension-sdk/ui/button": { module: "@thinkrail/ui/button" },
	"@thinkrail/extension-sdk/ui/dialog": { module: "@thinkrail/ui/dialog" },
	"@thinkrail/extension-sdk/ui/fonts": { module: "@thinkrail/ui/fonts" },
	"@thinkrail/extension-sdk/ui/keyboard": { module: "@thinkrail/ui/keyboard" },
	"@thinkrail/extension-sdk/ui/textarea": { module: "@thinkrail/ui/textarea" },
	"@thinkrail/extension-sdk/ui/theme": { module: "@thinkrail/ui/theme" },
	"@thinkrail/extension-sdk/ui/utils": { module: "@thinkrail/ui/utils" },
};
