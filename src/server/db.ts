import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const dbPath = path.resolve(process.cwd(), "data", "homeassistant.db");

// Ensure data dir exists
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

export const db = new Database(dbPath);
const SECRET_HASH_PREFIX = "scrypt";
const SECRET_HASH_LENGTH = 64;

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
      debug_code TEXT DEFAULT NULL,
      debug_enabled INTEGER DEFAULT 0,
      endpoint TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      test_params TEXT DEFAULT '{}',
      trigger_config TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS debug_access_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      whitelist_json TEXT NOT NULL DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    db.exec("ALTER TABLE scripts ADD COLUMN test_params TEXT DEFAULT '{}'");
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec("ALTER TABLE scripts ADD COLUMN trigger_config TEXT DEFAULT '{}'");
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec("ALTER TABLE scripts ADD COLUMN debug_code TEXT DEFAULT NULL");
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec("ALTER TABLE scripts ADD COLUMN debug_enabled INTEGER DEFAULT 0");
  } catch (e) {
    // Column already exists
  }

  db.prepare(
    "INSERT OR IGNORE INTO debug_access_settings (id, enabled, whitelist_json) VALUES (1, 0, '[]')",
  ).run();
}

export function getServiceAccounts() {
  return db.prepare("SELECT id, name, created_at FROM service_accounts").all();
}

export function createServiceAccount(id: string, name: string, apiKey: string) {
  const hashedApiKey = hashServiceSecret(apiKey);
  const stmt = db.prepare("INSERT INTO service_accounts (id, name, api_key) VALUES (?, ?, ?)");
  stmt.run(id, name, hashedApiKey);
}

export function deleteServiceAccount(id: string) {
  const stmt = db.prepare("DELETE FROM service_accounts WHERE id = ?");
  stmt.run(id);
}

export function verifyApiKey(apiKey: string) {
  const rows = db.prepare("SELECT id, name, api_key FROM service_accounts").all() as Array<{
    id: string;
    name: string;
    api_key: string;
  }>;
  for (const row of rows) {
    if (verifyStoredSecret(row.api_key, apiKey)) {
      maybeMigrateSecret(row.id, row.api_key, apiKey);
      return { id: row.id, name: row.name };
    }
  }
  return undefined;
}

export function verifyServiceCredentials(id: string, secret: string) {
  const row = db.prepare("SELECT id, name, api_key FROM service_accounts WHERE id = ?").get(id) as
    | { id: string; name: string; api_key: string }
    | undefined;
  if (!row) return undefined;
  if (!verifyStoredSecret(row.api_key, secret)) return undefined;
  maybeMigrateSecret(row.id, row.api_key, secret);
  return { id: row.id, name: row.name };
}

export function getServiceAccountById(id: string) {
  return db.prepare("SELECT id, name FROM service_accounts WHERE id = ?").get(id) as
    | { id: string; name: string }
    | undefined;
}

export function getScripts() {
  return db.prepare("SELECT id, name, endpoint, created_at, trigger_config, debug_enabled FROM scripts").all();
}

export function getScriptById(id: string) {
  return db.prepare("SELECT * FROM scripts WHERE id = ?").get(id);
}

export function getScriptByEndpoint(endpoint: string) {
  return db.prepare("SELECT * FROM scripts WHERE endpoint = ?").get(endpoint);
}

export function createScript(
  id: string,
  name: string,
  code: string,
  endpoint: string,
  testParams: string = '{}',
  triggerConfig: string = '{}',
  debugCode: string | null = null,
  debugEnabled: boolean = false
) {
  const stmt = db.prepare("INSERT INTO scripts (id, name, code, debug_code, debug_enabled, endpoint, test_params, trigger_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  stmt.run(id, name, code, debugCode, debugEnabled ? 1 : 0, endpoint, testParams, triggerConfig);
}

export function updateScript(
  id: string,
  name: string,
  code: string,
  endpoint: string,
  testParams: string = '{}',
  triggerConfig: string = '{}'
) {
  const stmt = db.prepare("UPDATE scripts SET name = ?, code = ?, endpoint = ?, test_params = ?, trigger_config = ? WHERE id = ?");
  stmt.run(name, code, endpoint, testParams, triggerConfig, id);
}

export function updateScriptDebugCode(id: string, debugCode: string | null) {
  const stmt = db.prepare("UPDATE scripts SET debug_code = ? WHERE id = ?");
  stmt.run(debugCode, id);
}

export function updateScriptDebugMode(id: string, enabled: boolean) {
  const stmt = db.prepare("UPDATE scripts SET debug_enabled = ? WHERE id = ?");
  stmt.run(enabled ? 1 : 0, id);
}

export function deleteScript(id: string) {
  const stmt = db.prepare("DELETE FROM scripts WHERE id = ?");
  stmt.run(id);
}

export function getScriptsWithTriggerConfigs() {
  return db.prepare("SELECT id, name, endpoint, code, debug_code, debug_enabled, trigger_config FROM scripts").all();
}

export function getDebugAccessSettings() {
  const row = db
    .prepare("SELECT enabled, whitelist_json, updated_at FROM debug_access_settings WHERE id = 1")
    .get() as { enabled: number; whitelist_json: string; updated_at: string } | undefined;
  let whitelist: string[] = [];
  if (row?.whitelist_json) {
    try {
      const parsed = JSON.parse(row.whitelist_json);
      if (Array.isArray(parsed)) whitelist = parsed.filter((v) => typeof v === "string");
    } catch {
      whitelist = [];
    }
  }
  return {
    enabled: Boolean(row?.enabled),
    whitelist,
    updatedAt: row?.updated_at || null,
  };
}

export function updateDebugAccessSettings(enabled: boolean, whitelist: string[]) {
  const cleanWhitelist = whitelist.map((v) => v.trim()).filter(Boolean);
  db.prepare(
    "UPDATE debug_access_settings SET enabled = ?, whitelist_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
  ).run(enabled ? 1 : 0, JSON.stringify(cleanWhitelist));
  return getDebugAccessSettings();
}

const hashServiceSecret = (secret: string) => {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, SECRET_HASH_LENGTH);
  return `${SECRET_HASH_PREFIX}$${salt.toString("hex")}$${hash.toString("hex")}`;
};

const isHashedSecret = (value: string) => value.startsWith(`${SECRET_HASH_PREFIX}$`);

const verifyStoredSecret = (storedValue: string, providedValue: string) => {
  if (isHashedSecret(storedValue)) {
    try {
      const parts = storedValue.split("$");
      if (parts.length !== 3) return false;
      const saltHex = parts[1];
      const hashHex = parts[2];
      const salt = Buffer.from(saltHex, "hex");
      const expectedHash = Buffer.from(hashHex, "hex");
      if (salt.length === 0 || expectedHash.length === 0) return false;
      const actualHash = scryptSync(providedValue, salt, expectedHash.length);
      return timingSafeEqual(expectedHash, actualHash);
    } catch {
      return false;
    }
  }

  const storedBuffer = Buffer.from(storedValue);
  const providedBuffer = Buffer.from(providedValue);
  if (storedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(storedBuffer, providedBuffer);
};

const maybeMigrateSecret = (id: string, storedValue: string, providedValue: string) => {
  if (isHashedSecret(storedValue)) return;
  const newHash = hashServiceSecret(providedValue);
  db.prepare("UPDATE service_accounts SET api_key = ? WHERE id = ?").run(newHash, id);
};
