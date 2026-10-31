import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("061_ProjectAttachedFolders", (it) => {
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
    }),
  );
});
