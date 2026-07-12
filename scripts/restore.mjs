import fs from "node:fs";
import path from "node:path";
import { compose } from "./lib/docker.mjs";
import { ROOT, loadEnv, validateEnv } from "./lib/config.mjs";

const [sourceArg, confirmation] = process.argv.slice(2);
if (!sourceArg || confirmation !== "--yes") throw new Error("usage: npm run restore -- backups/TIMESTAMP --yes");
const env = validateEnv(loadEnv());
const backupsRoot = path.resolve(ROOT, "backups");
const source = path.resolve(ROOT, sourceArg);
if (source !== backupsRoot && !source.startsWith(`${backupsRoot}${path.sep}`)) throw new Error("restore source must be inside backups/");
const sourceData = path.join(source, "data");
if (!fs.existsSync(path.join(source, "MANIFEST.json")) || !fs.existsSync(sourceData)) throw new Error("backup is incomplete");
const target = path.resolve(ROOT, env.VERSUS_WAKU_DATA_DIR || "data");
const displaced = `${target}.before-restore-${Date.now()}`;
compose(["stop", "nwaku"]);
try {
  if (fs.existsSync(target)) fs.renameSync(target, displaced);
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(sourceData, target, { recursive: true, errorOnExist: false });
  console.log(JSON.stringify({ restored: source, previousData: fs.existsSync(displaced) ? displaced : null }, null, 2));
} catch (error) {
  if (!fs.existsSync(target) && fs.existsSync(displaced)) fs.renameSync(displaced, target);
  throw error;
} finally {
  compose(["start", "nwaku"]);
}
