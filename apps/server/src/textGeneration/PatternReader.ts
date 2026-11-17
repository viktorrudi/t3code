import {
  PATTERN_READER_PROVIDER,
  PATTERN_READER_TIMEOUT_MS,
  PatternReaderError,
  ProviderInstanceId,
  type PatternReaderEvidence,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import { parsePatternReaderRequest } from "./PatternReaderValidation.ts";

export class PatternReader extends Context.Service<
  PatternReader,
  {
    readonly handle: (payload: Uint8Array) => Effect.Effect<
      {
        readonly transport_evidence: PatternReaderEvidence;
        readonly output_json?: object;
        readonly usage?: object | null;
      },
      PatternReaderError
    >;
  }
>()("t3/textGeneration/PatternReader") {}

const make = Effect.fn("PatternReader.make")(function* (accountFingerprint: string) {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const digest = yield* Digest.Digest;
  const permit = yield* Semaphore.make(1);
  const handle = Effect.fn("PatternReader.handle")(function* (payload: Uint8Array) {
    const { request, outputSchema } = yield* parsePatternReaderRequest(payload);
    if (!/^[a-f0-9]{64}$/u.test(accountFingerprint))
      return yield* new PatternReaderError({ code: "not_configured" });
    if (request.account_fingerprint !== accountFingerprint)
      return yield* new PatternReaderError({ code: "authentication_failed" });
    const instance = yield* registry.getInstance(ProviderInstanceId.make(PATTERN_READER_PROVIDER));
    if (!instance?.enabled || instance.driverKind !== "codex" || !instance.structuredGeneration) {
      return yield* new PatternReaderError({ code: "not_configured" });
    }
    const result = yield* instance.structuredGeneration.execute(request, outputSchema);
    if ((yield* registry.getInstance(instance.instanceId)) !== instance || !instance.enabled) {
      return yield* new PatternReaderError({ code: "authentication_failed" });
    }
    const { provider_request_id, ...output } = result;
    const request_sha256 = yield* digest
      .digest(Digest.sha256, payload)
      .pipe(Effect.map(Hex.encode), Effect.orDie);
    return {
      ...output,
      transport_evidence: {
        protocol: request.protocol,
        backend: "codex-t3" as const,
        provider_instance_id: request.provider_instance_id,
        model: request.model,
        auth_mode: "chatgpt-subscription-sharing" as const,
        account_fingerprint: accountFingerprint,
        tools_disabled: true as const,
        request_id: request.request_id,
        request_sha256,
        max_output_tokens_semantics: "result-acceptance-only" as const,
        generation_tokens_capped: false as const,
        ...(provider_request_id ? { provider_request_id } : {}),
      },
    };
  });
  return PatternReader.of({
    handle: Effect.fn("PatternReader.handleBounded")((payload) =>
      permit
        .withPermitsIfAvailable(1)(handle(payload))
        .pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new PatternReaderError({ code: "busy" })),
              onSome: Effect.succeed,
            }),
          ),
          Effect.timeoutOrElse({
            duration: PATTERN_READER_TIMEOUT_MS,
            orElse: () => Effect.fail(new PatternReaderError({ code: "timeout" })),
          }),
        ),
    ),
  });
});

export const layer = (accountFingerprint: string) =>
  Layer.effect(PatternReader, make(accountFingerprint));
