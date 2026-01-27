import { executeSql } from '../sources/dbpool.js';
import express from 'express';
import { Router as r404 } from './r404.js';

class Affiliates {
  list(callback) {
    const query = `
      SELECT affiliate_id, name, phone, affiliate_code, created_at, updated_at
      FROM affiliate
      ORDER BY name
    `;
    executeSql(query, {}, (dbRes) => {
      try {
        const result = dbRes.getRes();
        callback(result);
      } catch (e) {
        console.log('Affiliates.list EXCEPTION ' + e);
        callback({
          meta: { err: e.message || 'Database error', resType: 'error' },
          rows: [],
        });
      }
    });
  }

  create(params, callback) {
    const { name, phone, affiliate_code } = params;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return callback({
        meta: { err: 'name is required', resType: 'error' },
        rows: [],
      });
    }
    const code = affiliate_code != null ? String(affiliate_code).trim().slice(0, 8) || null : null;
    const insertQuery = `
      INSERT INTO affiliate (name, phone, affiliate_code)
      VALUES (:name, :phone, :affiliate_code)
    `;
    executeSql(insertQuery, { name: name.trim(), phone: phone != null ? String(phone).trim() || null : null, affiliate_code: code }, (dbRes) => {
      try {
        const result = dbRes.getRes();
        if (result.meta.err) {
          callback(result);
          return;
        }
        const selectQuery = `SELECT affiliate_id, name, phone, affiliate_code, created_at, updated_at FROM affiliate ORDER BY affiliate_id DESC LIMIT 1`;
        executeSql(selectQuery, {}, (dbRes2) => {
          try {
            const res2 = dbRes2.getRes();
            if (res2.meta.err) {
              callback({ meta: { err: null, resType: 'content' }, rows: [{ name: name.trim(), phone: phone || null, affiliate_code: code }] });
              return;
            }
            callback({ meta: { err: null, resType: 'content' }, rows: res2.rows });
          } catch (e2) {
            callback({ meta: { err: null, resType: 'content' }, rows: [] });
          }
        });
      } catch (e) {
        console.log('Affiliates.create EXCEPTION ' + e);
        callback({
          meta: { err: e.message || 'Database error', resType: 'error' },
          rows: [],
        });
      }
    });
  }

  update(params, callback) {
    const { affiliate_id, name, phone, affiliate_code } = params;
    if (!affiliate_id) {
      return callback({
        meta: { err: 'affiliate_id is required', resType: 'error' },
        rows: [],
      });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return callback({
        meta: { err: 'name is required', resType: 'error' },
        rows: [],
      });
    }
    const code = affiliate_code != null ? String(affiliate_code).trim().slice(0, 8) || null : null;
    const updateQuery = `
      UPDATE affiliate
      SET name = :name, phone = :phone, affiliate_code = :affiliate_code, updated_at = CURRENT_TIMESTAMP
      WHERE affiliate_id = :affiliate_id
    `;
    executeSql(updateQuery, {
      affiliate_id,
      name: name.trim(),
      phone: phone != null ? String(phone).trim() || null : null,
      affiliate_code: code,
    }, (dbRes) => {
      try {
        const result = dbRes.getRes();
        if (result.meta.err) {
          callback(result);
          return;
        }
        const selectQuery = `SELECT affiliate_id, name, phone, affiliate_code, created_at, updated_at FROM affiliate WHERE affiliate_id = :affiliate_id`;
        executeSql(selectQuery, { affiliate_id }, (dbRes2) => {
          try {
            const res2 = dbRes2.getRes();
            callback({
              meta: { err: null, resType: 'content' },
              rows: res2.rows || [],
            });
          } catch (e2) {
            callback({ meta: { err: null, resType: 'content' }, rows: [] });
          }
        });
      } catch (e) {
        console.log('Affiliates.update EXCEPTION ' + e);
        callback({
          meta: { err: e.message || 'Database error', resType: 'error' },
          rows: [],
        });
      }
    });
  }
}

export const Router = function () {
  const affiliates = new Affiliates();
  const router = express.Router();

  router.get('/', (req, res) => {
    affiliates.list((result) => {
      if (result.meta.err) {
        return res.status(400).json(result);
      }
      res.json(result);
    });
  });

  router.post('/', (req, res) => {
    const { name, phone, affiliate_code } = req.body || {};
    affiliates.create({ name, phone, affiliate_code }, (result) => {
      if (result.meta.err) {
        return res.status(400).json(result);
      }
      res.status(201).json(result);
    });
  });

  router.put('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        meta: { err: 'Invalid affiliate id', resType: 'error' },
        rows: [],
      });
    }
    const { name, phone, affiliate_code } = req.body || {};
    affiliates.update({ affiliate_id: id, name, phone, affiliate_code }, (result) => {
      if (result.meta.err) {
        return res.status(400).json(result);
      }
      res.json(result);
    });
  });

  router.use('/*', r404());
  return router;
};
