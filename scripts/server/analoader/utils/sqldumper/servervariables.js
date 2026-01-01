// var geoip = require('geoip-lite');
import useragent from 'useragent';

var geoInfo = function (req) {
   return {}

   // var ip = req.headers['x-forwarded-for'] || 
   //     			 req.connection.remoteAddress || 
   //     			 req.socket.remoteAddress ||
   //     			 req.connection.socket.remoteAddress;

   //      if(req.query.dbgip){

   //        ip = req.query.dbgip;

   //      }

   //      ip = ip.replace(/[^\d.]/gi,"");

   //   		var geoInfo = geoip.lookup(ip);

   //   		return geoInfo;



};



export default {


   "geo": function (req) {
      var info = geoInfo(req);
      return info && info.country || "--";

   },
   "currentDateISO": function () {

      return new Date().toISOString().slice(0, 10);

   },

   "currentDate": function (formatting) {

      return new Date();

   },

   "currentTimeStampISO": function () {

      return new Date().toISOString();

   },

   "dbCurrentDate": function () {

      return 'CURRENT_DATE()'

   },

   "dbTimeStamp": function () {

      return 'CURRENT_TIMESTAMP()'

   },


   "browser": function (req) {

      var agent = useragent.parse(req.headers['user-agent']);
      return agent.toAgent();

   },

   "os": function (req) {

      var agent = useragent.parse(req.headers['user-agent']);
      return agent.os.toString(); // 'Mac OSX 10.8.1'

   }



};













