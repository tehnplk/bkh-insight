// รัน: node --test src/app/api/fund/uc-debtor/detail/rep-detail.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { codesToExplain, groupFundAmounts } from "./rep-detail.ts";

test("fund_amounts grouped by first ' / ' segment, ungrouped keys last under อื่นๆ", () => {
  const groups = groupFundAmounts({
    "base rate สุทธิ": 8350,
    "ผู้ป่วยใน (IP) / IPINRGR": "12000.50",
    "โรคเฉพาะ (DMIS) / CATARACT / ค่าภาระงาน(รพ.)": 2000,
    "DRUG": 30,
    "อวัยวะเทียม/อุปกรณ์บำบัดรักษา (INST) / OPINST": 500,
    "ผู้ป่วยใน (IP) / IP-ONTOP": 100,
  });
  assert.deepEqual(groups, [
    { group: "ผู้ป่วยใน (IP)", items: [{ label: "IPINRGR", amount: 12000.5 }, { label: "IP-ONTOP", amount: 100 }] },
    { group: "โรคเฉพาะ (DMIS)", items: [{ label: "CATARACT / ค่าภาระงาน(รพ.)", amount: 2000 }] },
    { group: "อวัยวะเทียม/อุปกรณ์บำบัดรักษา (INST)", items: [{ label: "OPINST", amount: 500 }] },
    { group: "อื่นๆ", items: [{ label: "base rate สุทธิ", amount: 8350 }, { label: "DRUG", amount: 30 }] },
  ]);
  assert.deepEqual(groupFundAmounts(null), []);
});

test("DENY expands to non-C deny values; C-only deny keeps DENY; no duplicates", () => {
  assert.deepEqual(codesToExplain(["305", "DENY"], { "Deny / AE": "C", "Deny / INST": "I04", "Deny / HC": "D179" }), ["305", "I04", "D179"]);
  assert.deepEqual(codesToExplain(["DENY"], { "Deny / AE": "C" }), ["DENY"]);
  assert.deepEqual(codesToExplain(["DENY"], null), ["DENY"]);
  assert.deepEqual(codesToExplain(["D179", "DENY"], { "Deny / AE": "D179" }), ["D179"]);
  assert.deepEqual(codesToExplain([], { "Deny / AE": "D179" }), []);
});
