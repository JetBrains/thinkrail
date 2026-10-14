import { Children, type ReactNode } from "react";

import { SETTINGS_ROWS_CONTAINER } from "./SettingsRow";

export interface SettingsGroupProps {
	/** Section heading text */
	title: string;
	/** Optional short explanation shown below the title */
	description?: string | undefined;
	/** Content (setting rows, controls, etc.) */
	children: ReactNode;
	/** Test ID for the section */
	testId?: string;
}

/**
 * A group heading for related settings. The heading is visually attached to the first
 * setting below it (no divider between). Use larger vertical spacing before a new group.
 *
 * Children are wrapped in a container that automatically hides the last child's bottom border.
 */
export function SettingsGroup({ title, description, children, testId }: SettingsGroupProps) {
	return (
		<section data-testid={testId} className="flex flex-col">
			<div className="flex flex-col gap-2 pb-12">
				{/* Uppercase muted heading matching the sidebar navigation group headings */}
				<h3 className="tr-text-label-pill text-text-subtle">{title}</h3>
				{description && <p className="tr-text-metadata text-text-muted">{description}</p>}
			</div>
			<div className={SETTINGS_ROWS_CONTAINER}>{children}</div>
		</section>
	);
}

/**
 * Inset divider between logical Settings groups.
 * Aligns with the Settings content grid (same inset as internal setting dividers).
 */
export function SettingsGroupDivider() {
	return <hr className="border-border-muted" />;
}

export interface SettingsPageContainerProps {
	/** Child groups (use SettingsGroup or standalone sections) */
	children: ReactNode;
	/** Test ID for the container */
	testId?: string;
}

/**
 * Container for Settings page content. Automatically renders inset dividers
 * between logical groups (non-null children). Use this to wrap SettingsGroup components
 * and standalone sections on a Settings page.
 *
 * - Renders an inset divider between each visible (non-null/undefined/false) child
 * - No divider before the first group or after the last group
 * - Adds 48px vertical spacing between groups (24px above + 24px below the divider)
 * - Handles conditionally hidden groups automatically
 *
 * @example
 * <SettingsPageContainer testId="settings-models">
 *   <SettingsGroup title="Model selection">...</SettingsGroup>
 *   <SettingsGroup title="Automation">...</SettingsGroup>
 *   <SettingsGroup title="GPT context window">...</SettingsGroup>
 * </SettingsPageContainer>
 */
export function SettingsPageContainer({ children, testId }: SettingsPageContainerProps) {
	// Children.toArray already filters null/undefined/booleans, so we just use it directly
	const validChildren = Children.toArray(children);

	return (
		<div data-testid={testId} className="flex flex-col">
			{validChildren.map((child, index) => (
				<div key={index} className="flex flex-col">
					{index > 0 && (
						<div className="py-24">
							<SettingsGroupDivider />
						</div>
					)}
					{child}
				</div>
			))}
		</div>
	);
}

/**
 * A muted horizontal divider between individual settings within a group.
 */
export function SettingsDivider() {
	return <hr className="border-border-muted" />;
}

/**
 * @deprecated Use vertical spacing (pt-24) between sections instead of dividers.
 * Kept for backward compatibility but should not be used in new code.
 */
export function SettingsSectionDivider() {
	return <hr className="border-border-default" />;
}
