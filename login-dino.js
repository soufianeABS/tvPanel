import { runDinoCli } from "./dino-usecase.mjs";

runDinoCli().catch((error) => {
  console.error("Automation failed:", error);
  process.exitCode = 1;
});
