import express from "express";
import { runAutomation } from "./automation.mjs";

const app = express();
const port = Number(process.env.PORT || 8080);

let inFlight = false;

app.get("/health", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});

/**
 * GET /creatTestDino
 * Runs the TVPLUS Playwright flow and returns JSON:
 * { "url": "http://line.example.com", "username": "...", "password": "...", "playlistUrl": "..." }
 */
app.get("/creatTestDino", async (_req, res) => {
  if (inFlight) {
    return res.status(429).json({
      error: "Another automation run is in progress; try again shortly."
    });
  }
  inFlight = true;
  try {
    const headless = process.env.TVPLUS_API_HEADFUL === "true" ? false : true;
    const result = await runAutomation({ headless, keepOpenMs: 0 });
    if (!result) {
      return res.status(400).json({
        error: "Flow returned no credentials (TVPLUS_SKIP_ADD_LINE may be set)."
      });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || String(err) });
  } finally {
    inFlight = false;
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`HTTP server listening on 0.0.0.0:${port} (GET /creatTestDino, GET /health)`);
});
