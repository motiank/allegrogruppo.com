// pino, like trade-hub and news-hub.
import pino from 'pino';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { svc: 'joya-hq' },
  redact: { paths: ['password', '*.password', 'token', '*.token', 'headers', '*.headers'], censor: '[redacted]' },
});

export default log;
