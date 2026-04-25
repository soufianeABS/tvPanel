import { runCli } from "./automation.mjs";

runCli().catch((error) => {
  console.error("Automation failed:", error);
  process.exitCode = 1;
});
