const pino = require('pino');

// Redact common sensitive fields
const redact = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'headers.authorization',
    'headers.cookie',
    'authorization',
    'cookie'
  ],
  remove: true
};

// Use pretty logging for local/Docker environments
const isDevelopment = process.env.NODE_ENV !== 'production' ||
                     process.env.S3_ENDPOINT || // Local MinIO
                     process.env.DATABASE_URL?.includes('localhost') ||
                     process.env.DATABASE_URL?.includes('postgres:5432'); // Docker

// Simpler pretty print configuration for better readability in development
const prettyPrint = isDevelopment ? {
  colorize: true,
  translateTime: 'HH:MM:ss.l',
  ignore: 'pid,hostname',
  messageFormat: '{component} | {event} | {msg}',
  errorLikeObjectKeys: ['err', 'error'],
  singleLine: true
} : false;

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact,
  ...(prettyPrint ? { transport: { target: 'pino-pretty', options: prettyPrint } } : {})
});

function child(component, bindings = {}) {
  return logger.child({ component, ...bindings });
}

function getReqLogger(req, component, bindings = {}) {
  const base = (req && req.log) ? req.log : logger;
  return base.child({ component, ...bindings });
}

module.exports = { logger, child, getReqLogger };



