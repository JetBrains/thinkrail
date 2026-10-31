import { RiFolderOpenLine as FolderOpen } from "@remixicon/react";
import type { Project } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { randomId } from "../lib";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { cloneDepth, repositoryFolderName } from "./cloneRepository";

const FIELD_CLASS =
	"w-full min-w-0 rounded-sm border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default outline-none placeholder:text-text-muted focus-visible:border-control-border-active disabled:text-control-disabled-text";

export function CloneProjectDialog({
	onClose,
	onCloned,
}: {
	onClose: () => void;
	onCloned: (project: Project) => void;
}) {
	const t = useT();
	const [url, setUrl] = useState("");
	const [folderOverride, setFolderOverride] = useState<string | null>(null);
	const [parent, setParent] = useState("~");
	const [depthInput, setDepthInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const [picking, setPicking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [preview, setPreview] = useState<{
		parent: string;
		name: string;
		path?: string;
		error?: string;
	} | null>(null);
	const activeOperation = useRef<string | null>(null);
	const mounted = useRef(false);
	const folder = folderOverride ?? repositoryFolderName(url);
	const parentPath = parent.trim();
	const name = folder.trim();
	const depth = cloneDepth(depthInput);
	const currentPreview = preview?.parent === parentPath && preview.name === name ? preview : null;
	const canClone = !!url.trim() && !!currentPreview?.path && depth !== null && !busy && !picking;

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			const operationId = activeOperation.current;
			if (operationId)
				void getTransport()
					.request("project.cancelClone", { operationId })
					.catch(() => {});
		};
	}, []);

	useEffect(() => {
		if (!parentPath || !name || busy) return;
		let stale = false;
		const timer = setTimeout(() => {
			void getTransport()
				.request("project.cloneDestination", { parentPath, name })
				.then(
					({ path }) => {
						if (!stale) setPreview({ parent: parentPath, name, path });
					},
					(err: unknown) => {
						if (!stale)
							setPreview({
								parent: parentPath,
								name,
								error: errorText(err, t("panels.cloneProject.invalidDestination")),
							});
					},
				);
		}, 200);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	}, [parentPath, name, busy, t]);

	const browse = () => {
		setPicking(true);
		setError(null);
		void getTransport()
			.request("dialog.selectDirectory", {}, { timeoutMs: 30 * 60_000 })
			.then(
				({ path }) => {
					if (mounted.current && path) setParent(path);
				},
				(err: unknown) => {
					if (mounted.current) setError(errorText(err, t("panels.createProject.pickFailed")));
				},
			)
			.finally(() => {
				if (mounted.current) setPicking(false);
			});
	};

	const clone = () => {
		if (!canClone || activeOperation.current || depth === null) return;
		const operationId = randomId("clone");
		activeOperation.current = operationId;
		setBusy(true);
		setCancelling(false);
		setError(null);
		setNotice(null);
		void getTransport()
			.request(
				"project.clone",
				{
					operationId,
					url: url.trim(),
					parentPath,
					name,
					...(depth === undefined ? {} : { depth }),
				},
				{ timeoutMs: 31 * 60_000 },
			)
			.then(
				(project) => {
					activeOperation.current = null;
					if (!mounted.current) return;
					if (project) {
						onCloned(project);
						onClose();
					} else setNotice(t("panels.cloneProject.cancelled"));
				},
				(err: unknown) => {
					if (!mounted.current) return;
					const message = errorText(err, t("panels.cloneProject.failed"));
					setError(
						wsErrorCode(err) === "PROJECT_CLONE_CLEANUP_FAILED"
							? `${t("panels.cloneProject.cleanupFailed")}\n${message}`
							: message,
					);
				},
			)
			.finally(() => {
				activeOperation.current = null;
				if (mounted.current) {
					setBusy(false);
					setCancelling(false);
				}
			});
	};

	const cancel = () => {
		const operationId = activeOperation.current;
		if (!operationId) {
			onClose();
			return;
		}
		setCancelling(true);
		void getTransport()
			.request("project.cancelClone", { operationId })
			.catch((err: unknown) => {
				if (mounted.current && activeOperation.current === operationId) {
					setCancelling(false);
					setError(errorText(err, t("panels.cloneProject.cancelFailed")));
				}
			});
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent
				hideClose={busy}
				data-testid="clone-project-dialog"
				className="max-h-[90dvh] max-w-[32rem] gap-12 overflow-y-auto"
			>
				<DialogHeader>
					<DialogTitle>{t("panels.cloneProject.title")}</DialogTitle>
					<DialogDescription>{t("panels.cloneProject.description")}</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-12"
					onSubmit={(event) => {
						event.preventDefault();
						clone();
					}}
				>
					<fieldset disabled={busy || picking} className="flex min-w-0 flex-col gap-12">
						<label htmlFor="clone-project-url" className="flex flex-col gap-4">
							<span className="tr-title-compact">{t("panels.cloneProject.url")}</span>
							<input
								id="clone-project-url"
								data-testid="clone-project-url"
								autoFocus
								autoComplete="off"
								spellCheck={false}
								value={url}
								onChange={(event) => setUrl(event.target.value)}
								placeholder={t("panels.cloneProject.urlPlaceholder")}
								className={FIELD_CLASS}
							/>
							<span className="text-text-muted tr-text-metadata">
								{t("panels.cloneProject.authHint")}
							</span>
						</label>
						<div className="flex flex-col gap-4">
							<label htmlFor="clone-project-parent" className="tr-title-compact">
								{t("panels.cloneProject.parent")}
							</label>
							<div className="flex gap-8">
								<input
									id="clone-project-parent"
									data-testid="clone-project-parent"
									autoComplete="off"
									spellCheck={false}
									value={parent}
									onChange={(event) => setParent(event.target.value)}
									className={FIELD_CLASS}
								/>
								<Button
									variant="outline"
									size="l"
									iconLeft={FolderOpen}
									data-testid="clone-project-browse"
									onClick={browse}
								>
									{t("panels.createProject.browse")}
								</Button>
							</div>
						</div>
						<label htmlFor="clone-project-name" className="flex flex-col gap-4">
							<span className="tr-title-compact">{t("panels.cloneProject.folder")}</span>
							<input
								id="clone-project-name"
								data-testid="clone-project-name"
								autoComplete="off"
								spellCheck={false}
								value={folder}
								onChange={(event) => setFolderOverride(event.target.value)}
								className={FIELD_CLASS}
							/>
						</label>
						<div className="flex flex-col gap-4">
							<span className="tr-title-compact">{t("panels.cloneProject.destination")}</span>
							<span
								data-testid="clone-project-path"
								className="break-all text-text-muted tr-code-text"
							>
								{currentPreview?.path ?? t("panels.cloneProject.pathHint")}
							</span>
							{currentPreview?.error ? (
								<span
									data-testid="clone-project-destination-error"
									role="alert"
									className="break-words text-feedback-error tr-text-ui"
								>
									{currentPreview.error}
								</span>
							) : null}
						</div>
						<label htmlFor="clone-project-depth" className="flex flex-col gap-4">
							<span className="tr-title-compact">{t("panels.cloneProject.depth")}</span>
							<input
								id="clone-project-depth"
								data-testid="clone-project-depth"
								type="number"
								min={1}
								max={2147483647}
								step={1}
								value={depthInput}
								onChange={(event) => setDepthInput(event.target.value)}
								placeholder={t("panels.cloneProject.fullHistory")}
								className={FIELD_CLASS}
							/>
							<span className="text-text-muted tr-text-metadata">
								{t("panels.cloneProject.depthHint")}
							</span>
						</label>
					</fieldset>
					{error ? (
						<p
							data-testid="clone-project-error"
							role="alert"
							className="whitespace-pre-wrap break-words text-feedback-error tr-text-ui"
						>
							{error}
						</p>
					) : null}
					{busy || notice ? (
						<p
							data-testid="clone-project-status"
							role="status"
							className="text-text-muted tr-text-ui"
						>
							{busy
								? cancelling
									? t("panels.cloneProject.cancelling")
									: t("panels.cloneProject.cloning")
								: notice}
						</p>
					) : null}
					<DialogFooter>
						<Button
							variant="outline"
							data-testid="clone-project-cancel"
							disabled={cancelling}
							onClick={cancel}
						>
							{t("common.cancel")}
						</Button>
						<Button type="submit" data-testid="clone-project-submit" disabled={!canClone}>
							{t("panels.cloneProject.clone")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
