import express from "express";
import { executeSql } from "../sources/dbpool.js";
import {
  renderEventPage,
  renderEventList,
  renderNotFound,
} from "../render/templates.js";
import { baseUrlFor } from "../render/html.js";

// ---------------------------------------------------------------------------
// Events module: read-only public access to published events.
//
// The admin backend (handled separately, later) owns the write side — creating,
// editing and publishing events. This service only *reads* published rows and
// renders landing pages, so it is intentionally read-only.
//
// `restaurant_slug` matches the restaurant slugs already used across the
// project (see admin/server/modules/allegro.js for the canonical name map,
// e.g. "eatalia", "la-braza", "pasta-lina").
// ---------------------------------------------------------------------------

const PUBLISHED = "published";

// Columns we expose publicly (avoid SELECT * so internal columns never leak).
const PUBLIC_COLUMNS = `
  id, restaurant_slug, slug, title, subtitle, summary, body_html,
  hero_image_url, og_image_url, location, starts_at, ends_at, price,
  cta_label, cta_url, lang, published_at`;

const fetchEvent = async (restaurantSlug, slug) => {
  const [rows] = await executeSql(
    `SELECT ${PUBLIC_COLUMNS} FROM events
     WHERE restaurant_slug = :restaurant AND slug = :slug AND status = :status
     LIMIT 1`,
    { restaurant: restaurantSlug, slug, status: PUBLISHED },
  );
  return rows[0] || null;
};

const fetchEvents = async (restaurantSlug) => {
  const [rows] = await executeSql(
    `SELECT ${PUBLIC_COLUMNS} FROM events
     WHERE restaurant_slug = :restaurant AND status = :status
     ORDER BY COALESCE(starts_at, published_at, created_at) DESC`,
    { restaurant: restaurantSlug, status: PUBLISHED },
  );
  return rows;
};

// JSON API — handy for the admin panel, previews, or other consumers.
// Mounted at /api/events
export const apiRouter = () => {
  const router = express.Router();

  router.get("/:restaurant", async (req, res) => {
    try {
      const events = await fetchEvents(req.params.restaurant);
      res.json({ restaurant: req.params.restaurant, events });
    } catch (e) {
      console.error("[events] api list error:", e);
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/:restaurant/:slug", async (req, res) => {
    try {
      const event = await fetchEvent(req.params.restaurant, req.params.slug);
      if (!event) return res.status(404).json({ error: "not_found" });
      res.json({ event });
    } catch (e) {
      console.error("[events] api event error:", e);
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
};

// HTML landing pages — the public-facing site. Mounted at /
export default () => {
  const router = express.Router();

  // Restaurant events listing: /:restaurant
  router.get("/:restaurant", async (req, res) => {
    const { restaurant } = req.params;
    try {
      const events = await fetchEvents(restaurant);
      const html = renderEventList({
        events,
        restaurant,
        baseUrl: baseUrlFor(req),
      });
      res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (e) {
      console.error("[events] list page error:", e);
      res.status(500).send(renderNotFound({ message: "Something went wrong" }));
    }
  });

  // Single event landing page: /:restaurant/:slug
  router.get("/:restaurant/:slug", async (req, res) => {
    const { restaurant, slug } = req.params;
    try {
      const event = await fetchEvent(restaurant, slug);
      if (!event) {
        return res
          .status(404)
          .set("Content-Type", "text/html; charset=utf-8")
          .send(renderNotFound());
      }
      const html = renderEventPage({
        event,
        restaurant,
        baseUrl: baseUrlFor(req),
      });
      res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (e) {
      console.error("[events] event page error:", e);
      res.status(500).send(renderNotFound({ message: "Something went wrong" }));
    }
  });

  return router;
};
