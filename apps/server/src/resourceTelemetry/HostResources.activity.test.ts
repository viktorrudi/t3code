import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { readWorkingAgentCount } from "./HostResources.activity.ts";

it.effect(
  "counts local executing turns once across projects, excluding queued, waiting, completed and superseded attempts",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.strictEqual(yield* readWorkingAgentCount(), 0);
      for (const [id, status, turnStatus, attempt] of [
        ["parent", "running", "running", "parent"],
        ["child", "running", "running", "child"],
        ["queued", "queued", "pending", "queued"],
        ["waiting", "waiting", "completed", "waiting"],
        ["done", "completed", "completed", "done"],
        ["approval", "running", "running", "approval"],
        ["input", "running", "running", "input"],
        ["superseded", "running", "running", "new-attempt"],
      ]) {
        yield* sql`INSERT INTO orchestration_v2_projection_runs
      (run_id,thread_id,ordinal,provider,status,requested_at,payload_json)
      VALUES (${id},${id},1,'codex',${status},'2026-11-25T00:00:00Z',${JSON.stringify({ activeAttemptId: attempt })})`;
        yield* sql`INSERT INTO orchestration_v2_projection_run_attempts
      (attempt_id,thread_id,run_id,attempt_ordinal,root_node_id,provider,provider_thread_id,status,payload_json)
      VALUES (${id},${id},${id},1,${id},'codex',${id},'running','{}')`;
        yield* sql`INSERT INTO orchestration_v2_projection_nodes
      (node_id,thread_id,run_id,root_node_id,kind,status,provider_turn_id,payload_json)
      VALUES (${id},${id},${id},${id},'provider_turn','running',${id},'{}')`;
        yield* sql`INSERT INTO orchestration_v2_projection_provider_turns
      (provider_turn_id,thread_id,provider_thread_id,node_id,run_attempt_id,ordinal,status,payload_json)
      VALUES (${id},${id},${id},${id},${id},1,${turnStatus},'{}')`;
      }
      for (const [id, kind] of [
        ["approval", "permission"],
        ["input", "user_input"],
      ]) {
        yield* sql`INSERT INTO orchestration_v2_projection_runtime_requests
      (runtime_request_id,thread_id,node_id,provider_turn_id,kind,status,created_at,payload_json)
      VALUES (${id},${id},${id},${id},${kind},'pending','2026-11-25T00:00:00Z','{}')`;
      }
      // A second provider-turn row for one running run cannot count the same agent twice.
      yield* sql`INSERT INTO orchestration_v2_projection_nodes
    (node_id,thread_id,run_id,root_node_id,kind,status,provider_turn_id,payload_json)
    VALUES ('duplicate','parent','parent','parent','provider_turn','running','duplicate','{}')`;
      yield* sql`INSERT INTO orchestration_v2_projection_provider_turns
    (provider_turn_id,thread_id,provider_thread_id,node_id,run_attempt_id,ordinal,status,payload_json)
    VALUES ('duplicate','parent','parent','duplicate','parent',2,'running','{}')`;
      assert.strictEqual(yield* readWorkingAgentCount(), 2);
      const item = {
        id: "wait",
        threadId: "parent",
        runId: "parent",
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "running",
        title: null,
        startedAt: null,
        completedAt: null,
        updatedAt: "2026-11-25T00:00:00Z",
        type: "dynamic_tool",
        toolName: "mcp__t3_code__t3_thread_wait",
        input: { threadId: "child" },
      };
      yield* sql`INSERT INTO orchestration_v2_projection_turn_items
    (turn_item_id,thread_id,run_id,ordinal,type,status,updated_at,payload_json)
    VALUES ('wait','parent','parent',1,'dynamic_tool','running','2026-11-25T00:00:00Z',${JSON.stringify(item)})`;
      assert.strictEqual(yield* readWorkingAgentCount(), 1);
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
