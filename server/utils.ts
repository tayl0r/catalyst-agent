import fs from "fs";
import crypto from "crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidId(id: string): boolean {
  return UUID_RE.test(id);
}

export function atomicWrite(filePath: string, data: string): void {
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, filePath);
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}
