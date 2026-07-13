import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ENV_PATH, ROOT, loadEnv, validateEnv } from "./lib/config.mjs";

if (!fs.existsSync(ENV_PATH)) {
  const source = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  const configured = source
    .replace("replace_with_64_lowercase_hex_characters", crypto.randomBytes(32).toString("hex"))
    .replace("0xreplace_with_distinct_32_byte_private_key", `0x${crypto.randomBytes(32).toString("hex")}`);
  fs.writeFileSync(ENV_PATH, configured, { encoding: "utf8", mode: 0o600 });
  console.log(`created ${ENV_PATH}`);
  console.log("set public addressing, canonical Arena, deployment block, and Base RPC before deployment");
  console.log("graduation submission is disabled by default; enabling it requires a separate low-balance funded keeper key");
} else {
  validateEnv(loadEnv(), { allowPlaceholders: true });
  console.log(`${ENV_PATH} already exists and its structural fields are valid`);
}
