class JobProcessingError extends Error {
  constructor(code, options = {}) {
    const message = options.message || code || 'JobProcessingError';
    super(message);
    this.name = 'JobProcessingError';
    this.code = code || null;
    this.permanent = Boolean(options.permanent);
    this.metadata = options.metadata || null;
  }
}

module.exports = { JobProcessingError };



