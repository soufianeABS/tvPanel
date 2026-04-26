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
const CAPTCHA_PROVIDER = (process.env.TVPLUS_CAPTCHA_PROVIDER || "").toLowerCase();
const CAPTCHA_API_KEY = process.env.TVPLUS_CAPTCHA_API_KEY || "";
const CAPTCHA_TIMEOUT_MS = Number(process.env.TVPLUS_CAPTCHA_TIMEOUT_MS || "180000");
const CAPTCHA_POLL_MS = Number(process.env.TVPLUS_CAPTCHA_POLL_MS || "5000");
const DINO_URL_HOST = process.env.DINO_URL_HOST || "";

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
  const parsedDefaultUrl = `${u.protocol}//${u.host}`;
  let url = parsedDefaultUrl;
  if (DINO_URL_HOST) {
    try {
      url = new URL(DINO_URL_HOST).origin;
    } catch {
      throw new Error("Invalid DINO_URL_HOST. Expected a full URL like http://line.playmodx.com");
    }
  }
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

function getCaptchaIdFromHtml(html) {
  const patterns = [
    /captchaId\s*[:=]\s*["']([^"']+)["']/i,
    /captcha_id\s*[:=]\s*["']([^"']+)["']/i,
    /data-captchaid=["']([^"']+)["']/i
  ];
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m?.[1]) return m[1];
  }
  return "";
}

async function detectGeeTestCaptchaId(page) {
  const fromDom = await page.evaluate(() => {
    const root = document.querySelector("#captcha");
    if (!root) return "";
    return (
      root.getAttribute("data-captchaid") ||
      root.getAttribute("data-captcha-id") ||
      root.getAttribute("captcha-id") ||
      ""
    );
  });
  if (fromDom) return fromDom;
  const html = await page.content();
  return getCaptchaIdFromHtml(html);
}

async function request2CaptchaGeeTestV4({ captchaId, pageUrl }) {
  const submitUrl = new URL("https://2captcha.com/in.php");
  submitUrl.searchParams.set("key", CAPTCHA_API_KEY);
  submitUrl.searchParams.set("method", "geetest_v4");
  submitUrl.searchParams.set("captcha_id", captchaId);
  submitUrl.searchParams.set("pageurl", pageUrl);
  submitUrl.searchParams.set("json", "1");

  const submitRes = await fetch(submitUrl);
  const submitJson = await submitRes.json();
  if (submitJson.status !== 1 || !submitJson.request) {
    throw new Error(`2Captcha submit failed: ${submitJson.request || "unknown error"}`);
  }

  const captchaRequestId = submitJson.request;
  const startedAt = Date.now();
  while (Date.now() - startedAt < CAPTCHA_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, CAPTCHA_POLL_MS));
    const pollUrl = new URL("https://2captcha.com/res.php");
    pollUrl.searchParams.set("key", CAPTCHA_API_KEY);
    pollUrl.searchParams.set("action", "get");
    pollUrl.searchParams.set("id", captchaRequestId);
    pollUrl.searchParams.set("json", "1");

    const pollRes = await fetch(pollUrl);
    const pollJson = await pollRes.json();
    if (pollJson.status === 1 && pollJson.request) {
      return pollJson.request;
    }
    if (pollJson.request !== "CAPCHA_NOT_READY") {
      throw new Error(`2Captcha solve failed: ${pollJson.request || "unknown error"}`);
    }
  }

  throw new Error("2Captcha solve timeout.");
}

async function solveCaptchaWith2Captcha(page) {
  if (!CAPTCHA_API_KEY) {
    throw new Error("TVPLUS_CAPTCHA_PROVIDER=2captcha requires TVPLUS_CAPTCHA_API_KEY.");
  }
  const captchaId = await detectGeeTestCaptchaId(page);
  if (!captchaId) {
    throw new Error("Could not detect GeeTest captcha_id on login page.");
  }
  console.log(`Using 2Captcha GeeTest v4 solver (captcha_id=${captchaId}).`);
  const solution = await request2CaptchaGeeTestV4({
    captchaId,
    pageUrl: page.url()
  });

  const captchaOutput = solution.captcha_output;
  const lotNumber = solution.lot_number;
  const passToken = solution.pass_token;
  const genTime = solution.gen_time;
  if (!captchaOutput || !lotNumber || !passToken || !genTime) {
    throw new Error("2Captcha returned incomplete GeeTest response payload.");
  }

  await page.evaluate(
    ({ lot, output, token, genTimeValue }) => {
      const lotInput = document.querySelector("#lot_number");
      const outputInput = document.querySelector("#captcha_output");
      const tokenInput = document.querySelector("#pass_token");
      const genTimeInput = document.querySelector("#gen_time");
      if (!lotInput || !outputInput || !tokenInput || !genTimeInput) {
        throw new Error("Missing one or more captcha hidden inputs.");
      }
      lotInput.value = lot;
      outputInput.value = output;
      tokenInput.value = token;
      genTimeInput.value = String(genTimeValue);
    },
    {
      lot: lotNumber,
      output: captchaOutput,
      token: passToken,
      genTimeValue: genTime
    }
  );
  console.log("Injected GeeTest tokens from 2Captcha.");
}

async function loginWithCaptcha(page, allowInteractiveLogin) {
  console.log(`Opening ${LOGIN_URL} ...`);
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  // Start with captcha handling first, then submit filled credentials.
  await page.waitForSelector("#captcha", { timeout: 20000 });
  if (CAPTCHA_PROVIDER === "2captcha") {
    await solveCaptchaWith2Captcha(page);
  } else {
    if (!allowInteractiveLogin) {
      throw new Error(
        "Session expired and interactive captcha login is disabled in headless mode. " +
          "Configure TVPLUS_CAPTCHA_PROVIDER=2captcha (with TVPLUS_CAPTCHA_API_KEY), or run non-headless and solve captcha manually."
      );
    }
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
  }

  await page.fill("#uname", PANEL_USERNAME);
  await page.fill("#upass", PANEL_PASSWORD);
  console.log("Credentials filled after captcha.");

  try {
    await page.click("button[name='btn-login']", { timeout: 10000 });
  } catch {
    await page.evaluate(() => {
      const form = document.querySelector("#my-form");
      if (form) form.submit();
    });
  }
  await page.waitForURL((u) => !/\/login/i.test(u.pathname + u.search), { timeout: 120000 });
  console.log(`Logged in. Current URL: ${page.url()}`);
}

function isLoginUrl(urlLike) {
  try {
    const u = new URL(urlLike);
    return /\/login/i.test(u.pathname + u.search);
  } catch {
    return /\/login/i.test(String(urlLike || ""));
  }
}

async function ensureAuthenticated(page, allowInteractiveLogin) {
  await page.goto(ADDNEW_LINES_URL, { waitUntil: "domcontentloaded" });
  if (!isLoginUrl(page.url())) {
    console.log("Session is already authenticated.");
    return;
  }
  await loginWithCaptcha(page, allowInteractiveLogin);
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

  // The panel redirects automatically to users list after successful add.
  await page.waitForURL(/\/users\?s=lines/i, { timeout: 120000 });
  console.log(`Redirected automatically after add. URL: ${page.url()}`);

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
    await ensureAuthenticated(page, !headless);

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
