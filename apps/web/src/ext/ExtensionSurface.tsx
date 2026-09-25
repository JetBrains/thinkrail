import { type ExtMessageView, type ExtToolCallView, redactLaunchToken } from "@thinkrail/contracts";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib";
import { surfaceKey, useExtStore } from "./extStore";
import { SurfaceContext } from "./hooks";
import { useHostContext } from "./hostContext";
import {
	reportSurfaceError,
	SurfaceError,
	SurfaceErrorBoundary,
	type SurfaceLayout,
} from "./SurfaceErrorBoundary";
import {
	loadSurfaceModule,
	retainStylesheet,
	type SurfaceAsset,
	type SurfaceComponent,
	surfaceAssetUrl,
} from "./surfaceModule";

interface ExtensionSurfaceProps {
	name: string;
	surfaceId: string;
	layout?: SurfaceLayout;
	toolCall?: ExtToolCallView;
	message?: ExtMessageView;
}

interface Loaded {
	asset: SurfaceAsset;
	component: SurfaceComponent;
}

const reportedLoadFailures = new Set<string>();

const reportLoadFailure = (asset: SurfaceAsset, message: string) => {
	const key = `${asset.name}/${asset.build}/${asset.surfaceId}`;
	if (reportedLoadFailures.has(key)) return;
	reportedLoadFailures.add(key);
	reportSurfaceError({ name: asset.name, surfaceId: asset.surfaceId, message });
};

const useSurfaceComponent = (asset: SurfaceAsset | null) => {
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [failure, setFailure] = useState<{ build: string; error: string } | null>(null);
	const name = asset?.name;
	const build = asset?.build;
	const surfaceId = asset?.surfaceId;
	useEffect(() => {
		if (!name || !build || !surfaceId) return;
		let live = true;
		const next = { name, build, surfaceId };
		const stylesheet = retainStylesheet(surfaceAssetUrl(next, "css"));
		Promise.all([loadSurfaceModule(next), stylesheet.ready])
			.then(([component]) => {
				if (!live) return;
				setLoaded({ asset: next, component });
				setFailure(null);
			})
			.catch((error: unknown) => {
				stylesheet.release();
				const message = redactLaunchToken(error instanceof Error ? error.message : String(error));
				reportLoadFailure(next, message);
				if (live) setFailure({ build, error: message });
			});
		return () => {
			live = false;
			stylesheet.release();
		};
	}, [build, name, surfaceId]);
	return {
		loaded:
			loaded && loaded.asset.name === name && loaded.asset.surfaceId === surfaceId ? loaded : null,
		failure: failure && failure.build === build ? failure.error : null,
	};
};

const useStylesheet = (asset: SurfaceAsset | undefined) => {
	const url = asset ? surfaceAssetUrl(asset, "css") : null;
	useEffect(() => (url ? retainStylesheet(url).release : undefined), [url]);
};

const Placeholder = ({ text, layout }: { text: string; layout: SurfaceLayout }) => (
	<div
		data-testid="ext-surface-placeholder"
		className={cn(
			"flex items-center justify-center tr-text-ui text-text-muted",
			layout === "status" ? "px-4" : "p-12",
			layout === "fill" && "h-full",
		)}
	>
		{text}
	</div>
);

export const ExtensionSurface = ({
	name,
	surfaceId,
	layout = "fill",
	toolCall,
	message,
}: ExtensionSurfaceProps) => {
	const hydration = useExtStore((state) => state.hydration);
	const info = useExtStore((state) => state.extensions[name]);
	const params = useExtStore((state) => state.params[surfaceKey(name, surfaceId)]);
	const host = useHostContext();
	const declared = info?.surfaces.some((surface) => surface.id === surfaceId) === true;
	const build = declared ? (info?.build ?? null) : null;
	const asset = useMemo(
		() => (build ? { name, build, surfaceId } : null),
		[build, name, surfaceId],
	);
	const { loaded, failure } = useSurfaceComponent(asset);
	useStylesheet(loaded?.asset);
	const identity = useMemo(() => ({ name, surfaceId }), [name, surfaceId]);

	if (hydration === "unsupported")
		return <Placeholder layout={layout} text="This host does not support extensions" />;
	if (!info) {
		if (hydration === "idle") return <Placeholder layout={layout} text="Loading extensions…" />;
		if (hydration === "failed")
			return (
				<SurfaceError
					name={name}
					surfaceId={surfaceId}
					title="Couldn't read extensions from the host"
					error="Reconnect to ThinkRail to retry."
					layout={layout}
				/>
			);
		return <Placeholder layout={layout} text={`extension ${name} not loaded`} />;
	}
	if (!declared)
		return <Placeholder layout={layout} text={`extension ${name} has no surface ${surfaceId}`} />;
	if (!loaded) {
		const error = failure ?? (build === null ? (info.error ?? "extension failed to load") : null);
		if (error)
			return (
				<SurfaceError
					name={name}
					surfaceId={surfaceId}
					title={`Extension ${name} failed to load`}
					error={error}
					layout={layout}
				/>
			);
		return <Placeholder layout={layout} text={`Loading ${name}…`} />;
	}
	const Surface = loaded.component;
	const banner = failure
		? { title: "New version failed to load; showing the last working version", error: failure }
		: info.status === "error" && info.error
			? { title: "Reload failed; showing the last working version", error: info.error }
			: null;
	return (
		<div
			data-testid="ext-surface"
			data-ext={name}
			data-surface={surfaceId}
			data-build={loaded.asset.build}
			className={cn(
				"flex min-h-0 min-w-0",
				layout === "status" ? "items-center gap-4" : "flex-col",
				layout === "fill" && "h-full",
			)}
		>
			{banner ? (
				<SurfaceError
					name={name}
					surfaceId={surfaceId}
					title={banner.title}
					error={banner.error}
					layout={layout === "status" ? "status" : "inline"}
				/>
			) : null}
			<div className={cn("min-h-0 min-w-0", layout === "fill" && "flex-1 overflow-auto")}>
				<SurfaceContext.Provider value={identity}>
					<SurfaceErrorBoundary
						name={name}
						surfaceId={surfaceId}
						resetKey={loaded.asset.build}
						layout={layout}
					>
						<Surface
							surfaceId={surfaceId}
							host={host}
							{...(params ? { params } : {})}
							{...(toolCall ? { toolCall } : {})}
							{...(message ? { message } : {})}
						/>
					</SurfaceErrorBoundary>
				</SurfaceContext.Provider>
			</div>
		</div>
	);
};
