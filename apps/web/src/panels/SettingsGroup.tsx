import { Children, isValidElement, type ReactNode } from "react";
import { SETTINGS_ROWS_CONTAINER } from "./SettingsRow";

export interface SettingsGroupProps {
	title: string;
	description?: string | undefined;
	children: ReactNode;
	testId?: string;
}

export function SettingsGroup({ title, description, children, testId }: SettingsGroupProps) {
	return (
		<section data-testid={testId} className="flex flex-col">
			<div className="flex flex-col gap-2 pb-12">
				<h3 className="tr-text-label-pill text-text-subtle">{title}</h3>
				{description ? <p className="tr-text-metadata text-text-muted">{description}</p> : null}
			</div>
			<div className={SETTINGS_ROWS_CONTAINER}>{children}</div>
		</section>
	);
}

export interface SettingsPageContainerProps {
	children: ReactNode;
	testId?: string;
}

export function SettingsPageContainer({ children, testId }: SettingsPageContainerProps) {
	return (
		<div data-testid={testId} className="flex flex-col">
			{Children.toArray(children).map((child, index) => (
				<div
					key={isValidElement(child) && child.key !== null ? child.key : index}
					className="flex flex-col empty:hidden [:not(:empty)~&]:mt-24 [:not(:empty)~&]:border-border-muted [:not(:empty)~&]:border-t [:not(:empty)~&]:pt-24"
				>
					{child}
				</div>
			))}
		</div>
	);
}
