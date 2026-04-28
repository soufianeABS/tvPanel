import { runStrongLoginUseCase } from "./automation.mjs";

export async function runStrongUseCase(opts = {}) {
  return runStrongLoginUseCase(opts);
}

export async function runStrongCli() {
  const headless = process.env.HEADLESS === "true";
  const keepOpenMs = Number(process.env.STRONG_KEEP_OPEN_MS || process.env.DINO_KEEP_OPEN_MS || "30000");
  await runStrongUseCase({ headless, keepOpenMs });
}
