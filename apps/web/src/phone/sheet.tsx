import type { RemixiconComponentType } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@thinkrail/ui/dialog";
import { type ReactNode, useState } from "react";
import { ScreenHeader } from "./layout";

/**
 * The phone's action sheet: the shared dialog, docked to the bottom edge, with a closing row (Cancel unless
 * `closeLabel` says otherwise). A tall body scrolls inside the sheet. `autoFocus={false}` keeps focus off the
 * sheet's first field, so a picker with a search box opens without raising the keyboard.
 */
export function Sheet({
	open,
	onOpenChange,
	title,
	description,
	closeLabel,
	autoFocus = true,
	testId,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: ReactNode;
	closeLabel?: string;
	autoFocus?: boolean;
	testId?: string;
	children: ReactNode;
}) {
	const t = useT();
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				hideClose
				{...(description ? {} : { "aria-describedby": undefined })}
				{...(autoFocus ? {} : { onOpenAutoFocus: (event: Event) => event.preventDefault() })}
				data-testid={testId}
				className="top-auto bottom-0 left-0 flex max-h-[85vh] max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-b-none p-0 pb-safe-bottom"
			>
				<div className="flex shrink-0 flex-col gap-4 border-b border-border-muted px-16 py-12 text-center">
					<DialogTitle className="truncate text-text-muted tr-text-metadata">{title}</DialogTitle>
					{description ? (
						<DialogDescription className="text-text-muted tr-text-metadata">
							{description}
						</DialogDescription>
					) : null}
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
				<button
					type="button"
					onClick={() => onOpenChange(false)}
					className="min-h-touch w-full shrink-0 border-0 border-t border-border-default bg-transparent px-16 py-12 text-text-default tr-title-card active:bg-control-bg-hovered"
				>
					{closeLabel ?? t("common.cancel")}
				</button>
			</DialogContent>
		</Dialog>
	);
}

/**
 * A picker as a full page over the current screen, the phone's stack-screen look: the screen header with a
 * back arrow that closes it, the body scrolling under it. For lists long enough to read as a page (models);
 * short action menus stay a bottom `Sheet`. `autoFocus={false}` as on `Sheet`.
 */
export function PageSheet({
	open,
	onOpenChange,
	title,
	autoFocus = true,
	testId,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	autoFocus?: boolean;
	testId?: string;
	children: ReactNode;
}) {
	const t = useT();
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				hideClose
				aria-describedby={undefined}
				{...(autoFocus ? {} : { onOpenAutoFocus: (event: Event) => event.preventDefault() })}
				data-testid={testId}
				className="inset-0 flex max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-container-workspace-bg p-0 pt-safe-top shadow-none"
			>
				<ScreenHeader
					title={title}
					back={{ label: t("common.back"), onBack: () => onOpenChange(false) }}
					Title={DialogTitle}
				/>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe-bottom">
					{children}
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** Closes the topmost open sheet, page or dialog the way Escape does; false when none is open. For the Android back button. */
export function closeTopLayer(): boolean {
	if (!document.querySelector('[data-modal-layer][data-state="open"]')) return false;
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	return true;
}

export function SheetAction({
	icon: Icon,
	label,
	detail,
	destructive = false,
	disabled = false,
	onSelect,
}: {
	icon: RemixiconComponentType;
	label: string;
	detail?: string | undefined;
	destructive?: boolean;
	disabled?: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onSelect}
			className={`flex min-h-touch w-full items-center gap-12 border-0 border-b border-border-muted bg-transparent px-16 py-12 text-left active:bg-control-bg-hovered disabled:opacity-50 ${destructive ? "text-feedback-error" : "text-text-default"}`}
		>
			<Icon aria-hidden className="size-22 shrink-0" />
			<span className="flex min-w-0 flex-1 flex-col gap-2">
				<span className="truncate tr-text-reading">{label}</span>
				{detail ? <span className="text-text-subtle tr-text-metadata">{detail}</span> : null}
			</span>
		</button>
	);
}

/** A destructive confirmation: the title asks, the description says what happens, one red action does it. */
export function ConfirmSheet({
	open,
	onOpenChange,
	title,
	description,
	icon,
	confirmLabel,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: ReactNode;
	icon: RemixiconComponentType;
	confirmLabel: string;
	onConfirm: () => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange} title={title} description={description}>
			<SheetAction
				icon={icon}
				label={confirmLabel}
				destructive
				onSelect={() => {
					onOpenChange(false);
					onConfirm();
				}}
			/>
		</Sheet>
	);
}

/** Rename in a sheet: the field starts on the current name each time it opens; Save sends only a real change. */
export function RenameSheet({
	open,
	onOpenChange,
	title,
	label,
	current,
	onRename,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	label: string;
	current: string;
	onRename: (name: string) => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange} title={title}>
			<RenameForm
				label={label}
				current={current}
				onRename={(name) => {
					onOpenChange(false);
					onRename(name);
				}}
			/>
		</Sheet>
	);
}

function RenameForm({
	label,
	current,
	onRename,
}: {
	label: string;
	current: string;
	onRename: (name: string) => void;
}) {
	const t = useT();
	const [value, setValue] = useState(current);
	const name = value.trim();
	const changed = name !== "" && name !== current;
	return (
		<form
			className="flex flex-col gap-12 p-16"
			onSubmit={(event) => {
				event.preventDefault();
				if (changed) onRename(name);
			}}
		>
			<input
				aria-label={label}
				value={value}
				onChange={(event) => setValue(event.target.value)}
				onFocus={(event) => event.currentTarget.select()}
				autoCapitalize="off"
				autoCorrect="off"
				spellCheck={false}
				className="h-touch w-full rounded-md border border-control-border-default bg-control-bg px-12 text-text-default tr-text-reading outline-none focus:border-control-border-active"
			/>
			<Button type="submit" variant="primary" className="h-touch rounded-md" disabled={!changed}>
				{t("common.save")}
			</Button>
		</form>
	);
}
