import { runStrongCli } from "./strong-usecase.mjs";

runStrongCli().catch((error) => {
  console.error("Strong automation failed:", error);
  process.exitCode = 1;
});
