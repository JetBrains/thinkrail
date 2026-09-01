import {
	RiCheckLine as Check,
	RiExternalLinkLine as ExternalLink,
	RiLoader4Line as Loader2,
	RiAlertLine as TriangleAlert,
} from "@remixicon/react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { LoginState } from "./loginState";

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
	const promptRef = useRef<HTMLInputElement>(null);

	const openedUrlRef = useRef<string | null>(null);
	const deviceUri = state.deviceCode?.verificationUri;
	useEffect(() => {
		if (!deviceUri || openedUrlRef.current === deviceUri) return;
		openedUrlRef.current = deviceUri;
		window.open(deviceUri, "_blank", "noopener,noreferrer");
	}, [deviceUri]);

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
							? `${providerName} connected`
							: state.status === "error"
								? "Couldn't connect"
								: `Connect ${providerName}`}
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
						{providerName} is connected.
					</p>
				) : state.status === "error" ? (
					<p
						className="flex items-start gap-8 text-feedback-error tr-text-ui"
						data-testid="login-error"
					>
						<TriangleAlert className="mt-2 size-16 shrink-0" />
						<span className="min-w-0 break-words">{state.error ?? "Login failed."}</span>
					</p>
				) : (
					<div className="flex flex-col gap-12">
						{state.url ? (
							<div className="flex flex-col gap-4">
								<Button
									data-testid="login-open-url"
									onClick={() => window.open(state.url, "_blank", "noopener,noreferrer")}
								>
									<ExternalLink className="size-16" />
									Open sign-in page
								</Button>
								<code className="select-all break-all rounded-[var(--radius-sm)] bg-control-bg px-8 py-4 tr-code-text text-text-muted">
									{state.url}
								</code>
							</div>
						) : null}

						{state.deviceCode ? (
							<div
								className="flex flex-col gap-4 rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-12"
								data-testid="login-device-code"
							>
								<span className="text-text-muted tr-text-metadata">
									Enter this code at{" "}
									<a
										href={state.deviceCode.verificationUri}
										target="_blank"
										rel="noopener noreferrer"
										data-testid="login-device-url"
										className="inline-flex items-center gap-2 break-all rounded-[var(--radius-sm)] text-primary underline underline-offset-2 outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary"
									>
										{state.deviceCode.verificationUri}
										<ExternalLink className="size-12 shrink-0" />
									</a>
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
										className="rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-12 py-8 text-left tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
									>
										{option.label}
									</button>
								))}
							</div>
						) : null}

						{state.input?.kind === "prompt" ? (
							<div className="flex flex-col gap-4">
								{state.input.message ? (
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
											if (e.nativeEvent.isComposing) return;
											if (e.key === "Enter") {
												e.preventDefault();
												submitPrompt();
											}
										}}
										className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none placeholder:text-text-muted focus-visible:border-control-border-active"
									/>
									<Button data-testid="login-submit" onClick={submitPrompt}>
										Submit
									</Button>
								</div>
							</div>
						) : null}

						{state.progress ? (
							<p
								className="flex items-center gap-8 text-text-muted tr-text-ui"
								data-testid="login-progress"
							>
								<Loader2 className="size-16 shrink-0 animate-spin" />
								{state.progress}
							</p>
						) : null}

						{!state.url && !state.deviceCode && !state.input && !state.progress ? (
							<p
								className="flex items-center gap-8 text-text-muted tr-text-ui"
								data-testid="login-working"
							>
								<Loader2 className="size-16 shrink-0 animate-spin" />
								Working…
							</p>
						) : null}
					</div>
				)}

				<DialogFooter>
					{terminal ? (
						<Button variant="outline" data-testid="login-close" onClick={onClose}>
							Done
						</Button>
					) : (
						<Button variant="outline" data-testid="login-cancel" onClick={onCancel}>
							Cancel
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
