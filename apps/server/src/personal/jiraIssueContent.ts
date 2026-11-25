import type { IssueActor, JiraIssueContext } from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";

import { jiraDocument } from "./jiraDocument.ts";
import { httpsBrowserUrl } from "./JiraTicketWork.ts";
import { JIRA_HOST } from "./SensoneoJira.ts";

const record = (v: unknown): Record<string, unknown> => (Predicate.isObject(v) ? v : {});
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const array = (v: unknown) => (Array.isArray(v) ? v : []);
const name = (v: unknown) => text(record(v).name);
const names = (v: unknown) => array(v).flatMap((item) => name(item) ?? []);

export const JIRA_DETAIL_FIELDS = [
  "description",
  "project",
  "issuetype",
  "priority",
  "reporter",
  "duedate",
  "resolution",
  "components",
  "versions",
  "parent",
  "subtasks",
  "issuelinks",
  "attachment",
  "customfield_10020",
  "customfield_10151",
  "customfield_10014",
  "customfield_10028",
  "customfield_10021",
  "customfield_10209",
  "customfield_10210",
  "customfield_10211",
  "customfield_10212",
  "customfield_10081",
];

const customNames: Record<string, string> = {
  customfield_10020: "Sprint",
  customfield_10151: "Product",
  customfield_10014: "Epic",
  customfield_10028: "Story points",
  customfield_10021: "Flagged",
  customfield_10209: "Reproduction steps",
  customfield_10210: "Actual result",
  customfield_10211: "Expected result",
  customfield_10212: "User role",
  customfield_10081: "Environment",
};

function fieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(fieldValue).filter(Boolean).join(", ");
  const entry = record(value);
  if (entry.type === "doc") return jiraDocument(entry);
  return text(entry.name) ?? text(entry.value) ?? text(entry.displayName) ?? "";
}

function actor(value: unknown): IssueActor | null {
  const person = record(value);
  const login = text(person.accountId);
  return login
    ? {
        login,
        name: text(person.displayName),
        avatarUrl: httpsBrowserUrl(text(record(person.avatarUrls)["24x24"])) ?? null,
      }
    : null;
}

function related(value: unknown) {
  const issue = record(value);
  const key = text(issue.key);
  if (!key || !/^[A-Z][A-Z0-9]*-\d+$/u.test(key)) return null;
  const fields = record(issue.fields);
  return {
    key,
    title: text(fields.summary) ?? key,
    state: name(fields.status) ?? "",
    url: `https://${JIRA_HOST}/browse/${key}`,
  };
}

export function jiraIssueContent(value: unknown): { body: string; jiraDetails: JiraIssueContext } {
  const issue = record(value);
  const fields = record(issue.fields);
  const fieldNames = record(issue.names);
  const relatedIssues = array(fields.issuelinks).flatMap((link) => {
    const item = record(link);
    const inward = item.inwardIssue !== undefined;
    const target = related(inward ? item.inwardIssue : item.outwardIssue);
    return target
      ? [
          {
            ...target,
            relationship: text(record(item.type)[inward ? "inward" : "outward"]) ?? "Related",
          },
        ]
      : [];
  });
  return {
    body: jiraDocument(fields.description),
    jiraDetails: {
      projectName: name(fields.project),
      issueType: name(fields.issuetype),
      priority: name(fields.priority),
      reporter: actor(fields.reporter),
      dueDate: text(fields.duedate),
      resolution: name(fields.resolution),
      components: names(fields.components),
      affectedVersions: names(fields.versions),
      parent: related(fields.parent),
      relatedIssues: [
        ...array(fields.subtasks).flatMap((item) => {
          const child = related(item);
          return child ? [{ ...child, relationship: "Subtask" }] : [];
        }),
        ...relatedIssues,
      ],
      attachments: array(fields.attachment).flatMap((item) => {
        const file = record(item);
        const id = text(file.id);
        const filename = text(file.filename);
        const url = httpsBrowserUrl(text(file.content));
        return id && filename && url
          ? [
              {
                id,
                name: filename,
                url,
                mimeType: text(file.mimeType),
                size:
                  typeof file.size === "number" && Number.isSafeInteger(file.size) && file.size >= 0
                    ? file.size
                    : 0,
              },
            ]
          : [];
      }),
      fields: Object.entries(customNames).flatMap(([key, fallback]) => {
        const value = fieldValue(fields[key]).trim().slice(0, 40_000);
        return value ? [{ id: key, name: text(fieldNames[key]) ?? fallback, value }] : [];
      }),
    },
  };
}
