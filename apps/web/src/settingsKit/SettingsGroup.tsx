import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";

export const SETTINGS_TAG =
	"shrink-0 rounded-xs border border-border-default px-4 tr-text-label-pill";

export const SETTINGS_ROWS = "flex flex-col [&>*:last-child]:border-b-0";

export type SettingsScope = "workspace" | "project" | "allProjects" | "device";

const SCOPE_LABELS = {
	workspace: "settings.kit.scope.workspace",
	project: "settings.kit.scope.project",
	allProjects: "settings.kit.scope.allProjects",
	device: "settings.kit.scope.device",
} as const satisfies Record<SettingsScope, MessageKey>;

export interface SettingsGroupAction {
	rowId: string;
	control: ReactNode;
}

export interface SettingsGroupProps {
	title: string;
	description?: ReactNode;
	scope?: SettingsScope | undefined;
	action?: SettingsGroupAction | undefined;
	testId?: string;
	children: ReactNode;
}

export function SettingsGroup({
	title,
	description,
	scope,
	action,
	testId,
	children,
}: SettingsGroupProps) {
	const t = useT();
	return (
		<section data-testid={testId} className="flex flex-col">
			<div className="flex flex-col gap-2 pb-4">
				<div className="flex flex-wrap items-center gap-8">
					<h3 className="min-w-0 break-words tr-text-label-pill text-text-subtle">{title}</h3>
					{scope ? (
						<span data-scope={scope} className={cn(SETTINGS_TAG, "text-text-muted")}>
							{t(SCOPE_LABELS[scope])}
						</span>
					) : null}
					{action ? (
						<div
							data-setting-row={action.rowId}
							className="ml-auto flex shrink-0 items-center gap-8"
						>
							{action.control}
						</div>
					) : null}
				</div>
				{description ? <p className="tr-text-metadata text-text-muted">{description}</p> : null}
			</div>
			<div className={SETTINGS_ROWS}>{children}</div>
		</section>
	);
}

export function SettingsSubheading({
	title,
	description,
	testId,
}: {
	title: string;
	description?: ReactNode;
	testId?: string;
}) {
	return (
		<div data-testid={testId} className="flex min-w-0 flex-col gap-2 pt-16 pb-4">
			<h4 className="tr-text-ui text-text-default">{title}</h4>
			{description ? (
				<p className="break-words text-text-muted tr-text-metadata">{description}</p>
			) : null}
		</div>
	);
}
