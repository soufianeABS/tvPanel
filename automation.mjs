import { chromium } from "playwright";
import dotenv from "dotenv";

dotenv.config();

function envFirst(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

const LOGIN_URL = "https://tvpluspanel.ru/login";
const STRONG_LOGIN_URL = envFirst("STRONG_LOGIN_URL", "TVPLUS_STRONG_LOGIN_URL") || "https://8k.cms-only.ru/login";
const ADDNEW_LINES_URL =
  envFirst("DINO_ADDNEW_URL", "TVPLUS_ADDNEW_URL") || "https://tvpluspanel.ru/addnew?t=lines";
const USERS_LINES_URL =
  envFirst("DINO_USERS_LINES_URL", "TVPLUS_USERS_LINES_URL") || "https://tvpluspanel.ru/users?s=lines";

const PANEL_USERNAME = envFirst("DINO_USERNAME", "TVPLUS_USERNAME") || "abdessamad07";
const PANEL_PASSWORD = envFirst("DINO_PASSWORD", "TVPLUS_PASSWORD") || "Azerty_0";
const LINE_SUBSCRIPTION = envFirst("DINO_LINE_SUBSCRIPTION", "TVPLUS_LINE_SUBSCRIPTION") || "5";
const LINE_COUNTRY = envFirst("DINO_LINE_COUNTRY", "TVPLUS_LINE_COUNTRY");
const LINE_NOTES = envFirst("DINO_LINE_NOTES", "TVPLUS_LINE_NOTES");
const CAPTCHA_PROVIDER = envFirst("CAPTCHA_PROVIDER", "DINO_CAPTCHA_PROVIDER", "TVPLUS_CAPTCHA_PROVIDER").toLowerCase();
const CAPTCHA_API_KEY = envFirst("CAPTCHA_API_KEY", "DINO_CAPTCHA_API_KEY", "TVPLUS_CAPTCHA_API_KEY");
const CAPTCHA_TIMEOUT_MS = Number(
  envFirst("CAPTCHA_TIMEOUT_MS", "DINO_CAPTCHA_TIMEOUT_MS", "TVPLUS_CAPTCHA_TIMEOUT_MS") || "180000"
);
const CAPTCHA_POLL_MS = Number(
  envFirst("CAPTCHA_POLL_MS", "DINO_CAPTCHA_POLL_MS", "TVPLUS_CAPTCHA_POLL_MS") || "5000"
);
const DINO_URL_HOST = process.env.DINO_URL_HOST || "";
const STRONG_LOGIN_SUCCESS_URL_REGEX =
  envFirst("STRONG_LOGIN_SUCCESS_URL_REGEX", "TVPLUS_STRONG_LOGIN_SUCCESS_URL_REGEX");
const STRONG_LOGIN_WAIT_AFTER_SUBMIT_MS = Number(
  envFirst("STRONG_LOGIN_WAIT_AFTER_SUBMIT_MS", "TVPLUS_STRONG_LOGIN_WAIT_AFTER_SUBMIT_MS") || "15000"
);
const STRONG_OPEN_M3U_ADDNEW =
  (envFirst("STRONG_OPEN_M3U_ADDNEW", "TVPLUS_STRONG_OPEN_M3U_ADDNEW") || "true").toLowerCase() === "true";
const STRONG_SUBSCRIPTION_VALUE = envFirst("STRONG_SUBSCRIPTION_VALUE", "TVPLUS_STRONG_SUBSCRIPTION_VALUE") || "5";
const STRONG_BOUQUET_NAME = envFirst("STRONG_BOUQUET_NAME", "TVPLUS_STRONG_BOUQUET_NAME") || "kk";
const STRONG_LINE_COUNTRY = envFirst("STRONG_LINE_COUNTRY");
const STRONG_LINE_NOTES = envFirst("STRONG_LINE_NOTES");

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
    throw new Error("CAPTCHA_PROVIDER=2captcha requires CAPTCHA_API_KEY.");
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

async function fillFirstAvailable(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.fill(value);
      return selector;
    }
  }
  throw new Error(`Could not find any matching input selector: ${selectors.join(", ")}`);
}

async function waitForGeeTestManualSuccess(page, timeoutMs = 180000) {
  await page.waitForFunction(
    () => {
      const lot = document.querySelector("#lot_number");
      const output = document.querySelector("#captcha_output");
      const token = document.querySelector("#pass_token");
      const successText = document.querySelector("#captcha .geetest_tip");
      const tokenReady = Boolean(
        lot &&
          output &&
          token &&
          lot.value.trim() &&
          output.value.trim() &&
          token.value.trim()
      );
      const successReady = Boolean(
        successText &&
          /verification success/i.test((successText.textContent || "").trim())
      );
      return tokenReady || successReady;
    },
    { timeout: timeoutMs }
  );
}

async function openM3UAddNewFromSidebar(page) {
  const m3uToggle = page.locator("a.menu-link[href='#m3uDevices'], a[href='#m3uDevices']").first();
  await m3uToggle.waitFor({ state: "visible", timeout: 20000 });
  await m3uToggle.click();

  const addNewLink = page.locator("#m3uDevices a[href='addnew?t=lines']").first();
  await addNewLink.waitFor({ state: "visible", timeout: 20000 });
  await addNewLink.click();

  await page.waitForURL(/addnew\?t=lines/i, { timeout: 120000 });
}

async function closeBlockingPopupIfPresent(page) {
  const modalCloseSelectors = [
    "#myModal.show .btn-close",
    "#myModal.show button[data-bs-dismiss='modal']",
    ".modal.show .btn-close",
    ".modal.show button[data-bs-dismiss='modal']",
    ".modal.show button:has-text('Close')"
  ];

  let attemptedClose = false;
  for (const selector of modalCloseSelectors) {
    const btn = page.locator(selector).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
      attemptedClose = true;
      await btn.click({ timeout: 5000 }).catch(() => {});
      break;
    }
  }

  if (!attemptedClose) {
    const swalBtn = page
      .locator(".swal2-container .swal2-close, .swal2-container .swal2-confirm, .swal2-container button:has-text('OK')")
      .first();
    if ((await swalBtn.count()) > 0 && (await swalBtn.isVisible().catch(() => false))) {
      attemptedClose = true;
      await swalBtn.click({ timeout: 5000 }).catch(() => {});
    }
  }

  if (!attemptedClose) {
    // Fallback for dialogs that close with Escape.
    await page.keyboard.press("Escape").catch(() => {});
  }

  await page.waitForFunction(() => {
    const hasOpenModal = Boolean(document.querySelector("#myModal.show, .modal.show"));
    const hasBackdrop = Boolean(document.querySelector(".modal-backdrop.show"));
    return !hasOpenModal && !hasBackdrop;
  }, { timeout: 10000 }).catch(() => {});

  await page.waitForTimeout(200);
  return attemptedClose;
}

async function closeSuccessSwalIfPresent(page) {
  const swalPopup = page.locator(".swal2-popup.swal2-show").first();
  if ((await swalPopup.count()) === 0) return false;
  if (!(await swalPopup.isVisible().catch(() => false))) return false;

  console.log("[ui] success swal detected; closing it.");
  const closeBtn = page.locator(".swal2-popup.swal2-show .swal2-confirm, .swal2-popup.swal2-show .swal2-close").first();
  if ((await closeBtn.count()) > 0 && (await closeBtn.isVisible().catch(() => false))) {
    await closeBtn.click({ timeout: 5000 }).catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }

  await page.waitForFunction(
    () => !document.querySelector(".swal2-popup.swal2-show"),
    { timeout: 8000 }
  ).catch(() => {});
  return true;
}

async function ensureModalClosed(page, maxAttempts = 6) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const hasOpenModal = await page
      .locator("#myModal.show, .modal.show, .modal-backdrop.show")
      .count();
    if (hasOpenModal === 0) {
      return;
    }
    await closeBlockingPopupIfPresent(page);
    await page.waitForTimeout(300);
  }
}

async function clickGreatOnNewsModalIfPresent(page, waitMs = 12000) {
  const modal = page.locator("#myModal");
  await modal.waitFor({ state: "visible", timeout: waitMs }).catch(() => {});

  const greatBtn = page.locator(
    "#myModal.show button.btn.btn-info.btn-border[data-bs-dismiss='modal']:has-text('Great'), #myModal.show button:has-text('Great')"
  ).first();
  if ((await greatBtn.count()) > 0 && (await greatBtn.isVisible().catch(() => false))) {
    await greatBtn.click({ timeout: 5000 }).catch(() => {});
  }
}

async function loginWithCaptcha(page) {
  console.log(`Opening ${LOGIN_URL} ...`);
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  // Start with captcha handling first, then submit filled credentials.
  await page.waitForSelector("#captcha", { timeout: 20000 });
  if (CAPTCHA_PROVIDER === "2captcha") {
    await solveCaptchaWith2Captcha(page);
  } else {
    throw new Error(
      "Captcha automation is mandatory. Configure CAPTCHA_PROVIDER=2captcha with CAPTCHA_API_KEY."
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

async function ensureAuthenticated(page) {
  await page.goto(ADDNEW_LINES_URL, { waitUntil: "domcontentloaded" });
  if (!isLoginUrl(page.url())) {
    console.log("Session is already authenticated.");
    return;
  }
  await loginWithCaptcha(page);
}

/**
 * @returns {Promise<string>} value of #link in the modal
 */
async function openFirstLineLinkMenu(page) {
  if (!/\/users\?(s|t)=lines/i.test(page.url())) {
    console.log(`openFirstLineLinkMenu: expected ${USERS_LINES_URL}, got ${page.url()} — skipping.`);
    return "";
  }

  console.log(`[extract] opening credentials modal from users page: ${page.url()}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("#datatable-users, table", { timeout: 60000 });

  // Prefer DataTables rows, fallback to any visible tbody row.
  const firstRow = page
    .locator("#datatable-users tbody tr, table#datatable-users tbody tr, .main-container table tbody tr, table tbody tr")
    .first();
  await firstRow.waitFor({ state: "visible", timeout: 90000 });
  console.log("[extract] first users row is visible.");

  const linkToggle = firstRow
    .locator("button.btn-info.dropdown-toggle.material-shadow-none.btn-sm, button.dropdown-toggle.btn-info, button.dropdown-toggle")
    .filter({ hasText: /link/i })
    .first();
  await linkToggle.waitFor({ state: "visible", timeout: 30000 });
  await linkToggle.click();
  console.log('[extract] clicked first row "Link" dropdown button.');

  const menu = page.locator(".dropdown-menu.show").last();
  await menu.waitFor({ state: "visible", timeout: 30000 });
  console.log("[extract] link dropdown menu is visible.");

  const wdCardItem = menu
    .locator("a.dropdown-item, button.dropdown-item, .dropdown-item")
    .filter({ hasText: /wd-?card/i })
    .first();
  if ((await wdCardItem.count()) > 0) {
    await wdCardItem.click();
    console.log('Opened first row "WD-Card" modal.');
  } else {
    console.log('[extract] WD-Card item not found in dropdown, trying fallback "Link" item.');
    const linkItem = menu
      .locator("a.dropdown-item, button.dropdown-item, .dropdown-item")
      .filter({ hasText: /^Link$/ })
      .first();
    await linkItem.click();
    console.log('Opened first row fallback "Link" modal.');
  }

  const linkInput = page.locator(".modal.show #link, #myModal.show #link, #link").first();
  await linkInput.waitFor({ state: "visible", timeout: 30000 });
  const linkValue = await linkInput.inputValue();
  console.log("[extract] modal link input is visible.");
  console.log("Link value (#link):");
  console.log(linkValue);
  return linkValue;
}

async function selectStrongBouquet(page) {
  // cc.html uses #switchBouquet + class "on" to toggle custom bouquet mode.
  const switchEnabled = await page.evaluate(() => {
    const switchEl = document.querySelector("#switchBouquet");
    if (!switchEl) return false;

    const isOnNow =
      switchEl.classList.contains("on") ||
      switchEl.getAttribute("aria-checked") === "true" ||
      (switchEl instanceof HTMLInputElement && switchEl.checked === true);

    if (!isOnNow) {
      switchEl.click();
    }

    return (
      switchEl.classList.contains("on") ||
      switchEl.getAttribute("aria-checked") === "true" ||
      (switchEl instanceof HTMLInputElement && switchEl.checked === true)
    );
  });
  console.log("[strong:add] custom bouquet switch enabled:", switchEnabled);

  if (!switchEnabled) {
    throw new Error("Could not enable Custom bouquet switch (#switchBouquet).");
  }

  await page.waitForTimeout(1000);

  // Open the visible Choices/Select2 control (click whole choices__inner div).
  const visibleChoicesInner = page
    .locator(".package_select .choices:has(#bouq_custom) .choices__inner, .choices:has(#bouq_custom) .choices__inner")
    .first();
  await visibleChoicesInner.waitFor({ state: "visible", timeout: 15000 });
  await visibleChoicesInner.click({ timeout: 10000 });
  await page.waitForTimeout(300);

  // Select bouquet from the opened dropdown list.
  const targetOption = page
    .locator(".choices__list--dropdown .choices__item--choice.choices__item--selectable")
    .filter({ hasText: new RegExp(`^\\s*${STRONG_BOUQUET_NAME}\\s*$`, "i") })
    .first();
  let selectedFromDropdown = false;
  if ((await targetOption.count()) > 0) {
    await targetOption.click({ timeout: 10000 });
    selectedFromDropdown = true;
  } else {
    // Fallback: if exact label not found, click first selectable option.
    const firstSelectable = page
      .locator(".choices__list--dropdown .choices__item--choice.choices__item--selectable")
      .first();
    if ((await firstSelectable.count()) > 0) {
      await firstSelectable.click({ timeout: 10000 });
      selectedFromDropdown = true;
    }
  }

  const bouquetDebug = await page.evaluate((bouquetName) => {
    const debug = {
      selectFound: false,
      optionCount: 0,
      matchedOption: "",
      selectedRenderedText: "",
      forcedFirstCheckbox: false,
      checkedCountAfter: 0
    };

    const customSelect = document.querySelector("#bouq_custom");
    debug.selectFound = Boolean(customSelect);
    if (customSelect) {
      const options = Array.from(customSelect.options || []);
      debug.optionCount = options.length;
      const selected = options.find((opt) => opt.selected) || null;
      if (selected) {
        debug.matchedOption = `${selected.textContent || ""} (${selected.value || ""})`;
      } else {
        const wanted = options.find((opt) =>
          String(opt.textContent || "")
            .trim()
            .toLowerCase()
            .includes(String(bouquetName || "").trim().toLowerCase())
        );
        const selectedOption = wanted || (options.length === 1 ? options[0] : null);
        if (selectedOption) {
          debug.matchedOption = `${selectedOption.textContent || ""} (${selectedOption.value || ""})`;
          customSelect.value = selectedOption.value;
          customSelect.dispatchEvent(new Event("input", { bubbles: true }));
          customSelect.dispatchEvent(new Event("change", { bubbles: true }));
          if (window.jQuery) window.jQuery(customSelect).trigger("change");
        }
      }
    }

    const rendered = document.querySelector("#select2-bouq_custom-container, .choices:has(#bouq_custom) .choices__item--selectable");
    debug.selectedRenderedText = String(rendered?.textContent || "").trim();

    // Confirm validation requires at least one checked checkbox.
    const allChecks = Array.from(document.querySelectorAll("input.bouq_list[type='checkbox']"));
    if (!allChecks.some((x) => x.checked) && allChecks.length > 0) {
      allChecks[0].checked = true;
      allChecks[0].dispatchEvent(new Event("input", { bubbles: true }));
      allChecks[0].dispatchEvent(new Event("change", { bubbles: true }));
      debug.forcedFirstCheckbox = true;
    }
    debug.checkedCountAfter = allChecks.filter((x) => x.checked).length;
    return debug;
  }, STRONG_BOUQUET_NAME);
  console.log("[strong:add] selected from dropdown:", selectedFromDropdown);
  console.log("[strong:add] bouquet debug:", bouquetDebug);
}

async function selectStrongSubscription(page) {
  // The sub_list is rendered by Choices.js; click visible container then choose target option.
  const subChoicesInner = page
    .locator(".choices:has(#sub_list) .choices__inner, .choices__inner:has(+ select#sub_list)")
    .first();
  await subChoicesInner.waitFor({ state: "visible", timeout: 15000 });
  await subChoicesInner.click({ timeout: 10000 });
  await page.waitForTimeout(300);

  const byValue = page
    .locator(".choices__list--dropdown .choices__item--choice.choices__item--selectable")
    .filter({ has: page.locator(`[data-value='${STRONG_SUBSCRIPTION_VALUE}']`) })
    .first();

  let selected = false;
  if ((await byValue.count()) > 0) {
    await byValue.click({ timeout: 10000 });
    selected = true;
  } else {
    const byText = page
      .locator(".choices__list--dropdown .choices__item--choice.choices__item--selectable")
      .filter({ hasText: /1\s*Day/i })
      .first();
    if ((await byText.count()) > 0) {
      await byText.click({ timeout: 10000 });
      selected = true;
    }
  }

  // Fallback to native select if visual click path fails.
  if (!selected) {
    if ((await page.locator("#sub_list").count()) > 0) {
      await setNativeSelectAndNotify(page, "#sub_list", STRONG_SUBSCRIPTION_VALUE);
    } else {
      await setNativeSelectAndNotify(page, "#add_sub", STRONG_SUBSCRIPTION_VALUE);
    }
  }

  const subDebug = await page.evaluate(() => {
    const sub = document.querySelector("#sub_list, #add_sub");
    const pack = document.querySelector("#form_packid, #add_packid");
    const rendered = document.querySelector(
      "#select2-sub_list-container, .choices:has(#sub_list) .choices__item--selectable"
    );
    return {
      selectedValue: sub?.value || "",
      selectedText: sub?.selectedOptions?.[0]?.textContent?.trim?.() || "",
      renderedText: String(rendered?.textContent || "").trim(),
      packId: pack?.value || ""
    };
  });
  console.log("[strong:add] subscription debug:", subDebug);
}

async function addStrongLineAndExtract(page) {
  console.log("[strong:add] entered Add New submit flow.");
  console.log(`[strong:add] current URL at start: ${page.url()}`);
  await page.waitForLoadState("domcontentloaded");
  console.log("[strong:add] domcontentloaded reached.");

  await page.waitForFunction(
    () => Boolean(document.querySelector("#sub_list") || document.querySelector("#add_sub")),
    { timeout: 60000 }
  ).catch(async () => {
    const debug = await page.evaluate(() => ({
      url: location.href,
      hasSubList: Boolean(document.querySelector("#sub_list")),
      hasAddSub: Boolean(document.querySelector("#add_sub")),
      hasConfirm: Boolean(document.querySelector("#confirm, #addnewButton")),
      hasBouqCustom: Boolean(document.querySelector("#bouq_custom")),
      hasSwitchBouquet: Boolean(document.querySelector("#switchBouquet")),
      readyState: document.readyState
    }));
    throw new Error(`[strong:add] subscription selector not found within timeout. Debug=${JSON.stringify(debug)}`);
  });
  console.log("[strong:add] subscription selectors are present.");

  console.log(`[strong:add] selecting subscription value ${STRONG_SUBSCRIPTION_VALUE} via visible dropdown...`);
  await selectStrongSubscription(page);

  await selectStrongBouquet(page);

  if (STRONG_LINE_NOTES) {
    console.log(`[strong:add] applying note (${STRONG_LINE_NOTES.length} chars).`);
    await page.fill("#comment, #add_comment", STRONG_LINE_NOTES);
  }

  if (STRONG_LINE_COUNTRY) {
    console.log(`[strong:add] applying country: ${STRONG_LINE_COUNTRY}`);
    await page.evaluate((countryValue) => {
      const el = document.querySelector("#country_list, #add_country");
      if (!el) return;
      const value = String(countryValue || "").trim();
      if (!value) return;

      const options = Array.from(el.options || []);
      const match = options.find(
        (opt) =>
          String(opt.value || "").toLowerCase() === value.toLowerCase() ||
          String(opt.textContent || "").trim().toLowerCase() === value.toLowerCase()
      );
      if (!match) return;

      if (el.multiple) {
        Array.from(el.options || []).forEach((opt) => {
          opt.selected = false;
        });
        match.selected = true;
      } else {
        el.value = match.value;
      }

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (window.jQuery) window.jQuery(el).trigger("change");
    }, STRONG_LINE_COUNTRY);
  }

  const preSubmitState = await page.evaluate(() => ({
    url: location.href,
    confirmExists: Boolean(document.querySelector("#confirm, #addnewButton")),
    checkedCount: document.querySelectorAll("input.bouq_list:checked").length,
    packId: document.querySelector("#form_packid, #add_packid")?.value || "",
    country: document.querySelector("#country_list, #add_country")?.value || ""
  }));
  console.log("[strong:add] pre-submit state:", preSubmitState);

  console.log("[strong:add] clicking confirm button...");
  const addNewApiResponsePromise = page.waitForResponse(
    (res) => /api\.php\?action=add_new/i.test(res.url()),
    { timeout: 30000 }
  ).catch(() => null);
  await page.click("#confirm, #addnewButton");

  let redirected = false;
  try {
    console.log("[strong:add] waiting short redirect window (25s)...");
    await page.waitForURL(/\/users\?(s|t)=lines/i, { timeout: 25000 });
    redirected = true;
    console.log(`[strong:add] redirect succeeded quickly: ${page.url()}`);
  } catch {
    console.log("[strong:add] no quick redirect; checking validation/error state...");
    const validationError = await page
      .locator(".msgError:visible .submitError, .msgError .submitError")
      .first()
      .textContent()
      .catch(() => "");
    const msgErrorVisible = await page.locator(".msgError:visible").count().catch(() => 0);
    console.log("[strong:add] validation summary:", {
      msgErrorVisible,
      validationError: (validationError || "").trim(),
      url: page.url()
    });
    if (validationError && validationError.trim()) {
      throw new Error(`Strong Add New validation failed: ${validationError.trim()}`);
    }

    console.log("[strong:add] fallback: calling submitAddNew() in page context...");
    await page.evaluate(() => {
      if (typeof window.submitAddNew === "function") {
        window.submitAddNew();
      } else {
        const confirmBtn = document.querySelector("#confirm, #addnewButton");
        if (confirmBtn) confirmBtn.click();
      }
    });
  }

  const addNewApiResponse = await addNewApiResponsePromise;
  if (addNewApiResponse) {
    const status = addNewApiResponse.status();
    let payload = null;
    try {
      payload = await addNewApiResponse.json();
    } catch {
      payload = null;
    }
    console.log("[strong:add] add_new API response:", { status, payload });

    if (payload?.result === true) {
      // UI redirect may depend on Swal timer/callback; force deterministic navigation.
      const usersUrl = new URL(USERS_LINES_URL);
      usersUrl.searchParams.set("t", "lines");
      console.log(`[strong:add] forcing navigation to users list: ${usersUrl.toString()}`);
      await page.goto(usersUrl.toString(), { waitUntil: "domcontentloaded" });
      redirected = true;
    } else if (payload?.msg) {
      throw new Error(`Strong Add New API failed: ${payload.msg}`);
    }
  } else {
    console.log("[strong:add] did not capture add_new API response within 30s.");
  }

  if (!redirected) {
    console.log("[strong:add] waiting long redirect window (120s)...");
    await page.waitForURL(/\/users\?(s|t)=lines/i, { timeout: 120000 });
    console.log(`[strong:add] redirect succeeded after fallback: ${page.url()}`);
  }
  await closeSuccessSwalIfPresent(page);
  console.log("[strong:add] opening first line Link modal to extract credentials...");
  return await openFirstLineLinkMenu(page);
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
  await closeSuccessSwalIfPresent(page);

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
  const skipAddLine = opts.skipAddLine ?? (envFirst("DINO_SKIP_ADD_LINE", "TVPLUS_SKIP_ADD_LINE") === "true");
  const keepOpenMs =
    opts.keepOpenMs !== undefined
      ? opts.keepOpenMs
      : Number(envFirst("DINO_KEEP_OPEN_MS", "TVPLUS_KEEP_OPEN_MS") || "0");

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 80 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await ensureAuthenticated(page);

    let rawLink = "";
    if (!skipAddLine) {
      rawLink = await addNewLine(page);
    } else {
      console.log("Skipping add line (DINO_SKIP_ADD_LINE=true).");
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

/**
 * Strong login-only use case for the 8K panel.
 * This flow does not bypass captcha; it waits for manual completion.
 * @param {object} opts
 * @param {boolean} [opts.headless]
 * @param {number} [opts.keepOpenMs]
 * @returns {Promise<{ ok: boolean, url: string, usernameSelector: string, passwordSelector: string, addNewUrl?: string, username?: string, password?: string, playlistUrl?: string }>}
 */
export async function runStrongLoginUseCase(opts = {}) {
  const headless = opts.headless ?? false;
  const keepOpenMs =
    opts.keepOpenMs !== undefined
      ? opts.keepOpenMs
      : Number(envFirst("STRONG_KEEP_OPEN_MS", "DINO_KEEP_OPEN_MS", "TVPLUS_KEEP_OPEN_MS") || "0");

  const panelUsername = envFirst("STRONG_USERNAME", "TVPLUS_STRONG_USERNAME") || PANEL_USERNAME;
  const panelPassword = envFirst("STRONG_PASSWORD", "TVPLUS_STRONG_PASSWORD") || PANEL_PASSWORD;
  if (!panelUsername || !panelPassword) {
    throw new Error("Missing strong login credentials (STRONG_USERNAME / STRONG_PASSWORD).");
  }

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 80 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`Opening strong test login page: ${STRONG_LOGIN_URL}`);
    await page.goto(STRONG_LOGIN_URL, { waitUntil: "domcontentloaded" });

    const usedUsernameSelector = await fillFirstAvailable(page, ["#uname", "#username", "input[name='uname']"], panelUsername);
    const usedPasswordSelector = await fillFirstAvailable(
      page,
      ["#upass", "#password-input", "#password", "input[name='upass']"],
      panelPassword
    );
    console.log(`Filled credentials using selectors: ${usedUsernameSelector}, ${usedPasswordSelector}`);

    const captchaRoot = page.locator("#captcha").first();
    if ((await captchaRoot.count()) > 0) {
      if (CAPTCHA_PROVIDER !== "2captcha") {
        throw new Error(
          "Captcha automation is mandatory. Configure CAPTCHA_PROVIDER=2captcha with CAPTCHA_API_KEY."
        );
      }
      await solveCaptchaWith2Captcha(page);
      console.log("Captcha solved via provider.");
    }

    await page.click("button[name='btn-login'], button:has-text('Sign In')");
    console.log("Submitted login form.");

    if (STRONG_LOGIN_SUCCESS_URL_REGEX) {
      const successRegex = new RegExp(STRONG_LOGIN_SUCCESS_URL_REGEX, "i");
      await page.waitForURL(successRegex, { timeout: 120000 });
    } else {
      await page.waitForURL((u) => !/\/login/i.test(u.pathname + u.search), { timeout: 120000 });
    }

    const result = {
      ok: true,
      url: page.url(),
      usernameSelector: usedUsernameSelector,
      passwordSelector: usedPasswordSelector
    };

    if (STRONG_OPEN_M3U_ADDNEW) {
      // Wait for post-login news modal and close it via the "Great" action.
      await clickGreatOnNewsModalIfPresent(page);
      // The dashboard may open #myModal after login; make sure it is fully closed.
      await ensureModalClosed(page);
      console.log("Opening sidebar path: M3U -> Add New...");
      try {
        await openM3UAddNewFromSidebar(page);
      } catch (err) {
        // If a late modal blocks clicks, close again and retry once.
        await ensureModalClosed(page);
        await openM3UAddNewFromSidebar(page);
      }
      result.addNewUrl = page.url();
      console.log(`Reached Add New page: ${result.addNewUrl}`);

      console.log(`Submitting strong Add New with one-day subscription and bouquet "${STRONG_BOUQUET_NAME}"...`);
      const rawLink = await addStrongLineAndExtract(page);
      if (rawLink) {
        const parsed = parseLineCredentials(rawLink);
        result.username = parsed.username;
        result.password = parsed.password;
        result.playlistUrl = parsed.playlistUrl;
      } else {
        throw new Error("Strong flow did not capture playlist link from users list.");
      }
    }

    if (keepOpenMs > 0) {
      console.log(`Keeping browser open for ${keepOpenMs} ms.`);
      await page.waitForTimeout(keepOpenMs);
    } else {
      await page.waitForTimeout(STRONG_LOGIN_WAIT_AFTER_SUBMIT_MS);
    }
    return result;
  } finally {
    await browser.close();
  }
}

export async function runCli() {
  const headless = process.env.HEADLESS === "true";
  const keepOpenMs = Number(envFirst("DINO_KEEP_OPEN_MS", "TVPLUS_KEEP_OPEN_MS") || "30000");
  await runAutomation({ headless, keepOpenMs });
}

export async function runStrongCli() {
  const headless = process.env.HEADLESS === "true";
  const keepOpenMs = Number(envFirst("STRONG_KEEP_OPEN_MS", "DINO_KEEP_OPEN_MS", "TVPLUS_KEEP_OPEN_MS") || "30000");
  await runStrongLoginUseCase({ headless, keepOpenMs });
}
