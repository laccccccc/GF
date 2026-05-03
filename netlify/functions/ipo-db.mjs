import { getStore } from "@netlify/blobs";
import initialRows from "./initial-data.mjs";

const STORE_NAME = "ipo-tool-db";
const DB_KEY = "rolling-database";
const VERSION = 1;
const WIDTH = 14;

const OUTPUT_HEADERS = [
  "",
  "公司中文名称",
  "公司英文名称",
  "交表日",
  "保荐人",
  "整体协调人",
  "公司律师",
  "保荐人律师",
  "地区",
  "行业",
  "主营业务",
  "最新年内收入\n（人民币千元）",
  "最新归母年内净利润\n（人民币千元）",
  "审核状态",
];

function json(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function cleanText(value) {
  return (value == null ? "" : String(value))
    .replace(/_x000D_/gi, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactText(value) {
  return cleanText(value).replace(/\s+/g, "");
}

function normalizeWidth(row, width = WIDTH) {
  const out = Array.isArray(row) ? row.slice(0, width) : [];
  while (out.length < width) out.push("");
  return out.map(cleanText);
}

function makeRowId(values, index) {
  return [
    "row",
    Date.now().toString(36),
    index,
    compactText(values[1] || values[2] || "blank").slice(0, 24),
  ].join("-");
}

function toRecords(rows, source = "database") {
  return rows.map((row, index) => {
    const rawValues = Array.isArray(row) ? row : row.values;
    const values = normalizeWidth(rawValues);
    values[0] = index + 1;
    return {
      id: Array.isArray(row) ? makeRowId(values, index) : row.id || makeRowId(values, index),
      seq: index + 1,
      values,
      source: Array.isArray(row) ? source : row.source || source,
      updatedAt: Array.isArray(row) ? new Date().toISOString() : row.updatedAt || new Date().toISOString(),
    };
  });
}

function seedDatabase() {
  return {
    version: VERSION,
    seedCount: initialRows.length,
    headers: OUTPUT_HEADERS,
    rows: toRecords(initialRows, "固定模板"),
    updatedAt: new Date().toISOString(),
  };
}

function getBlobStore() {
  return getStore(STORE_NAME);
}

async function readDatabase() {
  const store = getBlobStore();
  let db = await store.get(DB_KEY, { type: "json" });
  if (!db || !Array.isArray(db.rows)) {
    db = seedDatabase();
    await store.setJSON(DB_KEY, db);
  }
  db.rows = toRecords(db.rows);
  db.seedCount = db.seedCount || initialRows.length;
  db.headers = OUTPUT_HEADERS;
  return db;
}

async function writeDatabase(db) {
  const normalized = {
    version: VERSION,
    seedCount: db.seedCount || initialRows.length,
    headers: OUTPUT_HEADERS,
    rows: toRecords(db.rows || []),
    updatedAt: new Date().toISOString(),
  };
  await getBlobStore().setJSON(DB_KEY, normalized);
  return normalized;
}

function authFailure(request) {
  const required = process.env.IPO_DB_TOKEN;
  if (!required) return null;
  const provided = request.headers.get("x-ipo-db-token") || "";
  if (provided === required) return null;
  return json(401, { error: "管理密码不正确，未写入线上数据库。" });
}

function cleanupRows(rows) {
  const seenCn = new Set();
  const seenEn = new Set();
  const kept = [];
  const removed = [];

  rows.forEach((record) => {
    const values = normalizeWidth(record.values);
    const cn = cleanText(values[1]);
    const en = cleanText(values[2]);
    if ((cn && seenCn.has(cn)) || (en && seenEn.has(en))) {
      removed.push(record);
      return;
    }
    if (cn) seenCn.add(cn);
    if (en) seenEn.add(en);
    kept.push(record);
  });

  return { kept, removed };
}

function countDuplicateRows(rows) {
  const { removed } = cleanupRows(rows);
  return removed.length;
}

export default async function handler(request) {
  try {
    if (request.method === "GET") {
      const db = await readDatabase();
      return json(200, { ok: true, ...db, duplicateCount: countDuplicateRows(db.rows), writeProtected: !!process.env.IPO_DB_TOKEN });
    }

    if (request.method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const failure = authFailure(request);
    if (failure) return failure;

    const payload = await request.json().catch(() => ({}));
    const action = payload.action;
    const db = await readDatabase();

    if (action === "prepend") {
      const weeklyRows = Array.isArray(payload.rows) ? payload.rows : [];
      const weekly = toRecords(weeklyRows, "每周生成");
      const updated = await writeDatabase({ ...db, rows: weekly.concat(db.rows) });
      return json(200, {
        ok: true,
        added: weekly.length,
        rows: updated.rows,
        seedCount: updated.seedCount,
        updatedAt: updated.updatedAt,
        warning: process.env.IPO_DB_TOKEN ? "" : "未设置 IPO_DB_TOKEN，任何访问者都可以写入数据库。",
      });
    }

    if (action === "cleanup") {
      const { kept, removed } = cleanupRows(db.rows);
      const updated = await writeDatabase({ ...db, rows: kept });
      return json(200, {
        ok: true,
        removed: removed.length,
        rows: updated.rows,
        seedCount: updated.seedCount,
        updatedAt: updated.updatedAt,
      });
    }

    if (action === "reset") {
      const updated = await writeDatabase(seedDatabase());
      return json(200, {
        ok: true,
        reset: true,
        rows: updated.rows,
        seedCount: updated.seedCount,
        updatedAt: updated.updatedAt,
      });
    }

    return json(400, { error: "Unknown action" });
  } catch (error) {
    return json(500, { error: error.message || String(error) });
  }
}
