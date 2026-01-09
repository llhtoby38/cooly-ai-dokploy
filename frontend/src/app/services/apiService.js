// API Service wrapper that automatically switches between real and mock APIs
// based on environment variables

import MockApiService from './mockApi';
import phFetch from './phFetch';

class ApiService {
  constructor() { this.isMockMode = false; }

  async request(url, options = {}) {
    const method = options.method || 'GET';
    
    // Always use real API on the frontend; backend handles mocking via env

    // Real API call
    try {
      const response = await phFetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      });

      return response;
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  // Convenience methods
  async get(url, options = {}) {
    return this.request(url, { ...options, method: 'GET' });
  }

  async post(url, data, options = {}) {
    return this.request(url, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async put(url, data, options = {}) {
    return this.request(url, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async delete(url, options = {}) {
    return this.request(url, { ...options, method: 'DELETE' });
  }

  // Check if currently in mock mode
  isMockMode() {
    return this.isMockMode;
  }
}

// Export singleton instance
export const apiService = new ApiService();
export default apiService;
