import util from "util";
import moment from "moment";

function sql_escape(str) {
  if (typeof str !== "string") return str;
  return str.replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, function (char) {
    switch (char) {
      case "\0":
        return "\\0";
      case "\x08":
        return "\\b";
      case "\x09":
        return "\\t";
      case "\x1a":
        return "\\z";
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case '"':
      case "'":
      case "\\":
      case "%":
        return "\\" + char; // prepends a backslash to backslash, percent,
      // and double/single quotes
    }
  });
}

var formatHandlers = {
  quote: function (val) {
    return util.format(`'%s'`, sql_escape(val));
  },

  hex: function (val) {
    return util.format("0x%s", val);
  },

  date: function (val, format) {
    var res;
    try {
      res = moment().format(format);
    } catch (e) {
      res = moment().format("YYYY-MM-DD HH:mm:ss");
    }

    return res;
  },

  noop: function (val) {
    return val;
  },
};

var extractHandlerAndParams = function (handlerInvocationToken) {
  // 1.extract the formatting handler.
  var regex = /(.+?)(?:\((.+?)\))?$/,
    matches = regex.exec(handlerInvocationToken) || [],
    formatHandler = formatHandlers[matches[1]] || formatHandlers.noop;
  var retMapping = {
    handler: formatHandler,
    params: [],
  };

  // 2.extract the parameters.
  if (matches[2]) {
    //. try to split to multiple parameters.
    retMapping.params = matches[2].split(/\s*,\s*/);
  }

  return retMapping;
};

const format = (handler, value) => {
  var handlerAndParams = extractHandlerAndParams(handler);
  return handlerAndParams.handler.apply(null, [value].concat(handlerAndParams.params));
};

export default format;
