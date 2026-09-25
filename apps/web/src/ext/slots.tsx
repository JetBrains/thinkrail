import { parseExtToolId } from "@thinkrail/contracts";
import { useMemo } from "react";
import { ExtensionSurface } from "./ExtensionSurface";
import { selectSurfaces, useExtStore } from "./extStore";

export const ExtensionStatusItems = () => {
	const extensions = useExtStore((state) => state.extensions);
	const items = useMemo(() => selectSurfaces(extensions, ["status"]), [extensions]);
	if (items.length === 0) return null;
	return (
		<div data-testid="ext-status-items" className="flex items-center gap-12">
			{items.map(({ extension, surface }) => (
				<div
					key={`${extension.name}:${surface.id}`}
					data-testid="ext-status-item"
					className="flex max-w-[16rem] items-center overflow-hidden tr-text-ui text-text-muted"
				>
					<ExtensionSurface name={extension.name} surfaceId={surface.id} layout="status" />
				</div>
			))}
		</div>
	);
};

export const ExtensionPanelBody = ({ tool }: { tool: string }) => {
	const parsed = parseExtToolId(tool);
	if (!parsed) return null;
	return <ExtensionSurface name={parsed.name} surfaceId={parsed.surfaceId} />;
};

export const ExtensionTabBody = ({
	extension,
	surface,
}: {
	extension: string;
	surface: string;
}) => <ExtensionSurface name={extension} surfaceId={surface} />;
