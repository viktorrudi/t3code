import { describe, expect, it } from "vite-plus/test";
import { filePathWithinFolder, folderFilePath } from "./workspaceFolders";

describe("attached folder file identity", () => {
  it("keeps primary paths relative and attached paths unambiguous", () => {
    expect(folderFilePath("/studio", "src/app.ts", "/studio")).toBe("src/app.ts");
    expect(folderFilePath("/admin", "src/app.ts", "/studio")).toBe("/admin/src/app.ts");
    expect(filePathWithinFolder("/admin", "/admin/src/app.ts")).toBe("src/app.ts");
    expect(filePathWithinFolder("/admin", "/administrator/secrets")).toBeNull();
  });
  it("resolves drive paths and filesystem roots", () => {
    expect(filePathWithinFolder("C:\\Admin", "c:\\admin\\src\\app.ts")).toBe("src\\app.ts");
    expect(folderFilePath("C:\\Admin", "app.ts", "C:\\Studio")).toBe("C:\\Admin\\app.ts");
    expect(filePathWithinFolder("/", "/app.ts")).toBe("app.ts");
  });
});
