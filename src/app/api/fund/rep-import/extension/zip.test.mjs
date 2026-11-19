// รัน: node --test src/app/api/fund/rep-import/extension/zip.test.mjs (จาก root ของ repo, node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSZip from "jszip";
import { extensionZip } from "./zip.ts";

test("zip มีไฟล์ที่ Chrome ใช้ ไม่มี test/package.json และเวอร์ชันตรง manifest", async () => {
  const { version, data } = await extensionZip();
  const names = Object.keys((await JSZip.loadAsync(data)).files).sort();
  for (const f of ["manifest.json", "sw.js", "content.js", "README.md", "lib/sync.js", "lib/tab.js"]) assert.ok(names.includes(f), f);
  assert.ok(!names.some((n) => n.endsWith(".test.js") || n === "package.json"), names.join(","));
  assert.equal(version, JSON.parse(await readFile("extension/eclaim-sync/manifest.json", "utf8")).version);
});
