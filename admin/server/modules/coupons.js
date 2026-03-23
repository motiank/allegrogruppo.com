import { executeSql } from '../sources/dbpool.js';
import express from 'express';
import { Router as r404 } from './r404.js';

class Coupons {
  list(callback) {
    const query = `
      SELECT coupon_id, name, type, created_at, expired_at, used_at, cancelled_at
      FROM coupons
      ORDER BY created_at DESC
    `;
    executeSql(query, {}, (dbRes) => {
      try {
        const result = dbRes.getRes();
        callback(result);
      } catch (e) {
        console.log('Coupons.list EXCEPTION ' + e);
        callback({
          meta: { err: e.message || 'Database error', resType: 'error' },
          rows: [],
        });
      }
    });
  }

  create(params, callback) {
    const { name, type, expired_at } = params;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return callback({
        meta: { err: 'name is required', resType: 'error' },
        rows: [],
      });
    }
    const insertQuery = `
      INSERT INTO coupons (name, type, expired_at)
      VALUES (:name, :type, :expired_at)
    `;
    const expiredAtValue = expired_at && expired_at.trim() ? expired_at.trim() : null;
    executeSql(insertQuery, { 
      name: name.trim(), 
      type: type != null ? String(type).trim() || null : null,
      expired_at: expiredAtValue
    }, (dbRes) => {
      try {
        const result = dbRes.getRes();
        if (result.meta.err) {
          callback(result);
          return;
        }
        const selectQuery = `SELECT coupon_id, name, type, created_at, expired_at, used_at, cancelled_at FROM coupons ORDER BY coupon_id DESC LIMIT 1`;
        executeSql(selectQuery, {}, (dbRes2) => {
          try {
            const res2 = dbRes2.getRes();
            if (res2.meta.err) {
              callback({ meta: { err: null, resType: 'content' }, rows: [{ name: name.trim(), type: type || null, expired_at: expiredAtValue }] });
              return;
            }
            callback({ meta: { err: null, resType: 'content' }, rows: res2.rows });
          } catch (e2) {
            callback({ meta: { err: null, resType: 'content' }, rows: [] });
          }
        });
      } catch (e) {
        console.log('Coupons.create EXCEPTION ' + e);
        callback({
          meta: { err: e.message || 'Database error', resType: 'error' },
          rows: [],
        });
      }
    });
  }

  update(params, callback) {
    const { coupon_id, name, type, expired_at } = params;
    if (!coupon_id) {
      return callback({
        meta: { err: 'coupon_id is required', resType: 'error' },
        rows: [],
      });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return callback({
        meta: { err: 'name is required', resType: 'error' },
        rows: [],
      });
    }
    const expiredAtValue = expired_at && expired_at.trim() ? expired_at.trim() : null;
    const updateQuery = `
      UPDATE coupons
      SET name = :name, type = :type, expired_at = :expired_at
      WHERE coupon_id = :coupon_id AND cancelled_at IS NULL
    `;
    executeSql(updateQuery, {
      coupon_id,
      name: name.trim(),
      type: type != null ? String(type).trim() || null : null,
      expired_at: expiredAtValue,
    }, (dbRes) => {
      try {
        const result = dbRes.getRes();
        if (result.meta.err) {
          callback(result);
          return;
        }
        const selectQuery = `SELECT coupon_id, name, type, created_at, expired_at, used_at, cancelled_at FROM coupons WHERE coupon_id = :coupon_id`;
        executeSql(selectQuery, { coupon_id }, (dbRes2) => {
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
        console.log('Coupons.update EXCEPTION ' + e);
        callback({
          meta: { err: e.message || 'Database error', resType: 'error' },
          rows: [],
        });
      }
    });
  }

  cancel(params, callback) {
    const { coupon_id } = params;
    if (!coupon_id) {
      return callback({
        meta: { err: 'coupon_id is required', resType: 'error' },
        rows: [],
      });
    }
    const cancelQuery = `
      UPDATE coupons
      SET cancelled_at = CURRENT_TIMESTAMP
      WHERE coupon_id = :coupon_id AND cancelled_at IS NULL
    `;
    executeSql(cancelQuery, { coupon_id }, (dbRes) => {
      try {
        const result = dbRes.getRes();
        if (result.meta.err) {
          callback(result);
          return;
        }
        const selectQuery = `SELECT coupon_id, name, type, created_at, expired_at, used_at, cancelled_at FROM coupons WHERE coupon_id = :coupon_id`;
        executeSql(selectQuery, { coupon_id }, (dbRes2) => {
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
        console.log('Coupons.cancel EXCEPTION ' + e);
        callback({
          meta: { err: e.message || 'Database error', resType: 'error' },
          rows: [],
        });
      }
    });
  }
}

export const Router = function () {
  const coupons = new Coupons();
  const router = express.Router();

  router.get('/', (req, res) => {
    coupons.list((result) => {
      if (result.meta.err) {
        return res.status(400).json(result);
      }
      res.json(result);
    });
  });

  router.post('/', (req, res) => {
    const { name, type, expired_at } = req.body || {};
    coupons.create({ name, type, expired_at }, (result) => {
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
        meta: { err: 'Invalid coupon id', resType: 'error' },
        rows: [],
      });
    }
    const { name, type, expired_at } = req.body || {};
    coupons.update({ coupon_id: id, name, type, expired_at }, (result) => {
      if (result.meta.err) {
        return res.status(400).json(result);
      }
      res.json(result);
    });
  });

  router.post('/:id/cancel', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        meta: { err: 'Invalid coupon id', resType: 'error' },
        rows: [],
      });
    }
    coupons.cancel({ coupon_id: id }, (result) => {
      if (result.meta.err) {
        return res.status(400).json(result);
      }
      res.json(result);
    });
  });

  router.use('/*', r404());
  return router;
};
