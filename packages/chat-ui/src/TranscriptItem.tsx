import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { cn } from "@thinkrail/ui/utils";
import {
	type ComponentProps,
	createContext,
	type ReactNode,
	type RefCallback,
	use,
	useLayoutEffect,
	useSyncExternalStore,
} from "react";

export type TranscriptMenuAction = "expand" | "collapse" | "copy" | "open";

export interface TranscriptMenu {
	readonly itemId: string;
	readonly actions: readonly TranscriptMenuAction[];
}

export interface TranscriptNavigation {
	subscribe: (listener: () => void) => () => void;
	isCurrent: (id: string) => boolean;
	menuFor: (id: string) => TranscriptMenu | null;
	runMenuAction: (itemId: string, action: TranscriptMenuAction) => void;
	closeMenu: (itemId: string) => void;
	restoreFocus: (itemId: string) => void;
	itemUnmounting: (id: string) => void;
}

export const TranscriptNavigationContext = createContext<TranscriptNavigation | null>(null);

const TranscriptFlashContext = createContext<string | null>(null);

/** The transcript's navigation, and the item a jump landed on, highlighted for a moment. */
export function TranscriptProvider({
	navigation,
	flashedItemId,
	children,
}: {
	navigation: TranscriptNavigation;
	flashedItemId: string | null;
	children: ReactNode;
}) {
	return (
		<TranscriptNavigationContext value={navigation}>
			<TranscriptFlashContext value={flashedItemId}>{children}</TranscriptFlashContext>
		</TranscriptNavigationContext>
	);
}

const MENU_LABELS = {
	expand: "chat.transcript.menu.expand",
	collapse: "chat.transcript.menu.collapse",
	copy: "chat.transcript.menu.copy",
	open: "chat.transcript.menu.openFile",
} as const satisfies Record<TranscriptMenuAction, MessageKey>;

const subscribeNothing = () => () => {};

type TranscriptItemProps = Omit<ComponentProps<"article">, "id" | "ref" | "role" | "tabIndex"> & {
	id: string;
	ref?: RefCallback<HTMLElement> | undefined;
};

export function TranscriptItem({ id, ref, className, children, ...rest }: TranscriptItemProps) {
	const navigation = use(TranscriptNavigationContext);
	const flashed = use(TranscriptFlashContext) === id;
	const subscribe = navigation?.subscribe ?? subscribeNothing;
	const current = useSyncExternalStore(
		subscribe,
		() => navigation?.isCurrent(id) ?? false,
		() => false,
	);
	const menu = useSyncExternalStore(
		subscribe,
		() => navigation?.menuFor(id) ?? null,
		() => null,
	);
	useLayoutEffect(() => () => navigation?.itemUnmounting(id), [navigation, id]);
	if (!navigation) {
		return (
			<div ref={ref} className={className} {...rest}>
				{children}
			</div>
		);
	}
	return (
		<article
			ref={ref}
			tabIndex={-1}
			data-transcript-item={id}
			data-transcript-current={current || undefined}
			data-flash={flashed || undefined}
			className={cn(
				"relative transition-colors focus-visible:focus-ring-inset data-[flash]:bg-primary-subtle",
				className,
			)}
			{...rest}
		>
			{children}
			{menu ? <TranscriptItemMenu navigation={navigation} menu={menu} /> : null}
		</article>
	);
}

function TranscriptItemMenu({
	navigation,
	menu,
}: {
	navigation: TranscriptNavigation;
	menu: TranscriptMenu;
}) {
	const t = useT();
	return (
		<DropdownMenu
			open
			onOpenChange={(open) => {
				if (!open) navigation.closeMenu(menu.itemId);
			}}
		>
			<DropdownMenuTrigger asChild>
				<span aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-0 w-0" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				data-testid="chat-item-menu"
				aria-label={t("chat.transcript.menu.label")}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					navigation.restoreFocus(menu.itemId);
				}}
			>
				{menu.actions.map((action) => (
					<DropdownMenuItem
						key={action}
						data-testid={`chat-item-menu-${action}`}
						onSelect={() => navigation.runMenuAction(menu.itemId, action)}
					>
						{t(MENU_LABELS[action])}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
