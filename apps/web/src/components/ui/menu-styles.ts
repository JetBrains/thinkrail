// Shared visual contract for Radix dropdown and context menus. Keep feature-specific behavior in callers.
export const menuContentClass =
	"z-50 min-w-[12rem] overflow-y-auto overflow-x-hidden rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-xs text-text-default shadow-[var(--shadow-md)]";

// `focus:` here is Radix's keyboard/active-descendant highlight, not pointer hover, so it takes the
// persistent `control-bg-selected` fill; disabled is a colour role (`control-disabled-text`), never opacity.
export const menuItemClass =
	"relative flex cursor-default select-none items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs tr-text-ui text-text-default outline-none transition-colors focus:bg-control-bg-selected data-[disabled]:pointer-events-none data-[disabled]:text-control-disabled-text [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-muted data-[disabled]:[&_svg]:text-inherit";

export const menuSeparatorClass = "-mx-xs my-xs h-px bg-border-default";
