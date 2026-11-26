import { defineWebExtension, strArg } from "@thinkrail/extension-sdk/web";
import { PaletteCard } from "./PaletteCard";

export default defineWebExtension({
	name: "@thinkrail/example-extension-palette",
	toolRenderers: {
		color_palette: {
			renderer: PaletteCard,
			options: {
				prominence: "primary",
				defaultExpanded: true,
				summary: ({ args }) => {
					const base = strArg(args, "base");
					return base
						? `${strArg(args, "harmony") || "analogous"} palette from ${base}`
						: "Colour palette";
				},
			},
		},
	},
});
