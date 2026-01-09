export function toErrorText(err) {
  try {
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (typeof err === 'number' || typeof err === 'boolean') return String(err);
    if (typeof err === 'object') {
      if (typeof err.message === 'string' && err.message) return err.message;
      if (typeof err.error === 'string' && err.error) return err.error;
      return JSON.stringify(err);
    }
    return String(err);
  } catch (_) {
    return 'Unknown error';
  }
}


