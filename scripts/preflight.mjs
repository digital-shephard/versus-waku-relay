import { compose, docker } from "./lib/docker.mjs";
import { loadEnv, validateEnv } from "./lib/config.mjs";

const env = validateEnv(loadEnv());
const server = docker(["info", "--format", "{{.ServerVersion}}"], { quiet: true });
if (!server) throw new Error("Docker Linux engine is unavailable");
compose(["config", "--quiet"]);
console.log(JSON.stringify({ ok: true, docker: server, image: env.NWAKU_IMAGE, domain: env.PUBLIC_DOMAIN }, null, 2));
