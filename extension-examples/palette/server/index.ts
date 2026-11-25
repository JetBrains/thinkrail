import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionSessionServices, ServerExtension } from "@thinkrail/extension-sdk/server";
import { Type } from "typebox";
import { buildPalette, HARMONIES, type Harmony, paletteText } from "./palette";

export const PALETTE_TOOL = "color_palette";

const Parameters = Type.Object({
	base: Type.String({ description: "The base colour as a hex value, e.g. #3b82f6 or #38f." }),
	harmony: Type.Optional(
		Type.Unsafe<Harmony>({
			type: "string",
			enum: [...HARMONIES],
			description: "How the other colours relate to the base. Default: analogous.",
		}),
	),
});

function paletteTool(session: ExtensionSessionServices) {
	return (pi: ExtensionAPI) => {
		const checkContrast = session.setting("contrast");
		pi.registerTool({
			name: PALETTE_TOOL,
			label: "Colour palette",
			description:
				"Build a five-colour palette from a base colour using a colour harmony (analogous, monochromatic, complementary, split-complementary, triadic or tetradic). Returns the hex values and CSS custom properties" +
				(checkContrast ? ", each rated for WCAG contrast against white and black text." : "."),
			promptSnippet:
				"Build colour palettes from a base hex colour and show them as swatches in chat.",
			parameters: Parameters,
			async execute(_toolCallId, params) {
				const palette = buildPalette(params.base, params.harmony ?? "analogous", checkContrast);
				return { content: [{ type: "text", text: paletteText(palette) }], details: palette };
			},
		});
	};
}

export default {
	name: "@thinkrail/example-extension-palette",
	title: "Palette",
	description:
		"Lets the agent build colour palettes from a base colour and shows them as swatches.",
	extensions: [],
	sessionExtensions: (session) => [paletteTool(session)],
	settings: {
		contrast: {
			type: "boolean",
			default: true,
			title: "Rate contrast",
			description:
				"Rate every colour's WCAG contrast against white and black text, for the agent and on the card.",
		},
	},
} satisfies ServerExtension;
