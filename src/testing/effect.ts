import { Cause, Effect, Exit, Logger, LogLevel, Option } from "effect";

// ---------------------------------------------------------------------------
// Effect test helpers
//
// These wrap Effect.runPromise* to reduce boilerplate in test bodies.
// All test effects must have Requirements = never (fully provided via Layer).
// ---------------------------------------------------------------------------

/**
 * Run an effect and return its success value.
 * Throws if the effect fails.
 */
export const runSuccess = <A>(
	effect: Effect.Effect<A, never, never>,
): Promise<A> =>
	Effect.runPromise(effect.pipe(Logger.withMinimumLogLevel(LogLevel.None)));

/**
 * Run an effect and return the typed failure value.
 * Throws with a descriptive message if the effect unexpectedly succeeds.
 */
export const runFailure = async <E>(
	effect: Effect.Effect<unknown, E, never>,
): Promise<E> => {
	const exit = await Effect.runPromiseExit(
		effect.pipe(Logger.withMinimumLogLevel(LogLevel.None)),
	);
	if (Exit.isSuccess(exit)) {
		throw new Error(
			`Expected effect to fail but it succeeded with: ${String(exit.value)}`,
		);
	}
	return Option.getOrElse(Cause.failureOption(exit.cause), () => {
		throw new Error(
			`Expected a Fail cause but got defect:\n${Cause.pretty(exit.cause)}`,
		);
	});
};
