import { Cause, Effect, Exit, Layer, Option, References } from "effect";

// ---------------------------------------------------------------------------
// Effect test helpers
//
// These wrap Effect.runPromise* to reduce boilerplate in test bodies, and own
// the dependency assembly: a test hands over its effect plus the layer that
// satisfies it, so no test body has to build a runtime of its own.
// ---------------------------------------------------------------------------

// Silence log output and satisfy the effect's requirements from `layer`. A
// layer that fails to build is a broken fixture rather than an expected
// outcome, so its error becomes a defect and never reaches runFailure.
const prepare = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	layer: Layer.Layer<R, unknown>,
): Effect.Effect<A, E, never> =>
	Effect.provideService(
		Effect.provide(effect, Layer.orDie(layer)),
		References.MinimumLogLevel,
		"None",
	);

/**
 * Run an effect and return its success value.
 * Throws if the effect fails.
 */
export const runSuccess = <A, R = never>(
	effect: Effect.Effect<A, never, R>,
	layer: Layer.Layer<R, unknown> = Layer.empty as Layer.Layer<R>,
): Promise<A> => Effect.runPromise(prepare(effect, layer));

/**
 * Run an effect and return the typed failure value.
 * Throws with a descriptive message if the effect unexpectedly succeeds.
 */
export const runFailure = async <E, R = never>(
	effect: Effect.Effect<unknown, E, R>,
	layer: Layer.Layer<R, unknown> = Layer.empty as Layer.Layer<R>,
): Promise<E> => {
	const exit = await Effect.runPromiseExit(prepare(effect, layer));
	if (Exit.isSuccess(exit)) {
		throw new Error(
			`Expected effect to fail but it succeeded with: ${String(exit.value)}`,
		);
	}
	return Option.getOrElse(Cause.findErrorOption(exit.cause), () => {
		throw new Error(
			`Expected a Fail cause but got defect:\n${Cause.pretty(exit.cause)}`,
		);
	});
};
