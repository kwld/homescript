import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = path.resolve(process.cwd(), "data", "homeassistant.db");

// Ensure data dir exists
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

export const db = new Database(dbPath);

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      test_params TEXT DEFAULT '{}'
    );
  `);

  try {
    db.exec("ALTER TABLE scripts ADD COLUMN test_params TEXT DEFAULT '{}'");
  } catch (e) {
    // Column already exists
  }
}

export function getServiceAccounts() {
  return db.prepare("SELECT id, name, created_at FROM service_accounts").all();
}

export function createServiceAccount(id: string, name: string, apiKey: string) {
  const stmt = db.prepare("INSERT INTO service_accounts (id, name, api_key) VALUES (?, ?, ?)");
  stmt.run(id, name, apiKey);
}

export function deleteServiceAccount(id: string) {
  const stmt = db.prepare("DELETE FROM service_accounts WHERE id = ?");
  stmt.run(id);
}

export function verifyApiKey(apiKey: string) {
  const stmt = db.prepare("SELECT id, name FROM service_accounts WHERE api_key = ?");
  return stmt.get(apiKey);
}

export function getScripts() {
  return db.prepare("SELECT id, name, endpoint, created_at FROM scripts").all();
}

export function getScriptById(id: string) {
  return db.prepare("SELECT * FROM scripts WHERE id = ?").get(id);
}

export function getScriptByEndpoint(endpoint: string) {
  return db.prepare("SELECT * FROM scripts WHERE endpoint = ?").get(endpoint);
}

export function createScript(id: string, name: string, code: string, endpoint: string, testParams: string = '{}') {
  const stmt = db.prepare("INSERT INTO scripts (id, name, code, endpoint, test_params) VALUES (?, ?, ?, ?, ?)");
  stmt.run(id, name, code, endpoint, testParams);
}

export function updateScript(id: string, name: string, code: string, endpoint: string, testParams: string = '{}') {
  const stmt = db.prepare("UPDATE scripts SET name = ?, code = ?, endpoint = ?, test_params = ? WHERE id = ?");
  stmt.run(name, code, endpoint, testParams, id);
}

export function deleteScript(id: string) {
  const stmt = db.prepare("DELETE FROM scripts WHERE id = ?");
  stmt.run(id);
}
