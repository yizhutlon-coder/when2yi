/**
 * Mint a server-level API key (for ThatYiBot etc.):
 *   npm run apikey -- "thatyibot"
 * Prints the key ONCE; only its sha256 is stored.
 */
import { createHash, randomBytes } from "node:crypto";
import { db, schema } from "../src/db";

const label = process.argv[2] ?? "unnamed";
const key = `w2y_${randomBytes(24).toString("base64url")}`;
db.insert(schema.apiKeys)
  .values({
    id: randomBytes(8).toString("hex"),
    keyHash: createHash("sha256").update(key).digest("hex"),
    label,
    createdAt: Math.floor(Date.now() / 1000),
  })
  .run();

console.log(`API key for "${label}" (shown once, store it now):\n\n  ${key}\n`);
console.log(`Use it as:  x-api-key: ${key.slice(0, 12)}...  or  Authorization: Bearer <key>`);
