import { runAutomation } from "./automation.mjs";

export async function runDinoUseCase(opts = {}) {
  return runAutomation(opts);
}

export async function runDinoCli() {
  const headless = process.env.HEADLESS === "true";
  const keepOpenMs = Number(process.env.DINO_KEEP_OPEN_MS || "30000");
  await runDinoUseCase({ headless, keepOpenMs });
}
