import crypto from "node:crypto";
const pw = process.argv[2];
if (!pw) { console.error("Usage: node scripts/hash-password.mjs <password>"); process.exit(1); }
const salt = crypto.randomBytes(16).toString("hex");
console.log("ADMIN_PASSWORD_HASH=" + salt + ":" + crypto.scryptSync(pw, salt, 64).toString("hex"));
