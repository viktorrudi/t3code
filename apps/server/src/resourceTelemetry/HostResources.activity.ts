import { OrchestrationV2TurnItemJson, RunId } from "@t3tools/contracts";
import { deriveBlockedOnThreadWait } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export const readWorkingAgentCount = Effect.fn("HostResources.readWorkingAgentCount")(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      // Canonical local turns only; parent timeline subagent mirrors are not executions.
      const runs = yield* sql<{ readonly run_id: string; readonly thread_id: string }>`
      SELECT DISTINCT r.run_id, r.thread_id
      FROM orchestration_v2_projection_nodes n
        INDEXED BY orchestration_v2_projection_nodes_live_idx
      JOIN orchestration_v2_projection_provider_turns pt ON pt.provider_turn_id = n.provider_turn_id
      JOIN orchestration_v2_projection_run_attempts a ON a.attempt_id = pt.run_attempt_id
      JOIN orchestration_v2_projection_runs r ON r.run_id = a.run_id
      WHERE n.status IN ('pending', 'starting', 'running', 'waiting')
        AND pt.status = 'running' AND r.status = 'running'
        AND json_extract(r.payload_json, '$.activeAttemptId') = a.attempt_id
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_runtime_requests request
          WHERE request.thread_id = r.thread_id AND request.status = 'pending'
            AND request.kind NOT IN ('dynamic_tool_call', 'auth_refresh')
            AND EXISTS (
              SELECT 1 FROM orchestration_v2_projection_nodes request_node
              WHERE request_node.node_id = request.node_id AND request_node.run_id = r.run_id
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_turn_items item
          WHERE item.thread_id = r.thread_id AND item.run_id = r.run_id
            AND item.type IN ('secret_request', 'link_request') AND item.status = 'waiting'
        )
    `;
      if (runs.length === 0) return 0;
      const items = yield* sql<{ readonly payload_json: string }>`
      SELECT payload_json FROM orchestration_v2_projection_turn_items
      WHERE run_id IN ${sql.in(runs.map((run) => run.run_id))}
        AND type IN ('command_execution', 'dynamic_tool', 'subagent', 'file_change', 'file_search', 'web_search', 'compaction')
        AND status IN ('running', 'waiting')
    `;
      const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(OrchestrationV2TurnItemJson));
      const turnItems = yield* Effect.forEach(items, (item) => decode(item.payload_json));
      return runs.filter(
        (run) =>
          !deriveBlockedOnThreadWait({
            activeRun: { id: RunId.make(run.run_id), status: "running" },
            turnItems,
          }),
      ).length;
    }),
  );
});
