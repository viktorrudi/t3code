import {
  PatternReaderError,
  PatternReaderRequest,
  PATTERN_READER_FRAME_BYTES,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as JsonSchema from "effect/JsonSchema";
import * as Schema from "effect/Schema";
import * as SchemaRepresentation from "effect/SchemaRepresentation";

const decodeRequest = Schema.decodeSync(Schema.fromJsonString(PatternReaderRequest), {
  onExcessProperty: "error",
});
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const schemaKeywords = new Set([
  "type",
  "title",
  "description",
  "default",
  "$defs",
  "$ref",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "anyOf",
  "enum",
  "const",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
]);

// No remote references, regex execution, unknown constraints, or unbounded schema expansion.
const checkSchema = (
  value: unknown,
  depth = 0,
  budget = { nodes: 0 },
  definitions: Readonly<Record<string, unknown>> = {},
): void => {
  if (
    depth > 24 ||
    ++budget.nodes > 1024 ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("Unsupported schema");
  }
  for (const [key, child] of Object.entries(value)) {
    if (!schemaKeywords.has(key)) throw new Error("Unsupported keyword");
    if (
      key === "$ref" &&
      (typeof child !== "string" || !/^#\/\$defs\/[A-Za-z0-9_-]+$/u.test(child))
    ) {
      throw new Error("Unsupported reference");
    }
    if (key === "$ref") {
      checkSchema(definitions[(child as string).slice(8)], depth + 1, budget, definitions);
    }
    if (key === "pattern") {
      const node = value as Record<string, unknown>;
      // This bounded, unambiguous slug pattern is used by both pattern-reading callers.
      if (
        child !== "^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$" ||
        typeof node.maxLength !== "number" ||
        node.maxLength > 1024
      )
        throw new Error("Unsupported pattern");
    }
    if (key === "properties" || key === "$defs") {
      if (!child || typeof child !== "object" || Array.isArray(child))
        throw new Error("Invalid map");
      for (const entry of Object.values(child)) checkSchema(entry, depth + 1, budget, definitions);
    } else if (key === "items" || (key === "additionalProperties" && typeof child !== "boolean")) {
      checkSchema(child, depth + 1, budget, definitions);
    } else if (key === "anyOf") {
      if (!Array.isArray(child) || child.length < 1 || child.length > 8)
        throw new Error("Invalid union");
      for (const entry of child) checkSchema(entry, depth + 1, budget, definitions);
    }
  }
};

export const parsePatternReaderRequest = (payload: Uint8Array) =>
  Effect.try({
    try: () => {
      if (payload.byteLength > PATTERN_READER_FRAME_BYTES) throw new Error("Frame too large");
      const request = decodeRequest(new TextDecoder("utf-8", { fatal: true }).decode(payload));
      if (request.operation === "status") return { request, outputSchema: undefined };
      if (new TextEncoder().encode(encodeJson(request.json_schema)).length > 128 * 1024)
        throw new Error("Schema too large");
      if (request.json_schema.type !== "object") throw new Error("Object schema required");
      checkSchema(
        request.json_schema,
        0,
        { nodes: 0 },
        (request.json_schema.$defs ?? {}) as Readonly<Record<string, unknown>>,
      );
      const imported = SchemaRepresentation.fromJsonSchemaDocument(
        JsonSchema.fromSchemaDraft2020_12(request.json_schema),
        { patterns: "apply" },
      );
      const outputSchema = Schema.make<Schema.Codec<unknown>>(imported.ast);
      return { request, outputSchema };
    },
    catch: () => new PatternReaderError({ code: "invalid_response" }),
  });
