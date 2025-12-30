import express from 'express';
import { executeSql } from '../sources/dbpool.js';
import { Router as r404 } from './r404.js';

/**
 * Analytics Module
 * Provides endpoints for analytics event statistics
 */

/**
 * Get event counts for specific events
 * Query parameters: start (YYYY-MM-DD), end (YYYY-MM-DD) - optional
 */
async function getEventCounts(req, res) {
  try {
    const { start, end } = req.query;
    
    // Build WHERE clause for date filtering
    let dateFilter = '';
    const params = {};
    
    if (start && end) {
      dateFilter = 'WHERE DATE(timestamp) BETWEEN :start AND :end';
      params.start = start;
      params.end = end;
    } else if (start) {
      dateFilter = 'WHERE DATE(timestamp) >= :start';
      params.start = start;
    } else if (end) {
      dateFilter = 'WHERE DATE(timestamp) <= :end';
      params.end = end;
    }
    
    // Build WHERE clause with proper AND/WHERE placement
    const whereClause = dateFilter 
      ? `${dateFilter} AND event_name IN ('welcome_started', 'meal_added_to_cart', 'payment_step_opened')`
      : `WHERE event_name IN ('welcome_started', 'meal_added_to_cart', 'payment_step_opened')`;
    
    // Query to get unique user counts for the three events
    const query = `
      SELECT 
        event_name,
        COUNT(DISTINCT userId) as count
      FROM analytics_events
      ${whereClause}
      GROUP BY event_name
    `;
    
    const [rows] = await executeSql(query, params);
    
    // Initialize counts
    const counts = {
      welcome_started: 0,
      meal_added_to_cart: 0,
      payment_step_opened: 0
    };
    
    // Populate counts from query results
    rows.forEach(row => {
      if (counts.hasOwnProperty(row.event_name)) {
        counts[row.event_name] = parseInt(row.count) || 0;
      }
    });
    
    res.json(counts);
  } catch (error) {
    console.error('[Analytics] Error fetching event counts:', error);
    res.status(500).json({
      error: 'Failed to fetch event counts',
      message: error.message
    });
  }
}

export const Router = function() {
  const analyticsRouter = express.Router();
  
  // GET /analytics/event-counts - Get counts for welcome_started, meal_added_to_cart, payment_step_opened
  analyticsRouter.get('/event-counts', getEventCounts);
  
  analyticsRouter.use('/*', r404());
  
  return analyticsRouter;
};
