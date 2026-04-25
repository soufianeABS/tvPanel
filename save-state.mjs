import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const LOGIN_URL = "https://tvpluspanel.ru/login";
const OUTPUT_FILE = path.resolve("tvplus-storage-state.json");

async function waitForEnter() {
  process.stdout.write("\nAfter login + captcha are complete, press Enter here...\n");
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once("data", resolve));
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    console.log(`Opened ${LOGIN_URL}`);
    console.log("Log in manually in the browser window.");
    await waitForEnter();

    const state = await context.storageState();
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(state), "utf8");

    console.log(`Saved storage state file: ${OUTPUT_FILE}`);
    console.log("Use this PowerShell command to set Fly secret:");
    console.log(
      `fly secrets set TVPLUS_STORAGE_STATE_JSON=\"$(Get-Content -Raw '${OUTPUT_FILE}')\" -a <your-app-name>`
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Failed to save storage state:", error);
  process.exitCode = 1;
});
