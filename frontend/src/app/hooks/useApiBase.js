import { getApiBase, isMockModeEnabled } from '../config/environment';

export function useApiBase() {
  return getApiBase();
}

// Export mock mode status for components that need it
export function useMockMode() {
  return isMockModeEnabled();
}


