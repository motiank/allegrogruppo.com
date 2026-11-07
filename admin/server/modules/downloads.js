// Downloads page: install packages built from this repo, for the admin role only (mounted by auth/roles/admin.js
// at /admin/downloads, behind the login). Nothing is stored: each package is built from the deployed code when it
// is asked for, so the download always matches the repo on the server.
//   GET /admin/downloads            → the list: [{ id, name, fileName, version, size, files, description }]
//   GET /admin/downloads/:id        → the zip file (Content-Disposition: attachment)
import express from "express";
import { buildWindowsPackage } from "../../../hash-sync/scripts/build-windows-package.js";

const PACKAGES = {
  "hash-sync-windows": {
    name: "Hashavshevet sync for Windows",
    description:
      "Copies the Hashavshevet database (SQL Server) into allegro_finance every night. Install it on the Windows " +
      "computer that runs the Hashavshevet SQL Server. The zip has no passwords; the guide INSTALL.md is inside.",
    build: buildWindowsPackage,
  },
};

export function Router() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    try {
      const list = [];
      for (const [id, pkg] of Object.entries(PACKAGES)) {
        const built = await pkg.build();
        list.push({ id, name: pkg.name, description: pkg.description, fileName: built.fileName, version: built.version,
          size: built.buffer.length, files: built.files, url: `/admin/downloads/${id}` });
      }
      res.json({ packages: list });
    } catch (err) {
      console.error("[downloads] list failed:", err);
      res.status(500).json({ error: { message: `could not build the package list: ${err.message}` } });
    }
  });

  router.get("/:id", async (req, res) => {
    const pkg = PACKAGES[req.params.id];
    if (!pkg) return res.status(404).json({ error: { message: `no package "${req.params.id}"` } });
    try {
      const built = await pkg.build();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Length", built.buffer.length);
      res.setHeader("Content-Disposition", `attachment; filename="${built.fileName}"`);
      res.setHeader("Cache-Control", "no-store");
      res.end(built.buffer);
    } catch (err) {
      console.error(`[downloads] ${req.params.id} failed:`, err);
      res.status(500).json({ error: { message: `could not build the package: ${err.message}` } });
    }
  });

  return router;
}
