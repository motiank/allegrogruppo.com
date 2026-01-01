import sqlDmpr from './utils/sqldumper/index.js';

var dbConf = {
  reports: {
    bcom: {
      statement: 'INSERT IGNORE INTO allegro.bcom %s values %s',
      columns: {
        order_no: {
          defaultValue: '0',
          fromQueryString: 'order_no',
        },
        order_id: {
          fromQueryString: 'order_id',
          formatting: 'quote',
        },
        branchId: {
          fromQueryString: 'branchId',
          formatting: 'quote',
        },
        ts: {
          fromQueryString: 'openat',
          formatting: 'quote',
        },
        total: {
          defaultValue: '0',
          fromQueryString: 'total',
        },
        service: {
          defaultValue: '0',
          fromQueryString: 'service',
        },
        // table_no: {
        //   defaultValue: "0",
        //   fromQueryString: "table_no",
        // },
        discount: {
          defaultValue: '0',
          fromQueryString: 'discount',
        },
        // source: {
        //   fromQueryString: "source",
        //   formatting: "quote",
        // },
        diners: {
          defaultValue: '0',
          fromQueryString: 'diners',
        },
      },
    },

    bcom_cash: {
      statement: 'INSERT IGNORE INTO allegro.bcom_cash %s values %s',
      columns: {
        branchId: {
          fromQueryString: 'branchId',
          formatting: 'quote',
        },
        ts: {
          fromQueryString: 'openat',
          formatting: 'quote',
        },
        total: {
          defaultValue: '0',
          fromQueryString: 'total',
        },
        service: {
          defaultValue: '0',
          fromQueryString: 'service',
        },
        discount: {
          defaultValue: '0',
          fromQueryString: 'discount',
        },
        diners: {
          defaultValue: '0',
          fromQueryString: 'diners',
        },
      },
    },

    ontopo: {
      statement: 'INSERT IGNORE INTO allegro.ontopo %s values %s',
      columns: {
        branchId: {
          fromQueryString: 'branchId',
          formatting: 'quote',
        },
        source: {
          fromQueryString: 'Source',
          formatting: 'quote',
        },
        ts: {
          fromQueryString: 'week',
          formatting: 'quote',
        },

        bookings: {
          defaultValue: '0',
          fromQueryString: 'Bookings',
        },
        diners: {
          defaultValue: '0',
          fromQueryString: 'Diners',
        },
      },
    },
    astrateg: {
      statement: 'INSERT IGNORE INTO allegro.astrateg %s values %s',
      columns: {
        branchId: {
          fromQueryString: 'branchId',
          formatting: 'quote',
        },
        source: {
          fromQueryString: 'source',
          formatting: 'quote',
        },
        ts: {
          fromQueryString: 'week',
          formatting: 'quote',
        },

        ast_views: {
          defaultValue: '0',
          fromQueryString: 'ast_views',
        },
        ast_clicks: {
          defaultValue: '0',
          fromQueryString: 'ast_clicks',
        },
        ast_calls: {
          defaultValue: '0',
          fromQueryString: 'ast_calls',
        },
        ast_bookings: {
          defaultValue: '0',
          fromQueryString: 'ast_bookings',
        },
        ast_nav: {
          defaultValue: '0',
          fromQueryString: 'ast_nav',
        },
        ast_menu: {
          defaultValue: '0',
          fromQueryString: 'ast_menu',
        },
        ast_share: {
          defaultValue: '0',
          fromQueryString: 'ast_share',
        },
        ast_cost: {
          defaultValue: '0',
          fromQueryString: 'ast_cost',
        },
      },
    },
  },
};

export default {
  sqldmpr: null,
  init: function () {
    this.sqldmpr = sqlDmpr(dbConf, {
      // "interval" : 300000,
      interval: 1000 * 100,
      maxRecords: 100000,
    });
  },
  push: function (rid_, data_) {
    if (!this.sqldmpr) {
      this.init();
    }
    var rec_ = {
      rid: rid_,
      query: data_,
      params: data_.params || {},
    };
    this.sqldmpr.pushReport(rec_);
  },
  flush: function (cb_) {
    if (this.sqldmpr) {
      console.log('dal flush');
      this.sqldmpr.flush(cb_);
    } else {
      console.log('Sql dmper is not initliazed');
      cb_();
    }
  },
  dump: function (cb_) {
    if (this.sqldmpr) {
      console.log('dal flush');
      this.sqldmpr.dump(cb_);
    } else {
      console.log('Sql dmper is not initliazed');
      cb_();
    }
  },
};
