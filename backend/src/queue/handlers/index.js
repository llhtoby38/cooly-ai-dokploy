const fs = require('fs');
const path = require('path');
const { child: makeLogger } = require('../../utils/logger');

const log = (() => {
  try { return makeLogger('queue.handlers'); } catch (_) { return { info(){}, warn(){}, error(){} }; }
})();

const handlers = Object.create(null);

function registerHandler(jobName, handlerFn, source) {
  if (!jobName || typeof handlerFn !== 'function') return;
  const key = String(jobName).toLowerCase();
  handlers[key] = handlerFn;
  try { log.info({ event: 'handler.registered', jobName: key, source }); } catch (_) {}
}

function getHandler(name) {
  if (!name) return null;
  const key = String(name).toLowerCase();
  const handler = handlers[key];
  return typeof handler === 'function' ? handler : null;
}

function loadHandlersFromJobsDir() {
  const jobsDir = path.resolve(__dirname, '../jobs');
  let files = [];
  try {
    files = fs.readdirSync(jobsDir);
  } catch (err) {
    try { log.warn({ event: 'handlers.jobs_dir_missing', msg: err?.message || err }); } catch (_) {}
    return;
  }

  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const fullPath = path.join(jobsDir, file);
    try {
      const mod = require(fullPath);
      const jobNames = Array.isArray(mod?.jobNames) ? mod.jobNames : (mod?.jobName ? [mod.jobName] : []);
      const handlerFn = typeof mod?.handler === 'function'
        ? mod.handler
        : (typeof mod?.default === 'function' ? mod.default : undefined);

      const legacyExportNames = Object.keys(mod || {}).filter((key) => key.startsWith('process') && typeof mod[key] === 'function');
      const legacyHandler = handlerFn || (legacyExportNames.length ? mod[legacyExportNames[0]] : undefined);

      if (!legacyHandler) {
        try { log.warn({ event: 'handler.missing_export', file }); } catch (_) {}
        continue;
      }

      if (!jobNames.length) {
        try { log.warn({ event: 'handler.missing_job_names', file }); } catch (_) {}
        continue;
      }

      for (const jobName of jobNames) {
        registerHandler(jobName, legacyHandler, path.relative(path.resolve(__dirname, '..'), fullPath));
      }
    } catch (err) {
      try { log.error({ event: 'handler.load_failed', file, msg: err?.message || err }); } catch (_) {}
    }
  }
}

loadHandlersFromJobsDir();

module.exports = { handlers, getHandler, registerHandler };
