// Minimal JSON-file persistence. Zero dependencies. Good enough for a
// prototype; swap for Feishu Bitable / Postgres behind the same interface later.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY = { jobs: [], candidates: [], reminders: [], calls: [], activities: [], chats: [], skills: [] };

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return { ...structuredClone(EMPTY), ...parsed }; // ensure new collections exist
  } catch {
    return structuredClone(EMPTY);
  }
}

let db = load();

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export const uid = (p = "id") => `${p}_${crypto.randomBytes(5).toString("hex")}`;
export const now = () => new Date().toISOString();

export function reset(seed) {
  db = seed ? structuredClone(seed) : structuredClone(EMPTY);
  persist();
  return db;
}

export function raw() {
  return db;
}

// generic collection helpers
export const col = (name) => ({
  all: () => db[name],
  find: (id) => db[name].find((r) => r.id === id),
  insert: (rec) => {
    const row = { id: uid(name.slice(0, 3)), created_at: now(), ...rec };
    db[name].push(row);
    persist();
    return row;
  },
  update: (id, patch) => {
    const row = db[name].find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch, { updated_at: now() });
    persist();
    return row;
  },
  remove: (id) => {
    const i = db[name].findIndex((r) => r.id === id);
    if (i === -1) return false;
    db[name].splice(i, 1);
    persist();
    return true;
  },
});

// activity log (audit trail for every AI action / stage move)
export function logActivity(entry) {
  db.activities.unshift({ id: uid("act"), at: now(), ...entry });
  db.activities = db.activities.slice(0, 200);
  persist();
}
