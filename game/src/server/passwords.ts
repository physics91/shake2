// Account passwords, kept as scrypt hashes (node:crypto). The original sent them in the clear to
// its auth server and what it kept is not known; this is the remake's (R).
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_BYTES = 32;
const SALT_BYTES = 16;
/** scrypt's cost: N = 2^14, r = 8, p = 1 (about 16 MiB and a few tens of ms a check). */
const COST = { N: 16384, r: 8, p: 1 } as const;

function derive(password: string, salt: Buffer, cost: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFC"), salt, KEY_BYTES, { ...cost, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** "scrypt$N$r$p$salt$key", salt and key in base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Whether `stored` is a hash this module could have made. */
export function isPasswordHash(stored: unknown): stored is string {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  return parts.length === 6 && parts[0] === "scrypt" && parts.slice(1, 4).every((n) => /^\d{1,6}$/.test(n));
}

/** Whether `password` is the one `stored` was made from; a malformed hash matches nothing. */
export async function checkPassword(password: string, stored: string): Promise<boolean> {
  if (!isPasswordHash(stored)) return false;
  const [, n, r, p, salt, key] = stored.split("$");
  const expected = Buffer.from(key, "base64");
  if (expected.length !== KEY_BYTES) return false;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (cost.N < 2 || (cost.N & (cost.N - 1)) !== 0 || cost.N > 1 << 20 || cost.r > 32 || cost.p > 16) return false;
  const actual = await derive(password, Buffer.from(salt, "base64"), cost);
  return timingSafeEqual(actual, expected);
}

/** A hash no password matches, checked against when an ID is unknown so the answer takes as long. */
let decoy: Promise<string> | null = null;
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(12).toString("base64"));
  return decoy;
}
