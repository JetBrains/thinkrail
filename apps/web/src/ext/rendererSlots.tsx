import type { ExtensionInfo } from "@thinkrail/contracts";
import { registerMessageRenderer } from "../chat/rendererRegistry";
import { registerToolRenderer } from "../chat/toolRegistry";
import { ExtensionSurface } from "./ExtensionSurface";
import { selectSurfaces } from "./extStore";

const registrations = new Map<string, () => void>();

const toolCardRegistration = (name: string, surfaceId: string, tool: string) =>
	registerToolRenderer(
		tool,
		({ toolCallId, toolName, args, result, status }) => (
			<ExtensionSurface
				name={name}
				surfaceId={surfaceId}
				layout="inline"
				toolCall={{ toolCallId, toolName, args, result, status }}
			/>
		),
		{ prominence: "primary", defaultExpanded: true },
	);

const messageRegistration = (name: string, surfaceId: string, customType: string) =>
	registerMessageRenderer(customType, (message) => (
		<ExtensionSurface name={name} surfaceId={surfaceId} layout="inline" message={message} />
	));

export const syncRendererSlots = (extensions: Record<string, ExtensionInfo>) => {
	const wanted = new Map<string, () => () => void>();
	for (const { extension, surface } of selectSurfaces(extensions, ["toolCard", "message"])) {
		if (surface.slot === "toolCard" && surface.tool) {
			const tool = surface.tool;
			wanted.set(`tool\0${tool}\0${extension.name}\0${surface.id}`, () =>
				toolCardRegistration(extension.name, surface.id, tool),
			);
		}
		if (surface.slot === "message" && surface.customType) {
			const customType = surface.customType;
			wanted.set(`message\0${customType}\0${extension.name}\0${surface.id}`, () =>
				messageRegistration(extension.name, surface.id, customType),
			);
		}
	}
	for (const [key, dispose] of registrations) {
		if (wanted.has(key)) continue;
		dispose();
		registrations.delete(key);
	}
	for (const [key, register] of wanted) {
		if (!registrations.has(key)) registrations.set(key, register());
	}
};
