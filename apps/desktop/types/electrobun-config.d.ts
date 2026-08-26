export interface ElectrobunConfig {
	app: {
		name: string;
		identifier: string;
		version: string;
	};
	runtime: {
		exitOnLastWindowClosed: boolean;
	};
	build: {
		bunVersion: string;
		bun: { entrypoint: string };
		copy: Record<string, string>;
		useAsar: boolean;
		mac: { bundleCEF: boolean };
		linux: { bundleCEF: boolean };
		win: { bundleCEF: boolean };
	};
}
