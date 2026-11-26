import type { SharedSpecifier } from "../src/shared";

export const SHARED_SOURCES: Record<SharedSpecifier, string> = {
	react: "react",
	"react/jsx-runtime": "react/jsx-runtime",
	"react-dom": "react-dom",
	"@thinkrail/extension-sdk/web": "@thinkrail/extension-api/web",
	"@thinkrail/extension-sdk/resources": "@thinkrail/resource-renderers",
	"@thinkrail/extension-sdk/ui/button": "@thinkrail/ui/button",
	"@thinkrail/extension-sdk/ui/theme": "@thinkrail/ui/theme",
	"@thinkrail/extension-sdk/ui/utils": "@thinkrail/ui/utils",
};

export const WHOLE_PUBLIC_API_EXCEPT: Partial<Record<SharedSpecifier, readonly string[]>> = {
	react: [],
	"react/jsx-runtime": [],
	"react-dom": ["useFormState"],
};
