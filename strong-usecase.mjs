import { runStrongLoginUseCase } from "./automation.mjs";

export async function runStrongUseCase(opts = {}) {
  return runStrongLoginUseCase(opts);
}

export async function runStrongCli() {
  const headless = process.env.HEADLESS === "true";
  const keepOpenMs = 30000;
  await runStrongUseCase({ headless, keepOpenMs });
}
