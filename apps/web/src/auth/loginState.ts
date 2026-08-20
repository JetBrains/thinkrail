export interface LoginInputSelect {
	kind: "select";
	message: string;
	options: { id: string; label: string }[];
}
export interface LoginInputPrompt {
	kind: "prompt";
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
	secret?: boolean;
}
export type LoginInput = LoginInputSelect | LoginInputPrompt;

export interface LoginState {
	loginId: string;
	providerId: string;
	status: "active" | "success" | "error";
	url?: string;
	instructions?: string;
	deviceCode?: { userCode: string; verificationUri: string; expiresInSeconds?: number };
	input?: LoginInput;
	progress?: string;
	error?: string;
}
