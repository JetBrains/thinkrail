import type { IssueConnection, IssueConnectionInput } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { associationFormState, type ConnectResult, submitConnection } from "./model";

export interface IssueAssociationFormProps {
	connection: IssueConnection | null;
	initialRepositoryUrl?: string | null | undefined;
	pending: boolean;
	authSupported: boolean;
	/** False on a host that cannot address GitHub Issue references. */
	githubSupported?: boolean;
	onConnect: (input: IssueConnectionInput) => Promise<ConnectResult>;
	onError?: ((error: "connect" | null) => void) | undefined;
	onCancelReconnect?: (() => void) | undefined;
	initialAcknowledgedInstance?: string | null | undefined;
}

const inputClass =
	"min-w-0 w-full rounded-sm border border-control-border-default bg-control-bg px-8 py-4 text-text-default tr-text-ui focus:border-control-border-active read-only:text-text-muted";

export function IssueAssociationForm({
	connection,
	initialRepositoryUrl,
	pending,
	authSupported,
	githubSupported = true,
	onConnect,
	onError,
	onCancelReconnect,
	initialAcknowledgedInstance = null,
}: IssueAssociationFormProps) {
	const t = useT();
	const [address, setAddress] = useState(initialRepositoryUrl?.trim() ?? "");
	const [instanceEdit, setInstanceEdit] = useState<{ address: string; value: string } | null>(null);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [acknowledged, setAcknowledged] = useState<string | null>(initialAcknowledgedInstance);
	const [token, setToken] = useState("");

	const {
		addressNotice,
		showAdvanced,
		advancedToggle,
		instanceValue,
		projectPath,
		canonicalInstance,
		consentRequired,
		consentAcknowledged,
		providerNotice,
		input,
		canSubmit,
	} = associationFormState({
		connection,
		address,
		instanceOverride: instanceEdit,
		advancedOpen,
		acknowledged,
		token,
		pending,
		authSupported,
		githubSupported,
	});

	return (
		<form
			className="flex flex-col gap-8"
			onSubmit={(event) => {
				event.preventDefault();
				if (!input) return;
				onError?.(null);
				void submitConnection(input, () => setToken(""), onConnect)
					.then((result) => onError?.(result.ok ? null : result.error))
					.catch(() => onError?.("connect"));
			}}
		>
			<fieldset disabled={pending || !authSupported} className="flex min-w-0 flex-col gap-8">
				{connection ? (
					<>
						<label className="flex flex-col gap-4">
							{t("issues.instance")}
							<input
								className={inputClass}
								data-testid="issues-reconnect-instance"
								readOnly
								value={connection.instanceUrl}
							/>
						</label>
						<label className="flex flex-col gap-4">
							{t("issues.project")}
							<input
								className={inputClass}
								data-testid="issues-reconnect-project"
								readOnly
								value={connection.remoteProjectId}
							/>
						</label>
					</>
				) : (
					<>
						<label className="flex flex-col gap-4">
							{t("issues.address")}
							<input
								className={inputClass}
								data-testid="issues-address"
								autoComplete="off"
								spellCheck={false}
								placeholder={t("issues.addressPlaceholder")}
								value={address}
								onChange={(event) => setAddress(event.target.value)}
							/>
							<span className="text-text-muted tr-text-metadata">{t("issues.addressHint")}</span>
						</label>
						{addressNotice && (
							<p role="note" className="text-feedback-warning">
								{t(addressNotice)}
							</p>
						)}
						{providerNotice && (
							<p role="note" data-testid="issues-provider-notice" className="text-feedback-warning">
								{t(providerNotice)}
							</p>
						)}
						{advancedToggle && (
							<Button
								type="button"
								variant="ghost"
								size="s"
								aria-expanded={showAdvanced}
								onClick={() => setAdvancedOpen(!advancedOpen)}
							>
								{t("issues.advanced")}
							</Button>
						)}
						{showAdvanced && (
							<div className="flex flex-col gap-8 rounded-sm border border-border-muted p-8">
								<p className="text-text-muted tr-text-metadata">{t("issues.advancedHint")}</p>
								<label className="flex flex-col gap-4">
									{t("issues.instance")}
									<input
										className={inputClass}
										data-testid="issues-instance"
										autoComplete="off"
										spellCheck={false}
										value={instanceValue}
										onChange={(event) => setInstanceEdit({ address, value: event.target.value })}
									/>
								</label>
								<label className="flex flex-col gap-4">
									{t("issues.project")}
									<input
										className={inputClass}
										data-testid="issues-project"
										readOnly
										value={projectPath}
									/>
									<span className="text-text-muted tr-text-metadata">
										{t("issues.projectHint")}
									</span>
								</label>
							</div>
						)}
					</>
				)}
				{consentRequired && canonicalInstance && (
					<div
						data-testid="issues-http-risk"
						className="flex flex-col gap-4 rounded-sm border border-feedback-warning p-8"
					>
						<p className="break-words text-feedback-warning">
							{t("issues.httpRisk", { instance: canonicalInstance })}
						</p>
						<label className="flex items-start gap-8">
							<input
								type="checkbox"
								className="size-16 shrink-0 accent-primary"
								data-testid="issues-http-consent"
								checked={consentAcknowledged}
								onChange={(event) =>
									setAcknowledged(event.target.checked ? canonicalInstance : null)
								}
							/>
							<span className="break-words text-text-default">
								{t("issues.httpConsent", { instance: canonicalInstance })}
							</span>
						</label>
					</div>
				)}
				<label className="flex flex-col gap-4">
					{t("issues.token")}
					<input
						className={inputClass}
						data-testid="issues-token"
						type="password"
						autoComplete="off"
						value={token}
						onChange={(event) => setToken(event.target.value)}
					/>
					{authSupported && (
						<span className="text-text-muted tr-text-metadata">{t("issues.tokenVault")}</span>
					)}
				</label>
				<div className="flex items-center gap-8">
					<Button type="submit" size="s" data-testid="issues-connect" disabled={!canSubmit}>
						{connection ? t("issues.reconnect") : t("issues.connect")}
					</Button>
					{connection && onCancelReconnect && (
						<Button
							type="button"
							variant="ghost"
							size="s"
							onClick={() => {
								onCancelReconnect();
								onError?.(null);
							}}
						>
							{t("common.cancel")}
						</Button>
					)}
				</div>
			</fieldset>
		</form>
	);
}
