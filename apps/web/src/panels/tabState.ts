/**
 * One persistent selected-tab treatment for every workspace strip. The surface adds area while the
 * short content-edge marker adds a shape cue that survives themes whose neighbouring surfaces match.
 */
const ACTIVE_WORKSPACE_TAB =
	"relative bg-control-bg-selected text-text-default after:pointer-events-none after:absolute after:right-xs after:bottom-0 after:left-xs after:z-10 after:h-[2px] after:rounded-full after:bg-primary after:content-['']";

const INACTIVE_WORKSPACE_TAB = "text-text-muted hover:bg-control-bg-hovered";

export function workspaceTabStateClass(active: boolean): string {
	return active ? ACTIVE_WORKSPACE_TAB : INACTIVE_WORKSPACE_TAB;
}
