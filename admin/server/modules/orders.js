import { executeSql } from "../sources/dbpool.js";
import express from 'express';
import { Router as r404 } from "./r404.js";

class Orders {
  /**
   * Get orders by date
   * @param {Object} params - Query parameters: date (YYYY-MM-DD format)
   * @param {Function} callback - Callback function to return results
   */
  getOrdersByDate(params, callback) {
    const { date } = params;
    
    if (!date) {
      return callback({
        meta: {
          err: 'Date parameter is required (format: YYYY-MM-DD)',
          resType: 'error'
        },
        rows: []
      });
    }

    // Validate date format (basic validation)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return callback({
        meta: {
          err: 'Invalid date format. Use YYYY-MM-DD',
          resType: 'error'
        },
        rows: []
      });
    }

    // Query orders for the specific date
    const query = `
      SELECT 
        id,
        orderId,
        total,
        currency,
        language,
        customer_name,
        phone,
        orderData,
        status,
        created_at,
        updated_at
      FROM orders 
      WHERE DATE(created_at) = :date
      ORDER BY created_at DESC
    `;

    executeSql(query, { date }, function(db_res) {
      try {
        callback(db_res.getRes());
      } catch(e) {
        console.log("getOrdersByDate EXCEPTION " + e);
        callback({
          meta: {
            err: e.message || 'Database error',
            resType: 'error'
          },
          rows: []
        });
      }
    });
  }

  /**
   * Update order status
   * @param {Object} params - Parameters: orderId, status
   * @param {Function} callback - Callback function to return results
   */
  updateOrderStatus(params, callback) {
    const { orderId, status } = params;
    
    if (!orderId || !status) {
      return callback({
        meta: {
          err: 'orderId and status parameters are required',
          resType: 'error'
        },
        rows: []
      });
    }

    // Validate status value
    const validStatuses = ['open', 'ready', 'delivered'];
    if (!validStatuses.includes(status)) {
      return callback({
        meta: {
          err: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
          resType: 'error'
        },
        rows: []
      });
    }

    const query = `
      UPDATE orders 
      SET status = :status, updated_at = CURRENT_TIMESTAMP
      WHERE orderId = :orderId
    `;

    executeSql(query, { orderId, status }, function(db_res) {
      try {
        const result = db_res.getRes();
        if (result.meta.err) {
          callback(result);
        } else {
          callback({
            meta: {
              err: null,
              resType: 'content'
            },
            rows: [{ orderId, status }],
            rowCount: result.rowCount || 0
          });
        }
      } catch(e) {
        console.log("updateOrderStatus EXCEPTION " + e);
        callback({
          meta: {
            err: e.message || 'Database error',
            resType: 'error'
          },
          rows: []
        });
      }
    });
  }

  /**
   * Get orders by date range (for future use)
   * @param {Object} params - Query parameters: fromDate, toDate (YYYY-MM-DD format)
   * @param {Function} callback - Callback function to return results
   */
  getOrdersByDateRange(params, callback) {
    const { fromDate, toDate } = params;
    
    if (!fromDate || !toDate) {
      return callback({
        meta: {
          err: 'Both fromDate and toDate parameters are required (format: YYYY-MM-DD)',
          resType: 'error'
        },
        rows: []
      });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      return callback({
        meta: {
          err: 'Invalid date format. Use YYYY-MM-DD',
          resType: 'error'
        },
        rows: []
      });
    }

    const query = `
      SELECT 
        id,
        orderId,
        total,
        currency,
        language,
        customer_name,
        phone,
        orderData,
        status,
        created_at,
        updated_at
      FROM orders 
      WHERE DATE(created_at) >= :fromDate AND DATE(created_at) <= :toDate
      ORDER BY created_at DESC
    `;

    executeSql(query, { fromDate, toDate }, function(db_res) {
      try {
        callback(db_res.getRes());
      } catch(e) {
        console.log("getOrdersByDateRange EXCEPTION " + e);
        callback({
          meta: {
            err: e.message || 'Database error',
            resType: 'error'
          },
          rows: []
        });
      }
    });
  }
}

export const Router = function() {
  const orders = new Orders();
  
  const ordersRouter = express.Router();

  // GET /orders?date=2024-01-15
  ordersRouter.get('/', function(req, res) {
    const { date, fromDate, toDate } = req.query;
    
    // Support both single date and date range
    if (date) {
      console.log("getOrdersByDate " + JSON.stringify({ date }));
      orders.getOrdersByDate({ date }, (result) => {
        if (result.meta.err) {
          return res.status(400).json(result);
        }
        res.json(result);
      });
    } else if (fromDate && toDate) {
      console.log("getOrdersByDateRange " + JSON.stringify({ fromDate, toDate }));
      orders.getOrdersByDateRange({ fromDate, toDate }, (result) => {
        if (result.meta.err) {
          return res.status(400).json(result);
        }
        res.json(result);
      });
    } else {
      res.status(400).json({
        meta: {
          err: 'Either date parameter or both fromDate and toDate parameters are required',
          resType: 'error'
        },
        rows: []
      });
    }
  });

  // PUT /orders/:orderId/status
  ordersRouter.put('/:orderId/status', function(req, res) {
    const { orderId } = req.params;
    const { status } = req.body;
    
    console.log("updateOrderStatus " + JSON.stringify({ orderId, status }));
    orders.updateOrderStatus({ orderId, status }, (result) => {
      if (result.meta.err) {
        return res.status(400).json(result);
      }
      res.json(result);
    });
  });

  ordersRouter.use("/*", r404());
  
  return ordersRouter;
};

