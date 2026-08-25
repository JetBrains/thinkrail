declare module "pino-roll" {
	import type { DestinationStream } from "pino";

	export interface PinoRollLimitOptions {
		count: number;
		removeOtherLogFiles?: boolean;
	}

	export interface PinoRollOptions {
		file: string | (() => string);
		size?: string | number;
		frequency?: "daily" | "hourly" | "weekly" | number;
		dateFormat?: string;
		limit?: PinoRollLimitOptions;
		mkdir?: boolean;
		sync?: boolean;
	}

	export interface PinoRollStream extends DestinationStream {
		on(event: "error", listener: (error: Error) => void): this;
		end(): void;
	}

	export default function buildPinoRoll(options: PinoRollOptions): Promise<PinoRollStream>;
}

declare module "pino-roll/lib/utils.js" {
	export interface RemoveOldFilesOptions {
		baseFile: string;
		count: number;
		dateFormat?: string;
		extension?: string;
		removeOtherLogFiles: true;
	}

	export function removeOldFiles(options: RemoveOldFilesOptions): Promise<void>;
}
