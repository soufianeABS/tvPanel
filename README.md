# TVPLUS automation

Playwright script for [TVPLUS login](https://tvpluspanel.ru/login), then (by default) **Add New | LINES** — the flow from your `htmlss.html` that creates a line user (M3U credentials come from the panel after the line exists).

## Setup

```bash
cd tvplus-automation
npm install
npx playwright install chromium
```

## Run (local CLI — browser + captcha)

```bash
npm run cli
```

## Optional: 2Captcha automation (headless login)

For unattended headless login, enable 2Captcha for GeeTest v4:

1. Create a [2Captcha](https://2captcha.com/) account and get your API key.
2. Set environment variables:

```bash
TVPLUS_CAPTCHA_PROVIDER=2captcha
TVPLUS_CAPTCHA_API_KEY=your_key_here
```

Optional tuning:

```bash
TVPLUS_CAPTCHA_TIMEOUT_MS=180000
TVPLUS_CAPTCHA_POLL_MS=5000
```

Notes:
- This is paid per solve and can be unreliable depending on provider response quality.
- Use only if allowed by your provider terms and local regulations.

## HTTP API (Fly.io / Docker)

`npm start` runs `server.mjs` on `PORT` (default **8080**).

- **GET `/creatTestDino`** — runs the full Playwright flow once, then responds with JSON:
  - `url` — origin of the line host (e.g. `http://line.example.com`)
  - `username`, `password` — parsed from the playlist `get.php?...` query string
  - `playlistUrl` — full playlist URL string from the Link modal `#link`
- **GET `/health`** — plain `ok` for health checks.

Only one automation run at a time; concurrent requests get **429**.

### Fly.io

1. Install the [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) and log in.
2. Edit `tvplus-automation/fly.toml` and set `app = "your-app-name"`, `primary_region`, and VM size if needed.
3. Set secrets (run from anywhere; secrets are per Fly app):

   ```bash
   fly secrets set TVPLUS_USERNAME=... TVPLUS_PASSWORD=... -a your-app-name
   ```

4. **Monorepo / Git connected to the whole repo:** Fly clones the **entire** repository. The **Docker build context** is what limits what gets built into the image. To deploy **only** this service, either:
   - From the **repo root**: `fly deploy ./tvplus-automation --remote-only` (build context = `tvplus-automation/` only; see [Fly monorepo paths](https://fly.io/docs/launch/monorepo/)), or  
   - In the Fly dashboard (if your UI offers it), set the app **source / working directory** to `tvplus-automation`, or  
   - Use a **GitHub Action** that runs `fly deploy ./tvplus-automation` so pushes do not try to build the whole Next.js app.

   If you run `fly deploy` from the **repo root** without a path, Fly uses the root as context and will **not** use `tvplus-automation/Dockerfile` unless you point it there explicitly.

5. Call `https://your-app-name.fly.dev/creatTestDino` (first request may cold-start the machine).

### Auto-deploy from GitHub (push -> Fly)

This repo includes `.github/workflows/deploy-fly.yml` to deploy automatically on every push to `main`.

One-time setup:

1. Create a Fly app once (if not already created):
   ```bash
   fly apps create your-app-name
   ```
2. Make sure `fly.toml` has the same app name in `app = "your-app-name"`.
3. Generate a Fly token:
   ```bash
   fly tokens create deploy
   ```
4. In GitHub, open **Settings -> Secrets and variables -> Actions**, add:
   - `FLY_API_TOKEN` = token from step 3.
5. Push to `main` and GitHub Actions will run `flyctl deploy --remote-only`.

**Captcha:** the panel login uses GeeTest. In headless mode, configure `TVPLUS_CAPTCHA_PROVIDER=2captcha` and `TVPLUS_CAPTCHA_API_KEY`, or run headful with manual captcha solving.

### Docker (local)

```bash
docker build -t tvplus-automation .
docker run --rm -p 8080:8080 --env-file .env tvplus-automation
```

## Flow (CLI and API)

1. Starts with captcha challenge handling, then fills `#uname` / `#upass`, and submits login.
2. Opens `https://tvpluspanel.ru/addnew?t=lines` (or `TVPLUS_ADDNEW_URL`).
3. Sets subscription (`#add_sub` → internal `#add_packid` via the page’s own `change` handler), country, optional notes, then **Select Package → Select All**, **Select VOD → Select All**, unchecks **1 - 4K UHD** (`#pack-fill-1`), then clicks **Confirm** (`#addnewButton` → `submitAddNew` / `api.php?action=add_new`).
4. Waits for redirect to `./users?s=lines` when the API succeeds (same as the page script).
5. On [users?s=lines](https://tvpluspanel.ru/users?s=lines), opens the **Link** dropdown on the **first table row** and the **Link** menu item; reads **`#link`**. The CLI logs it; **GET `/creatTestDino`** returns it as JSON (`url`, `username`, `password`, `playlistUrl`).

## Environment variables

Copy `.env.example` to `.env` and adjust.

| Variable | Meaning |
|----------|---------|
| `TVPLUS_USERNAME` / `TVPLUS_PASSWORD` | Login |
| `TVPLUS_CAPTCHA_PROVIDER` | Set `2captcha` to enable automated GeeTest solving during login |
| `TVPLUS_CAPTCHA_API_KEY` | 2Captcha API key (required when provider is `2captcha`) |
| `TVPLUS_CAPTCHA_TIMEOUT_MS` | Max wait time for captcha solve result (default `180000`) |
| `TVPLUS_CAPTCHA_POLL_MS` | Poll interval for captcha result (default `5000`) |
| `DINO_URL_HOST` | Optional override for JSON response `url` (example: `http://line.playmodx.com`) |
| `HEADLESS` | `true` only if you do not need captcha UI |
| `TVPLUS_SKIP_ADD_LINE` | `true` to stop after login |
| `TVPLUS_ADDNEW_URL` | Default `https://tvpluspanel.ru/addnew?t=lines` |
| `TVPLUS_USERS_LINES_URL` | Documented default list URL (logic uses current page URL after redirect) |
| `TVPLUS_LINE_SUBSCRIPTION` | `0`–`5` = 2Y, 1Y, 6M, 3M, 1M, 1D (default in code is **1 day** = `5`) |
| `TVPLUS_LINE_COUNTRY` | ISO code or empty for Auto |
| `TVPLUS_LINE_NOTES` | Optional `#add_comment` |
| `TVPLUS_KEEP_OPEN_MS` | How long to keep the browser open at the end (CLI) |
| `PORT` | HTTP server port (default `8080`) |
| `TVPLUS_API_HEADFUL` | If `true`, API runs with a visible browser (still need captcha solved manually) |

Notes:

- Captcha must still be solved manually in the browser when `HEADLESS=false`.
- In headless API mode, `/creatTestDino` requires `TVPLUS_CAPTCHA_PROVIDER=2captcha` + `TVPLUS_CAPTCHA_API_KEY`.
- The UI does not paste an M3U URL on this page; it creates a **line** with username in `#add_mac` and packages in `bouq_list[]`, matching your saved HTML.
