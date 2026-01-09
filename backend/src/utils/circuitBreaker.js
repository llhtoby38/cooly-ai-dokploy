// Simple process-local circuit breaker for DB connect instability
// Env tuning:
//   CB_DB_FAIL_THRESHOLD (default 5) failures within CB_DB_FAIL_WINDOW_MS (default 30000)
//   opens the breaker for CB_DB_OPEN_MS (default 10000)

let failureTimestamps = [];
let openUntilTs = 0;

function now() { return Date.now(); }

function prune(windowMs) {
  const cutoff = now() - windowMs;
  failureTimestamps = failureTimestamps.filter(t => t >= cutoff);
}

function recordDbFailure() {
  const windowMs = Math.max(1000, Number(process.env.CB_DB_FAIL_WINDOW_MS || 30000));
  const threshold = Math.max(1, Number(process.env.CB_DB_FAIL_THRESHOLD || 5));
  const openMs = Math.max(1000, Number(process.env.CB_DB_OPEN_MS || 10000));
  failureTimestamps.push(now());
  prune(windowMs);
  if (failureTimestamps.length >= threshold) {
    openUntilTs = Math.max(openUntilTs, now() + openMs);
  }
}

function recordDbSuccess() {
  // On success, gradually recover: clear history and close breaker
  failureTimestamps = [];
  openUntilTs = 0;
}

function isOpen() {
  return now() < openUntilTs;
}

module.exports = {
  isOpen,
  recordDbFailure,
  recordDbSuccess
};


