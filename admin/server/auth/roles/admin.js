import express from "express";

import { Router as dashboard } from "../../modules/dashboard.js";

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
  
  return admin;
};

export default api;
