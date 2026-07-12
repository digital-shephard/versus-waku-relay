import fs from "node:fs";
import path from "node:path";
import { compose } from "./lib/docker.mjs";
import { ROOT, loadEnv, validateEnv } from "./lib/config.mjs";

const env = validateEnv(loadEnv());
const dataDir = path.resolve(ROOT, env.VERSUS_WAKU_DATA_DIR || "data");
if (!fs.existsSync(dataDir)) throw new Error(`data directory does not exist: ${dataDir}`);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(ROOT, "backups", stamp);
compose(["stop", "nwaku"]);
try {
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(dataDir, path.join(destination, "data"), { recursive: true, errorOnExist: false });
  fs.writeFileSync(path.join(destination, "MANIFEST.json"), `${JSON.stringify({ version: 1, createdAt: new Date().toISOString(), image: env.NWAKU_IMAGE }, null, 2)}\n`);
  console.log(destination);
} finally {
  compose(["start", "nwaku"]);
}
