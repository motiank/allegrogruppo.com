import express from "express";

import { Router as dashboard } from "../../modules/dashboard.js";
import { Router as orders } from "../../modules/orders.js";
import  allegro from "../../modules/allegro.js";
import { Router as orderSystem } from "../../modules/orderSystem.js";
import { Router as analytics } from "../../modules/analytics.js";
import { Router as affiliates } from "../../modules/affiliates.js";

const api = function () {
  var admin = express.Router();

  admin.get("/i-am", function (req, res) {
    res.jsonp({
      now: "" + new Date(),
      admin: "i am an admin",
      user: req.user,
    });
  });

  admin.use("/dashboard", dashboard());
  admin.use("/orders", orders());
  admin.use("/allegro", allegro());
  admin.use("/order-system", orderSystem());
  admin.use("/analytics", analytics());
  admin.use("/affiliates", affiliates());
  return admin;
};

export default api;
