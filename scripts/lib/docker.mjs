import { spawnSync } from "node:child_process";
import { COMPOSE_PATH, ENV_PATH, ROOT } from "./config.mjs";

export function run(command, args, { quiet = false, allowFailure = false, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: "utf8",
    windowsHide: true,
    stdio: quiet ? "pipe" : "inherit",
  });
  if (result.status !== 0 && !allowFailure) {
    const detail = quiet ? `${result.stdout || ""}${result.stderr || ""}`.trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return quiet ? String(result.stdout || "").trim() : result.status;
}

export function docker(args, options) {
  return run("docker", args, options);
}

export function compose(args, options) {
  return docker(["compose", "--env-file", ENV_PATH, "--file", COMPOSE_PATH, ...args], options);
}
