import { Children, isValidElement, type ReactNode } from "react";

export interface SettingsPageProps {
	title: string;
	description?: ReactNode;
	testId?: string;
	children: ReactNode;
}

export function SettingsPage({ title, description, testId, children }: SettingsPageProps) {
	return (
		<div data-testid={testId} className="flex flex-col gap-24">
			<header className="flex flex-col gap-4 pr-[2rem]">
				<h2 className="tr-heading-sm text-text-default">{title}</h2>
				{description ? <p className="tr-text-metadata text-text-muted">{description}</p> : null}
			</header>
			<div className="flex flex-col">
				{Children.toArray(children).map((child, index) => (
					<div
						key={isValidElement(child) && child.key !== null ? child.key : index}
						className="flex flex-col empty:hidden [:not(:empty)~&]:mt-24 [:not(:empty)~&]:border-border-muted [:not(:empty)~&]:border-t [:not(:empty)~&]:pt-24"
					>
						{child}
					</div>
				))}
			</div>
		</div>
	);
}
