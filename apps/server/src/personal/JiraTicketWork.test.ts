import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as NodePath from "@effect/platform-node/NodePath";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { linkedJiraThreads } from "./JiraTicketWork.ts";
import { JIRA_HOST, ticketRoot } from "./SensoneoJira.ts";

const localEnvironment = EnvironmentId.make("local-environment");
const projectId = ProjectId.make("ticket-project");
const now = "2026-11-27T00:00:00.000Z";
const ref = (threadId: string, environmentId: string = localEnvironment) => ({
  environmentId,
  threadId,
});

function shell(id: ThreadId): OrchestrationV2ThreadShell {
  return {
    id,
    projectId: id === "wrong-project" ? ProjectId.make("unrelated-project") : projectId,
    title: id,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    latestRunId: null,
    activeRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: DateTime.makeUnsafe(now),
    updatedAt: DateTime.makeUnsafe(now),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
  };
}

const cases = [
  {
    name: "claims legacy links only through local thread and project existence",
    tracking: { threads: ["legacy", "missing", "wrong-project"] },
    expected: ["legacy"],
  },
  {
    name: "projects own scoped links without resolving another environment's IDs",
    tracking: { threads: ["scoped"], refs: [ref("scoped"), ref("foreign", "other-environment")] },
    expected: ["scoped"],
    notRead: ["foreign"],
  },
  {
    name: "treats an own scoped link without its legacy mirror as unlinked",
    tracking: { threads: [], refs: [ref("scoped")] },
    expected: [],
    notRead: ["scoped"],
  },
  {
    name: "does not reclaim a legacy ID explicitly scoped to another environment",
    tracking: { threads: ["collision"], refs: [ref("collision", "other-environment")] },
    expected: [],
    notRead: ["collision"],
  },
  {
    name: "does not reclaim an explicitly foreign unlinked ID",
    tracking: {
      threads: ["collision"],
      unlinkedRefs: [ref("collision", "other-environment")],
    },
    expected: [],
    notRead: ["collision"],
  },
  {
    name: "lets own scoped unlink override a legacy link and native relation",
    tracking: { threads: ["unlinked"], unlinkedRefs: [ref("unlinked")] },
    native: ["unlinked"],
    expected: [],
    notRead: ["unlinked"],
  },
  {
    name: "lets legacy unlink override an own scoped link",
    tracking: { threads: [], unlinked: ["unlinked"], refs: [ref("unlinked")] },
    expected: [],
  },
  {
    name: "keeps own and foreign identities distinct even with the same thread ID",
    tracking: {
      threads: ["collision"],
      refs: [ref("collision"), ref("collision", "other-environment")],
      unlinkedRefs: [ref("collision", "other-environment")],
    },
    expected: ["collision"],
  },
  {
    name: "preserves valid legacy and scoped links beside malformed new entries",
    tracking: {
      threads: ["legacy", "scoped"],
      refs: [null, ref("scoped"), { threadId: "unscoped" }, ref("", "other-environment")],
      unlinkedRefs: "malformed",
    },
    expected: ["legacy", "scoped"],
    notRead: ["unscoped"],
  },
  {
    name: "keeps native local relations independent of foreign tracking and deduplicates links",
    tracking: {
      threads: ["native"],
      refs: [ref("native", "other-environment"), ref("linked")],
    },
    native: ["native", "linked"],
    expected: ["linked", "native"],
  },
  {
    name: "keeps a native local relation beside a foreign unlink of the same ID",
    tracking: { threads: [], unlinkedRefs: [ref("native", "other-environment")] },
    native: ["native"],
    expected: ["native"],
  },
  {
    name: "retains native local relations when the tracking record is invalid",
    tracking: "invalid-json",
    native: ["native"],
    expected: ["native"],
  },
] as const;

it.effect.each(cases)("$name", (fixture) => {
  const reads: ThreadId[] = [];
  const project: OrchestrationProjectShell = {
    id: projectId,
    title: "Ticket project",
    workspaceRoot: `${ticketRoot()}/frontend`,
    defaultModelSelection: null,
    scripts: [],
    createdAt: now,
    updatedAt: now,
  };
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const id of "native" in fixture ? fixture.native : []) {
      yield* sql`
          INSERT INTO orchestration_v2_projection_threads (
            thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
            created_at, updated_at, payload_json
          ) VALUES (
            ${id}, ${projectId}, ${id}, 'codex', 'full-access', 'default', ${now}, ${now},
            ${JSON.stringify({
              issues: [{ tracker: "jira", host: JIRA_HOST, scope: "RET", key: "RET-45" }],
            })}
          )
        `;
    }
    const threads = yield* linkedJiraThreads("RET-45");
    expect(threads.map((thread) => thread.id).sort()).toEqual([...fixture.expected].sort());
    for (const id of "notRead" in fixture ? fixture.notRead : []) {
      expect(reads).not.toContain(id);
    }
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodePath.layer,
        SqlitePersistence.layerMemory,
        FileSystem.layerNoop({
          readFileString: () =>
            Effect.succeed(
              typeof fixture.tracking === "string"
                ? fixture.tracking
                : JSON.stringify(fixture.tracking),
            ),
        }),
        Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(localEnvironment),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadShell: (id) =>
            Effect.sync(() => {
              reads.push(id);
              return id === "missing" ? null : shell(id);
            }),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getShell: (id) => Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
        }),
      ),
    ),
  );
});
