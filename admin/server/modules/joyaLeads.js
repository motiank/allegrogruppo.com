import { executeSql } from '../sources/dbpool.js';
import express from 'express';
import { Router as r404 } from './r404.js';

const VALID_STATUSES = new Set(['new', 'contacted', 'closed']);

class JoyaLeads {
  list(callback) {
    const query = `
      SELECT id, name, phone, email, guests, event_date, branch, message,
             status, notes, created_at, updated_at
      FROM joya_event_leads
      ORDER BY created_at DESC
    `;
    executeSql(query, {}, (dbRes) => {
      try {
        const result = dbRes.getRes();
        callback(result);
      } catch (e) {
        console.log('JoyaLeads.list EXCEPTION ' + e);
        callback({
          meta: { err: e.message || 'Database error', resType: 'error' },
          rows: [],
        });
      }
    });
  }

  update(params, callback) {
    const { id, status, notes } = params;
    if (!id) {
      return callback({
        meta: { err: 'id is required', resType: 'error' },
        rows: [],
      });
    }
    if (status != null && !VALID_STATUSES.has(status)) {
      return callback({
        meta: { err: 'invalid status', resType: 'error' },
        rows: [],
      });
    }
    const updateQuery = `
      UPDATE joya_event_leads
      SET status = COALESCE(:status, status),
          notes = :notes,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
    `;
    executeSql(
      updateQuery,
      { id, status: status ?? null, notes: notes != null ? String(notes) : null },
      (dbRes) => {
        try {
          const result = dbRes.getRes();
          if (result.meta.err) {
            callback(result);
            return;
          }
          const selectQuery = `
            SELECT id, name, phone, email, guests, event_date, branch, message,
                   status, notes, created_at, updated_at
            FROM joya_event_leads WHERE id = :id
          `;
          executeSql(selectQuery, { id }, (dbRes2) => {
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
          console.log('JoyaLeads.update EXCEPTION ' + e);
          callback({
            meta: { err: e.message || 'Database error', resType: 'error' },
            rows: [],
          });
        }
      },
    );
  }
}

export const Router = function () {
  const leads = new JoyaLeads();
  const router = express.Router();

  router.get('/', (req, res) => {
    leads.list((result) => {
      if (result.meta.err) {
        return res.status(400).json(result);
      }
      res.json(result);
    });
  });

  router.put('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        meta: { err: 'Invalid lead id', resType: 'error' },
        rows: [],
      });
    }
    const { status, notes } = req.body || {};
    leads.update({ id, status, notes }, (result) => {
      if (result.meta.err) {
        return res.status(400).json(result);
      }
      res.json(result);
    });
  });

  router.use('/*', r404());
  return router;
};
