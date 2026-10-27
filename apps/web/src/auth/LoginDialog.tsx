import {
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiLoader4Line as Loader2,
	RiAlertLine as TriangleAlert,
} from "@remixicon/react";
import { T, useT } from "@thinkrail/locales/react";
import { Button, buttonVariants } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { copyText } from "@/lib";
import type { LoginState } from "./loginState";
import { redirectsToLoopback, uiServedFromLoopback } from "./uiOrigin";

function DeviceLink({ href, children }: { href: string; children?: ReactNode }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			data-testid="login-device-url"
			className="inline-flex items-center gap-2 break-all rounded-sm text-primary underline underline-offset-2 outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary"
		>
			{children}
			<ExternalLink className="size-12 shrink-0" />
		</a>
	);
}

export function LoginDialog({
	state,
	providerName,
	onReply,
	onCancel,
	onClose,
}: {
	state: LoginState;
	providerName: string;
	onReply: (value: string) => void;
	onCancel: () => void;
	onClose: () => void;
}) {
	const t = useT();
	const promptRef = useRef<HTMLInputElement>(null);

	const openedUrlRef = useRef<string | null>(null);
	const deviceUri = state.deviceCode?.verificationUri;
	useEffect(() => {
		if (!deviceUri || openedUrlRef.current === deviceUri) return;
		openedUrlRef.current = deviceUri;
		window.open(deviceUri, "_blank", "noopener,noreferrer");
	}, [deviceUri]);

	const [pasteOpen, setPasteOpen] = useState(() => !uiServedFromLoopback());
	const [copied, setCopied] = useState(false);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => (copiedTimer.current ? clearTimeout(copiedTimer.current) : undefined), []);
	const [copyFailed, setCopyFailed] = useState(false);
	const urlFieldRef = useRef<HTMLInputElement>(null);
	const urlFieldId = useId();
	useEffect(() => {
		if (!copyFailed) return;
		urlFieldRef.current?.focus();
		urlFieldRef.current?.select();
	}, [copyFailed]);
	const copyUrl = async (url: string) => {
		if (!(await copyText(url))) {
			setCopyFailed(true);
			return;
		}
		setCopied(true);
		if (copiedTimer.current) clearTimeout(copiedTimer.current);
		copiedTimer.current = setTimeout(() => setCopied(false), 1500);
	};

	const pasteFallback =
		state.input?.kind === "prompt" && state.url !== undefined && redirectsToLoopback(state.url);
	const waitingForBrowser =
		state.url !== undefined && (state.input?.kind !== "prompt" || pasteFallback);
	const progress = waitingForBrowser ? t("auth.login.waitingForBrowser") : state.progress;

	const submitPrompt = () => {
		const value = promptRef.current?.value.trim() ?? "";
		const allowEmpty = state.input?.kind === "prompt" && state.input.allowEmpty;
		if (value || allowEmpty) onReply(value);
	};

	const terminal = state.status !== "active";
	const dismiss = () => (terminal ? onClose() : onCancel());

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) dismiss();
			}}
		>
			<DialogContent
				data-testid="login-dialog"
				data-provider={state.providerId}
				data-status={state.status}
				className="max-h-[85vh] overflow-y-auto"
			>
				<DialogHeader>
					<DialogTitle>
						{state.status === "success"
							? t("auth.login.connectedTitle", { provider: providerName })
							: state.status === "error"
								? t("auth.login.errorTitle")
								: t("auth.login.connectTitle", { provider: providerName })}
					</DialogTitle>
					{state.instructions && state.status === "active" ? (
						<DialogDescription>{state.instructions}</DialogDescription>
					) : null}
				</DialogHeader>

				{state.status === "success" ? (
					<p
						className="flex items-center gap-8 text-feedback-success tr-text-ui"
						data-testid="login-success"
					>
						<Check className="size-16 shrink-0" />
						{t("auth.login.connected", { provider: providerName })}
					</p>
				) : state.status === "error" ? (
					<p
						className="flex items-start gap-8 text-feedback-error tr-text-ui"
						data-testid="login-error"
					>
						<TriangleAlert className="mt-2 size-16 shrink-0" />
						<span className="min-w-0 break-words">{state.error ?? t("auth.login.failed")}</span>
					</p>
				) : (
					<div className="flex flex-col gap-12">
						{state.url ? (
							<div className="flex gap-8">
								<a
									href={state.url}
									target="_blank"
									rel="noopener noreferrer"
									data-testid="login-open-url"
									className={buttonVariants({ className: "flex-1" })}
								>
									<ExternalLink className="size-16" />
									{t("auth.login.openPage")}
								</a>
								<Button
									variant="outline"
									data-testid="login-copy-url"
									data-copied={copied || undefined}
									onClick={() => {
										if (state.url) void copyUrl(state.url);
									}}
								>
									{copied ? <Check className="size-16" /> : <Copy className="size-16" />}
									{copied ? t("common.copied") : t("auth.login.copyLink")}
								</Button>
							</div>
						) : null}

						{state.url && copyFailed ? (
							<div className="flex flex-col gap-4">
								<label htmlFor={urlFieldId} className="text-text-muted tr-text-metadata">
									{t("auth.login.copyManually")}
								</label>
								<input
									id={urlFieldId}
									ref={urlFieldRef}
									readOnly
									value={state.url}
									data-testid="login-url-field"
									className="min-w-0 rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none focus-visible:border-control-border-active"
								/>
							</div>
						) : null}

						{state.deviceCode ? (
							<div
								className="flex flex-col gap-4 rounded-sm border border-border-default bg-control-bg p-12"
								data-testid="login-device-code"
							>
								<span className="text-text-muted tr-text-metadata">
									<T
										i18nKey="auth.login.deviceCode"
										values={{ url: state.deviceCode.verificationUri }}
										components={[<DeviceLink key="link" href={state.deviceCode.verificationUri} />]}
									/>
								</span>
								<code className="tr-code-otp select-all text-center text-text-default">
									{state.deviceCode.userCode}
								</code>
							</div>
						) : null}

						{state.input?.kind === "select" ? (
							<div className="flex flex-col gap-4">
								{state.input.message ? (
									<p className="text-text-muted tr-text-ui">{state.input.message}</p>
								) : null}
								{state.input.options.map((option) => (
									<button
										key={option.id}
										type="button"
										data-testid="login-option"
										data-option={option.id}
										onClick={() => onReply(option.id)}
										className="rounded-sm border border-control-border-default bg-control-bg px-12 py-8 text-left tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
									>
										{option.label}
									</button>
								))}
							</div>
						) : null}

						{state.input?.kind === "prompt" && pasteFallback && !pasteOpen ? (
							<button
								type="button"
								data-testid="login-paste-toggle"
								onClick={() => setPasteOpen(true)}
								className="self-start rounded-sm text-text-muted tr-text-metadata underline underline-offset-2 outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
							>
								{t("auth.login.pasteToggle")}
							</button>
						) : null}

						{state.input?.kind === "prompt" && (!pasteFallback || pasteOpen) ? (
							<div className="flex flex-col gap-4">
								{pasteFallback ? (
									<p className="text-text-muted tr-text-metadata" data-testid="login-paste-hint">
										{t("auth.login.pasteHint")}
									</p>
								) : state.input.message ? (
									<p className="text-text-muted tr-text-ui">{state.input.message}</p>
								) : null}
								<div className="flex gap-8">
									<input
										ref={promptRef}
										data-testid="login-input"
										autoFocus
										type={state.input.secret ? "password" : "text"}
										placeholder={state.input.placeholder ?? ""}
										onKeyDown={(e) => {
											if (isImeComposing(e.nativeEvent)) return;
											if (e.key === "Enter") {
												e.preventDefault();
												submitPrompt();
											}
										}}
										className="min-w-0 flex-1 rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none placeholder:text-text-muted focus-visible:border-control-border-active"
									/>
									<Button data-testid="login-submit" onClick={submitPrompt}>
										{t("auth.login.submit")}
									</Button>
								</div>
							</div>
						) : null}

						{progress ? (
							<p
								className="flex items-center gap-8 text-text-muted tr-text-ui"
								data-testid="login-progress"
							>
								<Loader2 className="size-16 shrink-0 animate-spin" />
								{progress}
							</p>
						) : null}

						{!state.url && !state.deviceCode && !state.input && !state.progress ? (
							<p
								className="flex items-center gap-8 text-text-muted tr-text-ui"
								data-testid="login-working"
							>
								<Loader2 className="size-16 shrink-0 animate-spin" />
								{t("auth.login.working")}
							</p>
						) : null}
					</div>
				)}

				<DialogFooter>
					{terminal ? (
						<Button variant="outline" data-testid="login-close" onClick={onClose}>
							{t("common.done")}
						</Button>
					) : (
						<Button variant="outline" data-testid="login-cancel" onClick={onCancel}>
							{t("common.cancel")}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
