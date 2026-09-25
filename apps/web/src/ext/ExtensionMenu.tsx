import { RiPuzzle2Line, RiShieldLine } from "@remixicon/react";
import { type ExtensionScope, extToolId } from "@thinkrail/contracts";
import { Fragment, useMemo, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { IconTooltip } from "../components/ui/tooltip";
import { selectActiveWorkspaceProjectId, useAppStore } from "../store";
import { selectBlocked, selectSurfaces, surfaceTitle, useExtStore } from "./extStore";
import { openSurface } from "./hooks";
import { TrustExtensionsDialog } from "./TrustExtensionsDialog";

const SCOPES: readonly { scope: ExtensionScope; label: string }[] = [
	{ scope: "user", label: "User · ~/.thinkrail/extensions" },
	{ scope: "project", label: "Project · .thinkrail/extensions" },
];

const EmptyState = ({ unsupported }: { unsupported: boolean }) => (
	<div data-testid="ext-menu-empty" className="flex max-w-[20rem] flex-col gap-4 px-8 py-4">
		{unsupported ? (
			<span className="tr-text-ui text-text-muted">This host does not support extensions.</span>
		) : (
			<>
				<span className="tr-text-ui text-text-default">No extensions.</span>
				<span className="tr-text-metadata text-text-muted">
					Add one to <code className="tr-code-text">~/.thinkrail/extensions/&lt;name&gt;</code> or{" "}
					<code className="tr-code-text">&lt;project&gt;/.thinkrail/extensions/&lt;name&gt;</code>.
				</span>
				<span className="tr-text-metadata text-text-muted">
					SDK guide: <code className="tr-code-text">~/.thinkrail/ext-sdk/README.md</code>. Or ask
					the agent to build one.
				</span>
			</>
		)}
	</div>
);

export const ExtensionMenu = ({ targetGroupId }: { targetGroupId?: string }) => {
	const extensions = useExtStore((state) => state.extensions);
	const unsupported = useExtStore((state) => state.hydration === "unsupported");
	const projectId = useAppStore(selectActiveWorkspaceProjectId);
	const project = useAppStore((state) => state.projects.find((p) => p.id === projectId));
	const items = useMemo(() => selectSurfaces(extensions, ["tab", "panel"]), [extensions]);
	const blocked = useMemo(
		() => (project && project.trusted !== true ? selectBlocked(extensions, project.id) : []),
		[extensions, project],
	);
	const [menuOpen, setMenuOpen] = useState(false);
	const [trustOpen, setTrustOpen] = useState(false);
	const [dismissedProject, setDismissedProject] = useState<string | null>(null);

	const onMenuOpenChange = (open: boolean) => {
		if (open && blocked.length > 0 && dismissedProject !== project?.id) {
			setTrustOpen(true);
			return;
		}
		setMenuOpen(open);
	};
	const onTrustOpenChange = (open: boolean) => {
		setTrustOpen(open);
		if (!open && project) setDismissedProject(project.id);
	};
	const groups = SCOPES.map((group) => ({
		...group,
		items: items.filter((item) => item.extension.scope === group.scope),
	})).filter((group) => group.items.length > 0);

	return (
		<>
			<DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
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
					{blocked.length > 0 ? (
						<DropdownMenuItem data-testid="ext-menu-blocked" onSelect={() => setTrustOpen(true)}>
							<RiShieldLine className="size-14 text-feedback-warning" />
							{blocked.length} project extension{blocked.length === 1 ? "" : "s"} off: trust
							project…
						</DropdownMenuItem>
					) : null}
					{groups.length === 0 && blocked.length === 0 ? (
						<EmptyState unsupported={unsupported} />
					) : null}
					{groups.map((group, index) => (
						<Fragment key={group.scope}>
							{index > 0 || blocked.length > 0 ? <DropdownMenuSeparator /> : null}
							<DropdownMenuLabel
								data-testid={`ext-menu-group-${group.scope}`}
								className="tr-text-metadata text-text-subtle"
							>
								{group.label}
							</DropdownMenuLabel>
							{group.items.map((item) => (
								<DropdownMenuItem
									key={extToolId({ name: item.extension.name, surfaceId: item.surface.id })}
									data-testid={`ext-open-${item.extension.name}-${item.surface.id}`}
									data-scope={item.extension.scope}
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
						</Fragment>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			{project && blocked.length > 0 ? (
				<TrustExtensionsDialog
					projectId={project.id}
					projectName={project.name}
					extensions={blocked}
					open={trustOpen}
					onOpenChange={onTrustOpenChange}
				/>
			) : null}
		</>
	);
};
