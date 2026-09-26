const CLOCK_ADVICE = "Pass a timestamp in through args, or stamp the result after the run.";
const DICE_ADVICE = "Pass a seed, or the values themselves, in through args.";

const nondeterministic = (call: string, advice: string): Error =>
	new Error(
		`${call} is not available inside an ultracode script: a resumed run must replay identically. ${advice}`,
	);

const refuseWrites = (name: string) => {
	const refuse = (): never => {
		throw new Error(
			`${name} cannot be patched inside an ultracode script: the binding wraps the host's ${name}. ` +
				"Pass the value in through args.",
		);
	};
	return {
		set: refuse,
		defineProperty: refuse,
		deleteProperty: refuse,
		preventExtensions: refuse,
		setPrototypeOf: refuse,
	};
};

export const guardedDate: DateConstructor = new Proxy(Date, {
	...refuseWrites("Date"),
	construct: (target, argArray, newTarget) => {
		if (argArray.length === 0) throw nondeterministic("new Date()", CLOCK_ADVICE);
		return Reflect.construct(target, argArray, newTarget);
	},
	apply: () => {
		throw nondeterministic("Date()", CLOCK_ADVICE);
	},
	get: (target, prop, receiver) => {
		if (prop === "now") {
			return () => {
				throw nondeterministic("Date.now()", CLOCK_ADVICE);
			};
		}
		return Reflect.get(target, prop, receiver);
	},
});

export const guardedMath: Math = new Proxy(Math, {
	...refuseWrites("Math"),
	get: (target, prop, receiver) => {
		if (prop === "random") {
			return () => {
				throw nondeterministic("Math.random()", DICE_ADVICE);
			};
		}
		return Reflect.get(target, prop, receiver);
	},
});
