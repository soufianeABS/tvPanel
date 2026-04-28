import express from "express";
import { runDinoUseCase } from "./dino-usecase.mjs";
import { runStrongUseCase } from "./strong-usecase.mjs";

const app = express();
const port = Number(process.env.PORT || 8080);

let inFlight = false;

app.get("/health", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});

app.get("/testServer", async (_req, res) => {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  res.json({ value1: "valule1" });
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
    const headless = process.env.API_HEADFUL === "true" || process.env.TVPLUS_API_HEADFUL === "true" ? false : true;
    const result = await runDinoUseCase({ headless, keepOpenMs: 0 });
    if (!result) {
      return res.status(400).json({
        error: "Flow returned no credentials."
      });
    }
    console.log("[api:/creatTestDino] response payload:", result);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || String(err) });
  } finally {
    inFlight = false;
  }
});

/**
 * GET /creatStrongTest
 * Runs the strong login-only use case and returns JSON:
 * { "ok": true, "url": "...", "usernameSelector": "...", "passwordSelector": "..." }
 */
app.get("/creatStrongTest", async (_req, res) => {
  if (inFlight) {
    return res.status(429).json({
      error: "Another automation run is in progress; try again shortly."
    });
  }
  inFlight = true;
  try {
    const headless = process.env.API_HEADFUL === "true" || process.env.TVPLUS_API_HEADFUL === "true" ? false : true;
    const result = await runStrongUseCase({ headless, keepOpenMs: 0 });
    console.log("[api:/creatStrongTest] response payload:", result);
    const normalized = {
      url: result?.url || "",
      username: result?.username || "",
      password: result?.password || "",
      playlistUrl: result?.playlistUrl || ""
    };
    console.log("[api:/creatStrongTest] normalized payload:", normalized);
    res.json(normalized);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || String(err) });
  } finally {
    inFlight = false;
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(
    `HTTP server listening on 0.0.0.0:${port} (GET /creatTestDino, GET /creatStrongTest, GET /testServer, GET /health)`
  );
});
