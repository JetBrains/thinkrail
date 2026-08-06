// Shared visual contract for Radix dropdown and context menus. Keep feature-specific behavior in callers.
export const menuContentClass =
	"z-50 min-w-[12rem] overflow-y-auto overflow-x-hidden rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-xs text-text-default shadow-[var(--shadow-md)]";

export const menuItemClass =
	"relative flex cursor-default select-none items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs tr-text-ui text-text-default outline-none transition-colors focus:bg-control-bg-hovered data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-muted";

export const menuSeparatorClass = "-mx-xs my-xs h-px bg-border-default";
