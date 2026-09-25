import { RiPuzzle2Line } from "@remixicon/react";
import { extToolId, parseExtToolId } from "@thinkrail/contracts";
import { useMemo } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { IconTooltip } from "../components/ui/tooltip";
import { ExtensionSurface } from "./ExtensionSurface";
import { selectSurfaces, surfaceTitle, useExtStore } from "./extStore";
import { openSurface } from "./hooks";

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
					<ExtensionSurface name={extension.name} surfaceId={surface.id} layout="inline" />
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

export const ExtensionMenu = ({ targetGroupId }: { targetGroupId?: string }) => {
	const extensions = useExtStore((state) => state.extensions);
	const items = useMemo(() => selectSurfaces(extensions, ["tab", "panel"]), [extensions]);
	if (items.length === 0) return null;
	return (
		<DropdownMenu>
			<IconTooltip label="Extensions" wrapTrigger>
				<DropdownMenuTrigger
					data-testid="ext-menu"
					aria-label="Extensions"
					className="flex w-32 shrink-0 items-center justify-center border-border-default border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				>
					<RiPuzzle2Line className="size-14" />
				</DropdownMenuTrigger>
			</IconTooltip>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>Extensions</DropdownMenuLabel>
				{items.map((item) => (
					<DropdownMenuItem
						key={extToolId({ name: item.extension.name, surfaceId: item.surface.id })}
						data-testid={`ext-open-${item.extension.name}-${item.surface.id}`}
						onSelect={() =>
							openSurface(item.extension.name, item.surface.id, undefined, targetGroupId)
						}
					>
						{surfaceTitle(item)}
						<span className="ml-auto pl-12 text-text-subtle">
							{item.surface.slot === "tab" ? "tab" : "panel"}
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
