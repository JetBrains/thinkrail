import { useAction } from "@thinkrail/ext/view";
import { useEffect, useState } from "react";
import type { Span } from "./model";

const TICK_MS = 250;

export const useNow = (ticking: boolean) => {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!ticking) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), TICK_MS);
		return () => clearInterval(timer);
	}, [ticking]);
	return now;
};

export const useWatch = (sessionId: string | undefined) => {
	const watch = useAction("watch");
	useEffect(() => {
		if (sessionId) void watch().catch(() => {});
	}, [sessionId, watch]);
};

const previewOf = (result: unknown) =>
	typeof result === "object" &&
	result !== null &&
	"preview" in result &&
	typeof result.preview === "string"
		? result.preview
		: undefined;

export const usePreview = (span: Span) => {
	const fetchPreview = useAction("preview");
	const [preview, setPreview] = useState<string>();
	useEffect(() => {
		let current = true;
		void fetchPreview({ spanId: span.id })
			.then((result) => {
				if (current) setPreview(previewOf(result));
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [fetchPreview, span]);
	return preview;
};
