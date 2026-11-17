import {
  PATTERN_READER_MODEL,
  PATTERN_READER_PROTOCOL,
  PATTERN_READER_PROVIDER,
  PATTERN_READER_OUTPUT_BYTES,
  PatternReaderError,
  type PatternReaderRequest,
} from "@t3tools/contracts";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as Sse from "effect/encoding/Sse";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import type { makeCodexChatGptAuth } from "./CodexChatGptAuth.ts";

const Catalog = Schema.Struct({
  models: Schema.Array(Schema.Struct({ slug: Schema.String, visibility: Schema.String })),
});
const Usage = Schema.Struct({
  input_tokens: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  output_tokens: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  total_tokens: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
const Completed = Schema.Struct({
  model: Schema.Literal(PATTERN_READER_MODEL),
  status: Schema.Literal("completed"),
  output: Schema.Array(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal("reasoning") }),
      Schema.Struct({
        type: Schema.Literal("message"),
        role: Schema.Literal("assistant"),
        status: Schema.Literal("completed"),
        content: Schema.Array(
          Schema.Struct({ type: Schema.Literal("output_text"), text: Schema.String }),
        ),
      }),
    ]),
  ),
  usage: Schema.optionalKey(Schema.NullOr(Usage)),
});
const Event = Schema.Struct({
  type: Schema.String,
  delta: Schema.optionalKey(Schema.String),
  response: Schema.optionalKey(Schema.Unknown),
  item: Schema.optionalKey(Schema.Struct({ type: Schema.String })),
});
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeCatalog = Schema.decodeEffect(Schema.fromJsonString(Catalog));
const decodeCompleted = Schema.decodeUnknownEffect(Completed);
const isReaderError = Schema.is(PatternReaderError);
const invalid = () => new PatternReaderError({ code: "invalid_response" });

// This factory is owned by CodexManagedRuntime. Credentials never cross its public methods.
export const make = Effect.fn("CodexManagedResponses.make")(function* (options: {
  readonly instanceId: string;
  readonly auth: Effect.Success<ReturnType<typeof makeCodexChatGptAuth>>;
}) {
  const http = yield* HttpClient.HttpClient;
  const digest = yield* Digest.Digest;
  const fingerprint = (clientId: string) =>
    digest
      .digest(
        Digest.sha256,
        new TextEncoder().encode(
          JSON.stringify([PATTERN_READER_PROTOCOL, options.instanceId, clientId]),
        ),
      )
      .pipe(Effect.map(Hex.encode), Effect.orDie);

  const authorize = Effect.fn("CodexManagedResponses.authorize")(function* (expected: string) {
    if (options.instanceId !== PATTERN_READER_PROVIDER)
      return yield* new PatternReaderError({ code: "not_configured" });
    const saved = yield* options.auth.read.pipe(
      Effect.mapError(() => new PatternReaderError({ code: "authentication_failed" })),
    );
    if (
      Option.isNone(saved) ||
      !saved.value.scopes.includes("chatgpt.tokens.use.direct") ||
      (yield* fingerprint(saved.value.clientId)) !== expected
    ) {
      return yield* new PatternReaderError({ code: "authentication_failed" });
    }
    const credentials = yield* options.auth.access.pipe(
      Effect.mapError(() => new PatternReaderError({ code: "authentication_failed" })),
    );
    if (
      !credentials.scopes.includes("chatgpt.tokens.use.direct") ||
      (yield* fingerprint(credentials.clientId)) !== expected ||
      (yield* options.auth.profileKey(saved.value)) !==
        (yield* options.auth.profileKey(credentials))
    ) {
      return yield* new PatternReaderError({ code: "authentication_failed" });
    }
    return credentials;
  });
  const checkStatus = (status: number) =>
    status === 200
      ? Effect.void
      : Effect.fail(
          new PatternReaderError({
            code:
              status === 401 || status === 403
                ? "authentication_failed"
                : status === 429
                  ? "rate_limited"
                  : "provider_failed",
          }),
        );
  const discover = Effect.fn("CodexManagedResponses.discover")(function* (accessToken: string) {
    const response = yield* http.execute(
      HttpClientRequest.get("https://api.openai.com/v1/models").pipe(
        HttpClientRequest.bearerToken(accessToken),
      ),
    );
    yield* checkStatus(response.status);
    let bytes = 0;
    const text = yield* response.stream.pipe(
      Stream.mapEffect((chunk) => {
        bytes += chunk.byteLength;
        return bytes > 256 * 1024 ? Effect.fail(invalid()) : Effect.succeed(chunk);
      }),
      Stream.decodeText,
      Stream.mkString,
    );
    const catalog = yield* decodeCatalog(text);
    if (
      !catalog.models.some(
        (model) => model.slug === PATTERN_READER_MODEL && model.visibility === "list",
      )
    ) {
      return yield* new PatternReaderError({ code: "not_configured" });
    }
  });
  const execute = Effect.fn("CodexManagedResponses.execute")(function* (
    request: PatternReaderRequest,
    outputSchema?: Schema.Codec<unknown>,
  ) {
    const credentials = yield* authorize(request.account_fingerprint);
    yield* discover(credentials.accessToken);
    // Revalidate after discovery: never infer with a profile that changed during the probe.
    const current = yield* authorize(request.account_fingerprint);
    if (
      (yield* options.auth.profileKey(current)) !== (yield* options.auth.profileKey(credentials))
    ) {
      return yield* new PatternReaderError({ code: "authentication_failed" });
    }
    if (request.operation === "status") return {};
    if (!outputSchema) return yield* invalid();
    const body = {
      model: PATTERN_READER_MODEL,
      instructions: request.instructions,
      input: [{ role: "user", content: [{ type: "input_text", text: request.input_text }] }],
      text: {
        format: {
          type: "json_schema",
          name: "pattern_reading",
          strict: true,
          schema: request.json_schema,
        },
      },
      tools: [],
      tool_choice: "none",
      store: false,
      stream: true,
    };
    // Subscription sharing rejects max_output_tokens; it is a result acceptance limit only.
    const response = yield* http.execute(
      HttpClientRequest.post("https://api.openai.com/v1/responses").pipe(
        HttpClientRequest.bearerToken(current.accessToken),
        HttpClientRequest.bodyJsonUnsafe(body),
      ),
    );
    yield* checkStatus(response.status);
    if (!response.headers["content-type"]?.startsWith("text/event-stream")) return yield* invalid();
    let bytes = 0;
    let outputBytes = 0;
    let completed: typeof Completed.Type | undefined;
    yield* response.stream.pipe(
      Stream.mapEffect((chunk) => {
        bytes += chunk.byteLength;
        return bytes > 2 * 1024 * 1024 ? Effect.fail(invalid()) : Effect.succeed(chunk);
      }),
      Stream.decodeText,
      Stream.pipeThroughChannel(Sse.decode({ maxEventSize: 1024 * 1024 })),
      Stream.mapEffect((frame) =>
        Effect.gen(function* () {
          const event = yield* decodeJson(frame.data).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Event)),
          );
          if (
            event.type === "error" ||
            event.type === "response.failed" ||
            event.type === "response.incomplete"
          )
            return yield* new PatternReaderError({ code: "provider_failed" });
          if (event.item && !["reasoning", "message"].includes(event.item.type))
            return yield* invalid();
          if (
            /function_call|custom_tool|web_search|mcp|computer|file_search|code_interpreter/u.test(
              event.type,
            )
          )
            return yield* invalid();
          if (event.type === "response.output_text.delta") {
            outputBytes += new TextEncoder().encode(event.delta ?? "").length;
            if (outputBytes > PATTERN_READER_OUTPUT_BYTES) return yield* invalid();
          }
          if (event.type === "response.completed")
            completed = yield* decodeCompleted(event.response);
        }),
      ),
      Stream.takeUntil(() => completed !== undefined),
      Stream.runDrain,
    );
    if (!completed) return yield* invalid();
    if (
      completed.usage?.output_tokens !== undefined &&
      completed.usage.output_tokens > request.max_output_tokens
    )
      return yield* invalid();
    const texts = completed.output.flatMap((item) =>
      item.type === "message" ? item.content.map((part) => part.text) : [],
    );
    if (
      texts.length !== 1 ||
      new TextEncoder().encode(texts[0]!).length > PATTERN_READER_OUTPUT_BYTES
    )
      return yield* invalid();
    const output = yield* decodeJson(texts[0]!);
    if (!output || typeof output !== "object" || Array.isArray(output)) return yield* invalid();
    const pending = [{ value: output as unknown, depth: 0 }];
    let nodes = 0;
    while (pending.length) {
      const next = pending.pop()!;
      if (++nodes > 32_768 || next.depth > 64) return yield* invalid();
      if (next.value && typeof next.value === "object") {
        for (const value of Object.values(next.value))
          pending.push({ value, depth: next.depth + 1 });
      }
    }
    yield* Schema.decodeEffect(outputSchema, { onExcessProperty: "error" })(output);
    yield* authorize(request.account_fingerprint);
    const requestId = response.headers["x-request-id"];
    return {
      output_json: output,
      usage: completed.usage ?? null,
      ...(requestId && /^[a-zA-Z0-9_-]{1,128}$/u.test(requestId)
        ? { provider_request_id: requestId }
        : {}),
    };
  });
  return {
    execute: (request: PatternReaderRequest, outputSchema?: Schema.Codec<unknown>) =>
      options.auth.controller.withAccess!(execute(request, outputSchema)).pipe(
        Effect.scoped,
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.catchTags({
          SchemaError: () => Effect.fail(invalid()),
          SseError: () => Effect.fail(invalid()),
        }),
        Effect.mapError((error) =>
          isReaderError(error) ? error : new PatternReaderError({ code: "provider_failed" }),
        ),
      ),
  };
});
