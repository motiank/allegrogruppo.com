import express from 'express';
import { executeSql } from '../sources/dbpool.js';
import { Router as r404 } from './r404.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

/**
 * Trigger the analytics data update process
 * This spawns the analoader script as a child process
 */
async function updateData(req, res) {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    // Path to the analoader script
    // From admin/server/modules/analytics.js to scripts/server/analoader/index.js
    const scriptPath = join(__dirname, '../../../scripts/server/analoader/index.js');
    
    console.log('[Analytics] Starting data update process...');
    console.log('[Analytics] Script path:', scriptPath);
    
    // Spawn the update process
    const updateProcess = spawn('node', [scriptPath], {
      cwd: join(__dirname, '../../../'),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    
    let stdout = '';
    let stderr = '';
    
    updateProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('[Analytics Update]', data.toString());
    });
    
    updateProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('[Analytics Update Error]', data.toString());
    });
    
    updateProcess.on('close', (code) => {
      if (code === 0) {
        console.log('[Analytics] Update process completed successfully');
      } else {
        console.error(`[Analytics] Update process exited with code ${code}`);
      }
    });
    
    updateProcess.on('error', (error) => {
      console.error('[Analytics] Failed to start update process:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start update process',
        message: error.message
      });
    });
    
    // Don't wait for the process to complete - return immediately
    // The process will run in the background
    res.json({
      success: true,
      message: 'Data update process started',
      pid: updateProcess.pid
    });
    
  } catch (error) {
    console.error('[Analytics] Error triggering data update:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger data update',
      message: error.message
    });
  }
}

/**
 * Get performance data for restaurants
 * Returns 29 days of income data for each restaurant
 * Endpoint: GET /analytics/performance/:refdate
 * @param {string} refdate - Reference date in YYYY-MM-DD format (default: yesterday)
 */
async function getPerformance(req, res) {
  try {
    let { refdate } = req.params;
    
    // Validate and set default refdate to yesterday if not provided
    if (!refdate) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      refdate = yesterday.toISOString().split('T')[0];
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(refdate)) {
      return res.status(400).json({
        error: 'Invalid date format. Use YYYY-MM-DD',
        message: `Received: ${refdate}`
      });
    }
    
    // Calculate start date (29 days before refdate, inclusive)
    const query = `
      SELECT 
        COALESCE(c.branchName, c.branchId) as restaurantName,
        DATE(b.ts) as date,
        COALESCE(SUM(b.total), 0) as income
      FROM allegro.bcom_cash b
      LEFT JOIN allegro.branches c ON b.branchId = c.branchId
      WHERE DATE(b.ts) BETWEEN DATE_SUB(:refdate, INTERVAL 28 DAY) AND :refdate
        AND c.branchId IS NOT NULL
      GROUP BY c.branchId, COALESCE(c.branchName, c.branchId), DATE(b.ts)
      ORDER BY restaurantName, DATE(b.ts)
    `;
    
    const [rows] = await executeSql(query, { refdate });
    
    // Organize data by restaurant name
    // Structure: { "restaurantName": [incomeDay1, incomeDay2, ..., incomeDay29] }
    const result = {};
    const dateMap = new Map(); // Track which dates we have for each restaurant
    
    // Initialize all restaurants with 29 days of zeros
    rows.forEach(row => {
      if (!result[row.restaurantName]) {
        result[row.restaurantName] = new Array(29).fill(0);
        dateMap.set(row.restaurantName, new Map());
      }
    });
    
    // Fill in actual income values
    rows.forEach(row => {
      const restaurantName = row.restaurantName;
      if (!result[restaurantName]) {
        result[restaurantName] = new Array(29).fill(0);
        dateMap.set(restaurantName, new Map());
      }
      
      // Calculate which day index this date represents (0-28)
      const rowDate = new Date(row.date);
      const refDate = new Date(refdate);
      const daysDiff = Math.floor((refDate - rowDate) / (1000 * 60 * 60 * 24));
      const dayIndex = 28 - daysDiff; // Reverse index (day 0 is 28 days ago, day 28 is refdate)
      
      if (dayIndex >= 0 && dayIndex < 29) {
        result[restaurantName][dayIndex] = parseFloat(row.income) || 0;
        dateMap.get(restaurantName).set(row.date, dayIndex);
      }
    });
    
    res.json(result);
  } catch (error) {
    console.error('[Analytics] Error fetching performance data:', error);
    res.status(500).json({
      error: 'Failed to fetch performance data',
      message: error.message
    });
  }
}

export const Router = function() {
  const analyticsRouter = express.Router();
  
  // GET /analytics/event-counts - Get counts for welcome_started, meal_added_to_cart, payment_step_opened
  analyticsRouter.get('/event-counts', getEventCounts);
  
  // POST /analytics/update-data - Trigger the analytics data update process
  analyticsRouter.post('/update-data', updateData);
  
  // GET /analytics/performance/:refdate - Get restaurant performance data (29 days of income)
  analyticsRouter.get('/performance/:refdate', getPerformance);
  
  analyticsRouter.use('/*', r404());
  
  return analyticsRouter;
};
