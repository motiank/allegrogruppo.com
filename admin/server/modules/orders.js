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
    const validStatuses = ['open', 'in_preparation', 'in_delivery', 'closed', 'ready', 'delivered']; // Support both old and new statuses
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

  /**
   * Get dashboard statistics for orders
   * @param {Object} params - Query parameters: date (YYYY-MM-DD format, defaults to DASHBOARD_DATE_PERIOD env var or today)
   * @param {Function} callback - Callback function to return results
   */
  getDashboardStats(params, callback) {
    const { date } = params;
    
    // Determine the date to use
    let queryDate = date;
    
    // If no date provided, use environment variable or default to today
    if (!queryDate) {
      const dashboardDatePeriod = process.env.DASHBOARD_DATE_PERIOD || 'today';
      
      if (dashboardDatePeriod === 'today') {
        queryDate = new Date().toISOString().split('T')[0];
      } else if (dashboardDatePeriod === 'yesterday') {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        queryDate = yesterday.toISOString().split('T')[0];
      } else {
        // Assume it's a date in YYYY-MM-DD format
        queryDate = dashboardDatePeriod;
      }
    }
    
    // Validate date format (basic validation)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(queryDate)) {
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
      WHERE DATE(created_at) = :date
      ORDER BY created_at DESC
    `;

    executeSql(query, { date: queryDate }, function(db_res) {
      try {
        const result = db_res.getRes();
        if (result.meta.err) {
          callback(result);
          return;
        }

        const orders = result.rows || [];
        
        // Normalize statuses and extract beecom order numbers
        const normalizedOrders = orders.map(order => {
          // Extract beecom order number from orderData
          let beecomOrderNumber = null;
          try {
            const orderData = typeof order.orderData === 'string' 
              ? JSON.parse(order.orderData) 
              : order.orderData;
            beecomOrderNumber = orderData.beecomOrderNumber || orderData.beecom?.orderNumber || null;
          } catch (e) {
            // Ignore parse errors
          }
          
          // Normalize status (map old statuses to new ones for backward compatibility)
          let normalizedStatus = order.status || 'open';
          if (normalizedStatus === 'ready') normalizedStatus = 'in_preparation';
          if (normalizedStatus === 'delivered') normalizedStatus = 'closed';
          // Keep other statuses as-is: 'open', 'in_preparation', 'in_delivery', 'closed'
          
          return {
            ...order,
            status: normalizedStatus,
            beecomOrderNumber: beecomOrderNumber,
            customerName: order.customer_name || 'N/A'
          };
        });
        
        // Calculate statistics using normalized orders
        const stats = {
          totalOrders: normalizedOrders.length,
          totalIncome: normalizedOrders.reduce((sum, order) => sum + parseFloat(order.total || 0), 0),
          averageOrderPrice: normalizedOrders.length > 0 
            ? normalizedOrders.reduce((sum, order) => sum + parseFloat(order.total || 0), 0) / normalizedOrders.length 
            : 0,
          ordersByStatus: {
            open: normalizedOrders.filter(o => o.status === 'open').length,
            in_preparation: normalizedOrders.filter(o => o.status === 'in_preparation').length,
            in_delivery: normalizedOrders.filter(o => o.status === 'in_delivery').length,
            closed: normalizedOrders.filter(o => o.status === 'closed').length,
          },
          orders: normalizedOrders
        };

        callback({
          meta: {
            err: null,
            resType: 'content'
          },
          rows: [stats],
          date: queryDate,
          datePeriod: process.env.DASHBOARD_DATE_PERIOD || 'today'
        });
      } catch(e) {
        console.log("getDashboardStats EXCEPTION " + e);
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

  // GET /orders/dashboard/stats?date=2024-01-15
  ordersRouter.get('/dashboard/stats', function(req, res) {
    const { date } = req.query;
    
    console.log("getDashboardStats " + JSON.stringify({ date }));
    orders.getDashboardStats({ date }, (result) => {
      if (result.meta.err) {
        return res.status(400).json(result);
      }
      res.json(result);
    });
  });

  ordersRouter.use("/*", r404());
  
  return ordersRouter;
};

