import express from 'express';
import { executeSql } from './sources/dbpool.js';

const router = express.Router();

/**
 * Analytics tracking endpoint
 * POST /api/track
 */
router.post('/track', async (req, res) => {
  try {
    const { event, data } = req.body;
    const userId = data?.userId || 'unknown';
    
    // Extract domain from request
    // Try Referer header first, then Host header, then request hostname
    let domain = null;
    if (data?.domain) {
      domain = data.domain;
    } else if (req.headers.referer) {
      try {
        const url = new URL(req.headers.referer);
        domain = url.hostname;
      } catch (e) {
        // Invalid URL, try next option
      }
    }
    if (!domain && req.headers.host) {
      domain = req.headers.host;
    }
    if (!domain && req.hostname) {
      domain = req.hostname;
    }
    
    // Prepare event details JSON (exclude userId and domain as they're separate columns)
    const { userId: _, domain: __, ...eventDetails } = data || {};
    const detailsJson = Object.keys(eventDetails).length > 0 ? JSON.stringify(eventDetails) : null;
    
    // Insert event into database
    const insertQuery = `
      INSERT INTO analytics_events (userId, domain, event_name, details, timestamp)
      VALUES (:userId, :domain, :event_name, :details, NOW())
    `;
    
    const insertParams = {
      userId: userId,
      domain: domain,
      event_name: event || 'unknown',
      details: detailsJson
    };
    
    const result = await executeSql(insertQuery, insertParams);
    const affectedRows = result[1]?.affectedRows || 0;
    
    if (affectedRows > 0) {
      console.log(`[Analytics] Event saved to database: ${event}, UserId: ${userId}, Domain: ${domain}`);
    } else {
      console.warn(`[Analytics] Event insert returned 0 affected rows: ${event}`);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Analytics] Error saving event to database:', error.message);
    console.error('[Analytics] Event data:', { event, userId: data?.userId, domain });
    
    // Check if error is due to missing table
    if (error.message && error.message.includes("doesn't exist")) {
      console.error('[Analytics] Table analytics_events does not exist. Please run: scripts/create_analytics_events_table.sql');
    }
    
    // Still return success to avoid breaking client-side tracking
    // Log the error for debugging
    res.json({ success: true, error: 'Failed to save event' });
  }
});

export default router;

