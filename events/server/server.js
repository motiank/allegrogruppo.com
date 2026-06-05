import express from "express";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env, .env_qa, or .envtest depending on
// command line args and NODE_ENV. Matches order_sys / admin behaviour so the
// whole monorepo shares one .env (DB credentials, etc.).
let envFileName = ".env";
if (process.argv.includes("qa")) {
  envFileName = ".env_qa";
} else if (process.env.NODE_ENV === "test") {
  envFileName = ".envtest";
}
console.log("[events] envFileName:", envFileName);
dotenv.config({ path: join(__dirname, "../..", envFileName) });

// Import routers after env variables are loaded.
const { default: eventsPageRouter, apiRouter: eventsApiRouter } = await import(
  "./modules/events.js"
);
const { default: joyaRouter } = await import("./modules/joya.js");

const app = express();
const PORT = process.env.EVENTS_PORT || 3023;

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS (mainly so the admin panel / previews can call the JSON API).
app.use((req, res, next) => {
  res.header(
    "Access-Control-Allow-Origin",
    process.env.EVENTS_CORS_ORIGIN || "http://localhost:5173",
  );
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept",
  );
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Health check.
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "events-server", port: PORT });
});

// Static assets (css, images bundled with the service).
app.use(express.static(join(__dirname, "../public")));

// JSON API.
app.use("/api/events", eventsApiRouter());

// Curated landing pages (registered before the /:restaurant catch-all so the
// slug isn't treated as a restaurant).
app.use("/joya", joyaRouter());

// Public landing pages (registered last; uses /:restaurant and
// /:restaurant/:slug, so keep specific routes above this).
app.use("/", eventsPageRouter());

app.listen(PORT, () => {
  console.log(`[events] server running on http://localhost:${PORT}`);
  console.log(`[events] health check: http://localhost:${PORT}/health`);
});
