import express from 'express';
import { Router as r404 } from './r404.js';

/**
 * Order System Control Module
 * Allows admin to control the order system state (active, shutdown, postponed)
 */

const ORDER_SYSTEM_URL = process.env.ORDER_SYSTEM_URL;
const ORDER_SYSTEM_SECRET = process.env.ORDER_SYSTEM_SECRET || process.env.ADMIN_SECRET || 'change-me-in-production';

/**
 * Verify authentication token
 */
function verifyAuthToken(token) {
  if (!token) {
    return false;
  }
  return token === ORDER_SYSTEM_SECRET;
}

/**
 * Get order system state
 */
async function getOrderSystemState(req, res) {
  try {
    const url = `${ORDER_SYSTEM_URL}/api/order-state?token=${ORDER_SYSTEM_SECRET}`;
    // console.log('[orderSystem] URL:', url);
    const response = await globalThis.fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    // console.log('[orderSystem] Response:', response);

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to get order system state',
        status: response.status
      });
    }

    const state = await response.json();
    res.json(state);
  } catch (error) {
    console.error('[orderSystem] Error getting state:', error);
    res.status(500).json({
      error: 'Failed to communicate with order system',
      message: error.message
    });
  }
}

/**
 * Update order system state
 */
async function updateOrderSystemState(req, res) {
  const { state, updatedBy } = req.body;

  if (!state) {
    return res.status(400).json({
      error: 'State parameter is required',
      validStates: ['active', 'shutdown', 'postponed']
    });
  }

  const validStates = ['active', 'shutdown', 'postponed'];
  if (!validStates.includes(state)) {
    return res.status(400).json({
      error: `Invalid state. Must be one of: ${validStates.join(', ')}`
    });
  }

  try {
    const response = await globalThis.fetch(`${ORDER_SYSTEM_URL}/api/order-state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ORDER_SYSTEM_SECRET}`
      },
      body: JSON.stringify({
        state: state,
        updatedBy: updatedBy || req.user?.username || 'admin',
        token: ORDER_SYSTEM_SECRET
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: 'Failed to update order system state',
        status: response.status,
        details: errorData
      });
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('[orderSystem] Error updating state:', error);
    res.status(500).json({
      error: 'Failed to communicate with order system',
      message: error.message
    });
  }
}

/**
 * Handle notifications from order system
 */
function handleOrderNotification(req, res) {
  const authToken = req.headers.authorization?.replace('Bearer ', '') || req.body.token;

  if (!verifyAuthToken(authToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { type, order, timestamp } = req.body;

  console.log('[orderSystem] Received notification:', { type, orderId: order?.orderId, timestamp });

  // Here you could:
  // - Store notifications in database
  // - Send real-time updates to admin clients (WebSocket, SSE, etc.)
  // - Trigger alerts/notifications
  // - Update dashboard statistics

  // For now, just acknowledge receipt
  res.json({ received: true, timestamp: new Date().toISOString() });
}

export const Router = function() {
  const orderSystemRouter = express.Router();

  // GET /order-system/state - Get current order system state
  orderSystemRouter.get('/state', getOrderSystemState);

  // POST /order-system/state - Update order system state
  orderSystemRouter.post('/state', updateOrderSystemState);

  // POST /order-system/orders/notify - Receive notifications from order system
  orderSystemRouter.post('/orders/notify', handleOrderNotification);

  orderSystemRouter.use('/*', r404());

  return orderSystemRouter;
};

