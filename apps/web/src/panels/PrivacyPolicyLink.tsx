import { T, useT } from "@thinkrail/locales/react";
import type { ReactNode } from "react";

export const PRIVACY_POLICY_URL = "https://github.com/JetBrains/thinkrail#analytics--privacy";

function PrivacyPolicyAnchor({ children }: { children?: ReactNode }) {
	return (
		<a
			href={PRIVACY_POLICY_URL}
			target="_blank"
			rel="noopener noreferrer"
			data-testid="privacy-policy-link"
			className="text-primary underline underline-offset-2 hover:opacity-80"
		>
			{children}
		</a>
	);
}

export function PrivacyPolicySentence() {
	return (
		<T i18nKey="settings.privacy.policy" components={[<PrivacyPolicyAnchor key="policy" />]} />
	);
}

export function PrivacyPolicyRowLink() {
	const t = useT();
	return (
		<a
			href={PRIVACY_POLICY_URL}
			target="_blank"
			rel="noopener noreferrer"
			data-testid="survey-privacy-policy"
			className="ml-auto shrink-0 tr-text-ui text-primary underline underline-offset-2 hover:opacity-80"
		>
			{t("panels.survey.privacyPolicy")}
		</a>
	);
}
