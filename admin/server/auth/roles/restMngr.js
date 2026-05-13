import express from "express";

import { Router as payroll } from "../../modules/payroll.js";
import users from "../../sources/users.js";

const lookupAllowed = (req) =>
  new Promise((resolve) => {
    const uid = req.user && (req.user.user_id || req.user.id);
    if (!uid) return resolve([]);
    users.get({ user_id: uid }, (db_res) => {
      const row = db_res.getRes().rows[0];
      resolve(Array.isArray(row?.restaurants) ? row.restaurants : []);
    });
  });

const restrictRestaurant = async (req, res, next) => {
  let allowed = Array.isArray(req.user && req.user.restaurants)
    ? req.user.restaurants
    : null;
  if (!allowed) {
    allowed = await lookupAllowed(req);
    if (req.user) req.user.restaurants = allowed;
  }
  if (!allowed || allowed.length === 0) {
    return res
      .status(403)
      .json({ error: "no restaurants assigned to this user" });
  }
  const requested =
    (req.body && typeof req.body.rest === "string" && req.body.rest.trim()) ||
    (req.query &&
      typeof req.query.rest === "string" &&
      req.query.rest.trim()) ||
    "";
  if (requested && !allowed.includes(requested)) {
    return res
      .status(403)
      .json({ error: "restaurant not permitted for this user" });
  }
  if (Array.isArray(req.body && req.body.employees)) {
    const bad = req.body.employees.find(
      (e) => e && e.rest && !allowed.includes(String(e.rest).trim()),
    );
    if (bad) {
      return res
        .status(403)
        .json({ error: "restaurant not permitted for this user" });
    }
  }
  next();
};

const api = function () {
  var rest = express.Router();

  rest.get("/i-am", function (req, res) {
    res.jsonp({
      now: "" + new Date(),
      admin: "i am a restaurant manager",
      user: req.user,
    });
  });

  rest.use("/payroll", restrictRestaurant, payroll());
  return rest;
};

export default api;
