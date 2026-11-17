import * as Schema from "effect/Schema";

export const PATTERN_READER_PROTOCOL = "threadwise-reader-v1";
export const PATTERN_READER_PROVIDER = "codex_30ad432b-36a5-4f80-a1f1-0ef78d07c158";
export const PATTERN_READER_MODEL = "gpt-6.1-sol";
export const PATTERN_READER_FRAME_BYTES = 1_000_000;
export const PATTERN_READER_OUTPUT_BYTES = 256 * 1024;
export const PATTERN_READER_TIMEOUT_MS = 180_000;

const identity = {
  protocol: Schema.Literal(PATTERN_READER_PROTOCOL),
  provider_instance_id: Schema.Literal(PATTERN_READER_PROVIDER),
  model: Schema.Literal(PATTERN_READER_MODEL),
  account_fingerprint: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  request_id: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/u)),
};
export const PatternReaderRequest = Schema.Union([
  Schema.Struct({ ...identity, operation: Schema.Literal("status") }),
  Schema.Struct({
    ...identity,
    operation: Schema.Literal("generate"),
    instructions: Schema.String.check(Schema.isMaxLength(32_000)),
    input_text: Schema.String.check(Schema.isMaxLength(120_000)),
    json_schema: Schema.Record(Schema.String, Schema.Unknown),
    max_output_tokens: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8_000 })),
  }),
]);
export type PatternReaderRequest = typeof PatternReaderRequest.Type;

export const PatternReaderEvidence = Schema.Struct({
  ...identity,
  backend: Schema.Literal("codex-t3"),
  auth_mode: Schema.Literal("chatgpt-subscription-sharing"),
  tools_disabled: Schema.Literal(true),
  max_output_tokens_semantics: Schema.Literal("result-acceptance-only"),
  generation_tokens_capped: Schema.Literal(false),
  request_sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  provider_request_id: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/u)),
  ),
});
export type PatternReaderEvidence = typeof PatternReaderEvidence.Type;

export class PatternReaderError extends Schema.TaggedError<PatternReaderError>()(
  "PatternReaderError",
  {
    code: Schema.Literals([
      "not_configured",
      "authentication_failed",
      "rate_limited",
      "timeout",
      "busy",
      "invalid_response",
      "provider_failed",
    ]),
  },
) {
  override get message(): string {
    return "The private pattern reader request failed.";
  }
}
