import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

describe("081_ProjectAttachedFolders", () => {
  it.effect("upgrades existing projects with an empty attached folder list", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 60 });
      yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, default_model_selection_json, scripts_json, created_at, updated_at) VALUES ('project-old', 'Old', '/studio', NULL, '[]', '2026-10-31', '2026-10-31')`;
      yield* runMigrations();
      const rows = yield* sql<{
        readonly workspace_root: string;
        readonly additional_workspace_roots_json: string;
      }>`SELECT workspace_root, additional_workspace_roots_json FROM projection_projects WHERE project_id = 'project-old'`;
      assert.equal(rows[0]?.workspace_root, "/studio");
      assert.equal(rows[0]?.additional_workspace_roots_json, "[]");
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
  it.effect.each([61, 77, 80, 81])(
    "upgrades fork migration %s without losing attached folders",
    (legacyId) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: legacyId - 1 });
        yield* sql`ALTER TABLE projection_projects ADD COLUMN additional_workspace_roots_json TEXT NOT NULL DEFAULT '[]'`;
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${legacyId}, 'ProjectAttachedFolders')`;
        yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, additional_workspace_roots_json, default_model_selection_json, scripts_json, created_at, updated_at) VALUES ('attached', 'Attached', '/studio', '["/admin","/docs"]', NULL, '[]', '2026-10-31', '2026-10-31')`;
        yield* runMigrations();
        const projects = yield* sql<{
          readonly additional_workspace_roots_json: string;
        }>`SELECT additional_workspace_roots_json FROM projection_projects WHERE project_id = 'attached'`;
        const history = yield* sql<{
          readonly migration_id: number;
          readonly name: string;
        }>`SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id IN (61, 77, 80, 81, 82) ORDER BY migration_id`;
        assert.equal(projects[0]?.additional_workspace_roots_json, '["/admin","/docs"]');
        assert.deepEqual(history, [
          { migration_id: 61, name: "PullRequestReviewGuides" },
          { migration_id: 77, name: "RepairBooleanSettledOverride" },
          { migration_id: 80, name: "ScheduledTaskThreadMode" },
          { migration_id: 81, name: "ProjectAttachedFolders" },
          { migration_id: 82, name: "ProjectionMessageSearchText" },
        ]);
        const messageColumns = yield* sql<{
          readonly name: string;
        }>`PRAGMA table_info(orchestration_v2_projection_messages)`;
        assert.isTrue(messageColumns.some((column) => column.name === "search_text"));
        assert.deepEqual(yield* runMigrations(), []);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
