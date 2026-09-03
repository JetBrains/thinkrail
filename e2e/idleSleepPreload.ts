import { holdE2eIdleSleep } from "./idleSleep";
import { preloadE2eRunTiming } from "./runTiming";

const timing = preloadE2eRunTiming(process.argv[1], process.argv.slice(2));
try {
	await holdE2eIdleSleep();
} catch (error) {
	timing?.finish(1);
	throw error;
}
