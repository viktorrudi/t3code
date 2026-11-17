import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  PATTERN_READER_MODEL,
  PATTERN_READER_PROVIDER,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as PatternReader from "./PatternReader.ts";
import { parsePatternReaderRequest } from "./PatternReaderValidation.ts";

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const request = {
  protocol: "threadwise-reader-v1",
  operation: "generate",
  provider_instance_id: PATTERN_READER_PROVIDER,
  account_fingerprint: "a".repeat(64),
  model: PATTERN_READER_MODEL,
  request_id: "test-id",
  instructions: "Original instructions",
  input_text: "Source text",
  max_output_tokens: 8000,
  json_schema: {
    type: "object",
    properties: { cut: { type: "integer" } },
    required: ["cut"],
    additionalProperties: false,
  },
};
const payload = (patch: object = {}) => new TextEncoder().encode(encode({ ...request, ...patch }));
const provider = (
  execute: NonNullable<ProviderInstance["structuredGeneration"]>["execute"],
): ProviderInstance => ({
  instanceId: ProviderInstanceId.make(PATTERN_READER_PROVIDER),
  driverKind: ProviderDriverKind.make("codex"),
  continuationIdentity: {
    driverKind: ProviderDriverKind.make("codex"),
    continuationKey: PATTERN_READER_PROVIDER,
  },
  displayName: undefined,
  enabled: true,
  snapshot: {} as ProviderInstance["snapshot"],
  orchestrationAdapter: {} as ProviderInstance["orchestrationAdapter"],
  textGeneration: {} as ProviderInstance["textGeneration"],
  structuredGeneration: { execute },
});
const serviceLayer = (getInstance: () => ProviderInstance | undefined) =>
  PatternReader.layer(request.account_fingerprint).pipe(
    Layer.provide(
      Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
        getInstance: () => Effect.sync(getInstance),
      }),
    ),
    Layer.provide(NodeCrypto.layer),
  );

it.effect.each([
  { model: "gpt-6-luna" },
  { provider_instance_id: "codex" },
  { operation: "exec" },
  { tools: [] },
  { max_output_tokens: 0 },
  { max_output_tokens: 8001 },
  { instructions: "x".repeat(32_001) },
  { input_text: "x".repeat(120_001) },
  { cwd: "/source" },
  { env: { OPENAI_API_KEY: "fake" } },
  { json_schema: { type: "object", pattern: "(a+)+" } },
  { json_schema: { type: "object", $ref: "https://external/schema" } },
  { json_schema: { type: "object", description: "x".repeat(131_073) } },
  { json_schema: { type: "object", unknownConstraint: true } },
  {
    json_schema: {
      type: "object",
      $defs: { Loop: { $ref: "#/$defs/Loop" } },
      properties: { value: { $ref: "#/$defs/Loop" } },
    },
  },
])("rejects malformed/unbounded requests before provider work", (patch) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(parsePatternReaderRequest(payload(patch)));
    assert.equal(error.code, "invalid_response");
  }),
);

it.effect.each([
  new TextEncoder().encode("{"),
  new Uint8Array([255]),
  new Uint8Array(1024 * 1024 + 1),
])("rejects malformed UTF8/JSON and oversized frames", (bytes) =>
  Effect.gen(function* () {
    assert.equal((yield* Effect.flip(parsePatternReaderRequest(bytes))).code, "invalid_response");
  }),
);

it.effect("pins local authorization and hashes exact payload bytes, including whitespace", () => {
  let calls = 0;
  const instance = provider(() =>
    Effect.sync(() => {
      calls++;
      return { output_json: { cut: 2 }, usage: null };
    }),
  );
  return Effect.gen(function* () {
    const service = yield* PatternReader.PatternReader;
    assert.equal(
      (yield* Effect.flip(service.handle(payload({ account_fingerprint: "b".repeat(64) })))).code,
      "authentication_failed",
    );
    assert.equal(calls, 0);
    const a = yield* service.handle(payload());
    const b = yield* service.handle(new TextEncoder().encode(` ${encode(request)} `));
    assert.notEqual(a.transport_evidence.request_sha256, b.transport_evidence.request_sha256);
    assert.equal(a.transport_evidence.generation_tokens_capped, false);
    assert.equal(a.transport_evidence.max_output_tokens_semantics, "result-acceptance-only");
    assert.equal(calls, 2);
  }).pipe(Effect.provide(serviceLayer(() => instance)));
});

it.effect.each(["absent", "disabled", "wrong-driver", "unsupported"])(
  "rejects unavailable provider %s without fallback",
  (mode) => {
    const instance = provider(() => Effect.die("must not generate"));
    const selected =
      mode === "absent"
        ? undefined
        : mode === "disabled"
          ? { ...instance, enabled: false }
          : mode === "wrong-driver"
            ? { ...instance, driverKind: ProviderDriverKind.make("claudeAgent") }
            : ({ ...instance, structuredGeneration: undefined } as unknown as ProviderInstance);
    return Effect.gen(function* () {
      const service = yield* PatternReader.PatternReader;
      assert.equal((yield* Effect.flip(service.handle(payload()))).code, "not_configured");
    }).pipe(Effect.provide(serviceLayer(() => selected)));
  },
);

it.effect.each(["timeout", "cancel"])("bounds concurrency and releases permit on %s", (mode) =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const cleaned = yield* Deferred.make<void>();
    let first = true;
    const instance = provider(() =>
      Effect.suspend(() => {
        if (!first) return Effect.succeed({ output_json: { cut: 2 }, usage: null });
        first = false;
        return Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(cleaned, undefined)),
        );
      }),
    );
    yield* Effect.gen(function* () {
      const service = yield* PatternReader.PatternReader;
      const running = yield* service.handle(payload()).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      assert.equal((yield* Effect.flip(service.handle(payload()))).code, "busy");
      if (mode === "timeout") {
        yield* TestClock.adjust("180 seconds");
        assert.equal((yield* Effect.flip(Fiber.join(running))).code, "timeout");
      } else yield* Fiber.interrupt(running);
      yield* Deferred.await(cleaned);
      assert.deepEqual((yield* service.handle(payload())).output_json, { cut: 2 });
    }).pipe(Effect.provide(serviceLayer(() => instance)));
  }),
);

it.effect("rejects a provider replaced while generation was running", () => {
  let instance: ProviderInstance | undefined;
  instance = provider(() =>
    Effect.sync(() => {
      instance = undefined;
      return { output_json: { cut: 2 } };
    }),
  );
  return Effect.gen(function* () {
    const service = yield* PatternReader.PatternReader;
    assert.equal((yield* Effect.flip(service.handle(payload()))).code, "authentication_failed");
  }).pipe(Effect.provide(serviceLayer(() => instance)));
});
