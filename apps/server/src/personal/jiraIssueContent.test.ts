import { describe, expect, it } from "@effect/vitest";
import { jiraDocument } from "./jiraDocument.ts";
import { jiraIssueContent } from "./jiraIssueContent.ts";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value: string) => ({ type: "paragraph", content: [text(value)] });

describe("Jira issue content", () => {
  it("preserves rich descriptions, nested lists, tables and code while rejecting active markup", () => {
    expect(
      jiraDocument({
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [text("Acceptance")] },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  paragraph("First"),
                  {
                    type: "bulletList",
                    content: [{ type: "listItem", content: [paragraph("Nested")] }],
                  },
                ],
              },
            ],
          },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [{ type: "tableHeader", content: [paragraph("Name")] }],
              },
              { type: "tableRow", content: [{ type: "tableCell", content: [paragraph("A|B")] }] },
            ],
          },
          {
            type: "codeBlock",
            attrs: { language: "js" },
            content: [text("const x = `ok`;\n``` ")],
          },
          {
            type: "paragraph",
            content: [
              {
                ...text("<script>unsafe</script>"),
                marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
              },
            ],
          },
        ],
      }),
    ).toBe(
      "## Acceptance\n\n- First\n  \n  - Nested\n\n| Name |\n| --- |\n| A\\|B |\n\n````js\nconst x = `ok`;\n```\n````\n\n\\<script\\>unsafe\\</script\\>",
    );
  });

  it("maps workflow context, bug fields, parent, subtasks and safe attachments without raw Jira metadata", () => {
    const result = jiraIssueContent({
      names: { customfield_10209: "Steps to reproduce" },
      fields: {
        description: { type: "doc", content: [paragraph("Expected result")] },
        project: { name: "RetuRO" },
        issuetype: { name: "Bug" },
        priority: { name: "High" },
        reporter: {
          accountId: "abc",
          displayName: "Reporter",
          avatarUrls: { "24x24": "https://avatar.test/a" },
        },
        parent: { key: "RET-12", fields: { summary: "Parent", status: { name: "In progress" } } },
        subtasks: [{ key: "RET-14", fields: { summary: "Child" } }],
        issuelinks: [
          {
            type: { inward: "is blocked by" },
            inwardIssue: { key: "GRE-15", fields: { summary: "Dependency" } },
          },
        ],
        customfield_10209: { type: "doc", content: [paragraph("Click Export")] },
        customfield_10020: [{ name: "Sprint 12", self: "secret-url" }],
        customfield_10028: 0,
        attachment: [
          {
            id: "1",
            filename: "error.png",
            content: "https://sensoneosk.atlassian.net/attachment/1",
            size: 512,
            mimeType: "image/png",
          },
          { id: "2", filename: "bad", content: "javascript:alert(1)" },
        ],
      },
    });
    expect(result.body).toBe("Expected result");
    expect(result.jiraDetails).toMatchObject({
      projectName: "RetuRO",
      issueType: "Bug",
      priority: "High",
      parent: { key: "RET-12" },
      attachments: [{ name: "error.png", size: 512 }],
    });
    expect(result.jiraDetails.relatedIssues.map((item) => item.relationship)).toEqual([
      "Subtask",
      "is blocked by",
    ]);
    expect(result.jiraDetails.fields).toEqual([
      { name: "Sprint", value: "Sprint 12" },
      { name: "Story points", value: "0" },
      { name: "Steps to reproduce", value: "Click Export" },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-url");
    expect(jiraIssueContent({ fields: {} }).body).toBe("");
  });
});
