import { chromium } from "playwright";
import dotenv from "dotenv";

dotenv.config();

const LOGIN_URL = "https://tvpluspanel.ru/login";
const ADDNEW_LINES_URL =
  process.env.TVPLUS_ADDNEW_URL || "https://tvpluspanel.ru/addnew?t=lines";
const USERS_LINES_URL =
  process.env.TVPLUS_USERS_LINES_URL || "https://tvpluspanel.ru/users?s=lines";

const PANEL_USERNAME = process.env.TVPLUS_USERNAME || "abdessamad07";
const PANEL_PASSWORD = process.env.TVPLUS_PASSWORD || "Azerty_0";
const LINE_SUBSCRIPTION = process.env.TVPLUS_LINE_SUBSCRIPTION ?? "5";
const LINE_COUNTRY = process.env.TVPLUS_LINE_COUNTRY ?? "";
const LINE_NOTES = process.env.TVPLUS_LINE_NOTES || "";

/**
 * From a get.php (or similar) URL, return panel host + credentials.
 * Also accepts strings that contain an http(s) URL (e.g. wget lines).
 */
export function parseLineCredentials(linkValue) {
  const trimmed = String(linkValue || "").trim();
  if (!trimmed) {
    throw new Error("Empty link value");
  }
  const httpMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/);
  const candidate = (httpMatch ? httpMatch[0] : trimmed).replace(/&amp;/g, "&");
  const u = new URL(candidate);
  const username = u.searchParams.get("username");
  const password = u.searchParams.get("password");
  if (!username || !password) {
    throw new Error("Could not parse username/password from link (expected get.php?username=&password=)");
  }
  const url = `${u.protocol}//${u.host}`;
  return {
    url,
    username,
    password,
    playlistUrl: candidate
  };
}

async function setNativeSelectAndNotify(page, selector, value) {
  await page.evaluate(
    ({ selector: sel, value: val }) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Missing element: ${sel}`);
      el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (window.jQuery) window.jQuery(el).trigger("change");
    },
    { selector, value }
  );
}

async function login(page) {
  console.log(`Opening ${LOGIN_URL} ...`);
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  await page.fill("#uname", PANEL_USERNAME);
  await page.fill("#upass", PANEL_PASSWORD);

  console.log("Credentials filled.");
  await page.waitForSelector("#captcha .geetest_btn_click, #captcha [aria-label='Click to verify']", {
    timeout: 15000
  });
  await page.click("#captcha .geetest_btn_click, #captcha [aria-label='Click to verify']");
  console.log("Clicked captcha verify button.");
  console.log("Complete the GeeTest challenge manually in the opened browser.");
  console.log("Waiting for captcha token, then login will be submitted automatically...");

  await page.waitForFunction(
    () => {
      const lot = document.querySelector("#lot_number");
      const output = document.querySelector("#captcha_output");
      const token = document.querySelector("#pass_token");
      return Boolean(
        lot &&
          output &&
          token &&
          lot.value.trim() &&
          output.value.trim() &&
          token.value.trim()
      );
    },
    { timeout: 120000 }
  );

  try {
    await page.click("button[name='btn-login']", { timeout: 10000 });
  } catch {
    await page.evaluate(() => {
      const form = document.querySelector("#my-form");
      if (form) form.submit();
    });
  }

  await page.waitForURL((u) => !/\/login/i.test(u.pathname + u.search), {
    timeout: 120000
  });
  console.log(`Logged in. Current URL: ${page.url()}`);
}

/**
 * @returns {Promise<string>} value of #link in the modal
 */
async function openFirstLineLinkMenu(page) {
  if (!/\/users\?s=lines/i.test(page.url())) {
    console.log(`openFirstLineLinkMenu: expected ${USERS_LINES_URL}, got ${page.url()} — skipping.`);
    return "";
  }

  await page.waitForLoadState("domcontentloaded");
  const firstRow = page.locator(".main-container table tbody tr").first();
  await firstRow.waitFor({ state: "visible", timeout: 60000 });

  const linkToggle = firstRow.locator(
    "button.btn-info.dropdown-toggle.material-shadow-none.btn-sm"
  ).filter({ hasText: /^Link$/ });
  await linkToggle.click();

  const menu = page.locator(".dropdown-menu.show").last();
  await menu.waitFor({ state: "visible", timeout: 10000 });

  const linkItem = menu
    .locator("a.dropdown-item, button.dropdown-item, .dropdown-item")
    .filter({ hasText: /^Link$/ })
    .first();
  await linkItem.click();

  const linkInput = page.locator(".modal.show #link, #myModal.show #link").first();
  await linkInput.waitFor({ state: "visible", timeout: 15000 });
  const linkValue = await linkInput.inputValue();
  console.log('Opened first row "Link" modal.');
  console.log("Link value (#link):");
  console.log(linkValue);
  return linkValue;
}

async function addNewLine(page) {
  console.log(`Opening Add Line page: ${ADDNEW_LINES_URL}`);
  await page.goto(ADDNEW_LINES_URL, { waitUntil: "domcontentloaded" });

  await page.waitForSelector("#addnewButton", { timeout: 60000 });
  await page.waitForSelector("#add_sub", { timeout: 60000 });

  await setNativeSelectAndNotify(page, "#add_sub", LINE_SUBSCRIPTION);
  await page.waitForFunction(
    () => {
      const pack = document.querySelector("#add_packid");
      return pack && String(pack.value || "").length > 0;
    },
    { timeout: 30000 }
  );

  if (LINE_COUNTRY === "") {
    await page.evaluate(() => {
      const el = document.querySelector("#add_country");
      if (!el) return;
      el.selectedIndex = 1;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (window.jQuery) window.jQuery(el).trigger("change");
    });
  } else {
    await setNativeSelectAndNotify(page, "#add_country", LINE_COUNTRY);
  }

  if (LINE_NOTES) {
    await page.fill("#add_comment", LINE_NOTES);
  }

  await page.locator(".channel_select button.service_all").click();
  await page.locator(".vod_select button.vod_all").click();
  await page.waitForTimeout(300);

  await page.locator(".channel_select #pack-fill-1").uncheck({ force: true });

  const checked = await page.locator("input.bouq_list:checked").count();
  if (checked < 1) {
    await page.locator(".channel_select button.service_all").click();
    await page.locator(".vod_select button.vod_all").click();
  }

  console.log("Clicking Confirm (add new line)...");
  await page.click("#addnewButton");

  await page.waitForURL(/\/users\?s=lines/i, { timeout: 120000 }).catch(() => {
    console.log(
      "Did not redirect to user list within timeout; check the browser for errors or SweetAlert."
    );
  });
  console.log(`After confirm, URL: ${page.url()}`);

  if (/\/users\?s=lines/i.test(page.url())) {
    return await openFirstLineLinkMenu(page);
  }
  return "";
}

/**
 * @param {object} opts
 * @param {boolean} [opts.headless]
 * @param {boolean} [opts.skipAddLine]
 * @param {number} [opts.keepOpenMs] after flow (CLI only; API uses 0)
 * @returns {Promise<{ url: string, username: string, password: string, playlistUrl: string }>}
 */
export async function runAutomation(opts = {}) {
  const headless = opts.headless ?? false;
  const skipAddLine = opts.skipAddLine ?? process.env.TVPLUS_SKIP_ADD_LINE === "true";
  const keepOpenMs =
    opts.keepOpenMs !== undefined
      ? opts.keepOpenMs
      : Number(process.env.TVPLUS_KEEP_OPEN_MS || "0");

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 80 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page);

    let rawLink = "";
    if (!skipAddLine) {
      rawLink = await addNewLine(page);
    } else {
      console.log("Skipping add line (TVPLUS_SKIP_ADD_LINE=true).");
    }

    if (keepOpenMs > 0) {
      console.log(`Keeping browser open for ${keepOpenMs} ms.`);
      await page.waitForTimeout(keepOpenMs);
    }

    if (skipAddLine) {
      return null;
    }
    if (!rawLink) {
      throw new Error("No playlist link captured (check flow / redirect / modal).");
    }
    return parseLineCredentials(rawLink);
  } finally {
    await browser.close();
  }
}

export async function runCli() {
  const headless = process.env.HEADLESS === "true";
  const keepOpenMs = Number(process.env.TVPLUS_KEEP_OPEN_MS || "30000");
  await runAutomation({
    headless,
    keepOpenMs
  });
}
