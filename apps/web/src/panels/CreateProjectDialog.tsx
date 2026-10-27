import { RiAlertLine as Alert, RiFolderOpenLine as FolderOpen } from "@remixicon/react";
import type { Project } from "@thinkrail/contracts";
import { t as translate, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { Switch } from "@thinkrail/ui/switch";
import { useState } from "react";
import { errorText, getTransport } from "@/transport";

export const DEFAULT_PROJECT_PARENT = "~/thinkrail";

const PICK_TIMEOUT_MS = 30 * 60_000;
const FIELD_CLASS =
	"w-full min-w-0 rounded-sm border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active";

export function projectFolderName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}._-]+/gu, "-")
		.replace(/^[-.]+|-+$/g, "");
}

export function joinHostPath(parent: string, folder: string): string {
	const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
	return `${parent.replace(/[\\/]+$/, "")}${separator}${folder}`;
}

export function CreateProjectDialog({
	onClose,
	onCreated,
}: {
	onClose: () => void;
	onCreated: (project: Project, setup: boolean) => void;
}) {
	const t = useT();
	const [name, setName] = useState("");
	const [parent, setParent] = useState(DEFAULT_PROJECT_PARENT);
	const [setup, setSetup] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const folder = projectFolderName(name);
	const parentPath = parent.trim();
	const canCreate = folder !== "" && parentPath !== "" && !busy;

	const browse = async () => {
		try {
			const { path } = await getTransport().request(
				"dialog.selectDirectory",
				{},
				{ timeoutMs: PICK_TIMEOUT_MS },
			);
			if (path) setParent(path);
		} catch (err) {
			setError(errorText(err, translate("panels.createProject.pickFailed")));
		}
	};

	const create = async () => {
		setBusy(true);
		setError(null);
		try {
			const project = await getTransport().request("project.create", {
				parentPath,
				name: folder,
				displayName: name.trim(),
			});
			setBusy(false);
			onCreated(project, setup);
			onClose();
		} catch (err) {
			setBusy(false);
			setError(errorText(err, translate("panels.createProject.createFailed")));
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent data-testid="create-project-dialog" className="max-w-[32rem] gap-12">
				<DialogHeader>
					<DialogTitle>{t("panels.createProject.title")}</DialogTitle>
					<DialogDescription>{t("panels.createProject.description")}</DialogDescription>
				</DialogHeader>

				<form
					className="flex flex-col gap-12"
					onSubmit={(event) => {
						event.preventDefault();
						if (canCreate) void create();
					}}
				>
					<label htmlFor="create-project-name" className="flex flex-col gap-4">
						<span className="tr-title-compact text-text-default">
							{t("panels.createProject.name")}
						</span>
						<input
							id="create-project-name"
							data-testid="create-project-name"
							autoFocus
							autoComplete="off"
							spellCheck={false}
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder={t("panels.createProject.namePlaceholder")}
							className={FIELD_CLASS}
						/>
					</label>

					<div className="flex flex-col gap-4">
						<label htmlFor="create-project-parent" className="tr-title-compact text-text-default">
							{t("panels.createProject.location")}
						</label>
						<div className="flex gap-8">
							<input
								id="create-project-parent"
								data-testid="create-project-parent"
								autoComplete="off"
								spellCheck={false}
								value={parent}
								onChange={(event) => setParent(event.target.value)}
								className={FIELD_CLASS}
							/>
							<Button
								variant="outline"
								data-testid="create-project-browse"
								onClick={() => void browse()}
							>
								<FolderOpen className="size-16" />
								{t("panels.createProject.browse")}
							</Button>
						</div>
						<span
							data-testid="create-project-path"
							className="truncate text-text-muted tr-text-metadata"
						>
							{folder ? joinHostPath(parentPath, folder) : t("panels.createProject.pathHint")}
						</span>
					</div>

					<div className="flex items-center gap-12">
						<span className="min-w-0 flex-1">
							<span className="block tr-title-compact text-text-default">
								{t("panels.createProject.setupTitle")}
							</span>
							<span className="block text-text-muted tr-text-metadata">
								{t("panels.createProject.setupDetail")}
							</span>
						</span>
						<Switch
							checked={setup}
							onCheckedChange={setSetup}
							label={t("panels.createProject.setupTitle")}
							testId="create-project-setup"
						/>
					</div>

					{error ? (
						<p
							data-testid="create-project-error"
							className="flex items-start gap-8 text-feedback-error tr-text-ui"
						>
							<Alert className="mt-2 size-16 shrink-0" />
							<span className="min-w-0 whitespace-pre-wrap break-words">{error}</span>
						</p>
					) : null}

					<DialogFooter>
						<Button variant="outline" disabled={busy} onClick={onClose}>
							{t("common.cancel")}
						</Button>
						<Button type="submit" data-testid="create-project-submit" disabled={!canCreate}>
							{busy ? t("panels.createProject.creating") : t("panels.createProject.create")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
