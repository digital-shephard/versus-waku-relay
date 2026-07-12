import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ENV_PATH, ROOT, loadEnv, validateEnv } from "./lib/config.mjs";

if (!fs.existsSync(ENV_PATH)) {
  const source = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  const configured = source.replace("replace_with_64_lowercase_hex_characters", crypto.randomBytes(32).toString("hex"));
  fs.writeFileSync(ENV_PATH, configured, { encoding: "utf8", mode: 0o600 });
  console.log(`created ${ENV_PATH}`);
  console.log("set PUBLIC_DOMAIN, PUBLIC_IP, and VERSUS_WAKU_STATIC_PEER before deployment");
} else {
  validateEnv(loadEnv(), { allowPlaceholders: true });
  console.log(`${ENV_PATH} already exists and its structural fields are valid`);
}
