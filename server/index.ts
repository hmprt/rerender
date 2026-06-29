import dotenv from "dotenv";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const secretsPath = path.join(os.homedir(), ".codex", "secrets", "x-api.env");
if (fs.existsSync(secretsPath)) {
  dotenv.config({ path: secretsPath });
}
dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 8788);

app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const origin = req.header("Origin");
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1):517\d$/.test(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.options("*", (_req, res) => {
  res.sendStatus(204);
});

const handleTokenRequest: express.RequestHandler = async (req, res) => {
  const submittedKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  const apiKey = submittedKey || process.env.REACTOR_API_KEY || process.env.REACTR_API_KEY;

  if (!apiKey) {
    res.status(400).json({
      error: "Enter a Reactor API key before connecting.",
    });
    return;
  }

  try {
    const response = await fetch("https://api.reactor.inc/tokens", {
      method: "POST",
      headers: {
        "Reactor-API-Key": apiKey,
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status).json({
        error: payload?.error ?? payload?.message ?? "Reactor token request failed.",
      });
      return;
    }

    res.json(payload);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Unable to reach Reactor.",
    });
  }
};

app.post("/api/reactor/token", handleTokenRequest);
app.post("/api/reactr/token", handleTokenRequest);

const distDir = path.join(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Rerender server listening on http://localhost:${port}`);
});
