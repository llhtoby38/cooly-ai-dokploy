// Mock API service for development/testing without real API costs
// This simulates API responses without making actual external API calls

const MOCK_DELAY = 1000; // Simulate network delay

// Mock data generators
const generateMockImage = (index = 0) => ({
  id: `mock-image-${Date.now()}-${index}`,
  url: `https://picsum.photos/1024/1024?random=${Date.now()}-${index}`,
  b2_url: `https://f005.backblazeb2.com/file/cooly-ai-content/mock-${Date.now()}-${index}.png`,
  created_at: new Date().toISOString(),
});

const generateMockSession = (type = 'image', status = 'completed') => ({
  session_id: `mock-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  prompt: 'A beautiful landscape with mountains and lakes, cinematic lighting',
  model: type === 'image' ? 'seedream-4-0-250828' : 'veo-3',
  status,
  created_at: new Date().toISOString(),
  completed_at: status === 'completed' ? new Date().toISOString() : null,
  credit_cost: type === 'image' ? 30 : 150,
  expectedOutputs: 1,
  aspect_ratio: '16:9',
  resolution: '1024x576',
  images: status === 'completed' ? [generateMockImage().b2_url] : [],
  progress: status === 'processing' ? [{ step: 'generating', progress: 75 }] : [],
});

const generateMockUser = () => ({
  id: 'mock-user-123',
  email: 'developer@cooly.ai',
  credits: 1000,
  subscription_status: 'active',
  created_at: '2024-01-01T00:00:00Z',
});

const generateMockEstimate = (type = 'image') => ({
  averageMs: type === 'image' ? 15000 : 60000, // 15s for images, 60s for videos
  model: type === 'image' ? 'seedream-4-0-250828' : 'veo-3',
});

// Mock API responses
const mockResponses = {
  // Auth endpoints
  '/api/auth/me': () => ({
    user: generateMockUser(),
    success: true,
  }),

  '/api/auth/login': (body) => {
    if (body?.email && body?.password) {
      return {
        user: generateMockUser(),
        token: 'mock-jwt-token',
        success: true,
      };
    }
    return { error: 'Invalid credentials', success: false };
  },

  // User endpoints
  '/api/user/credits': () => ({
    credits: 850,
    reserved: 0,
    success: true,
  }),

  '/api/user/profile': () => ({
    user: generateMockUser(),
    success: true,
  }),

  // Image generation endpoints
  '/api/image/generate': (body) => {
    const session = generateMockSession('image', 'processing');
    return {
      session_id: session.session_id,
      status: 'processing',
      estimated_completion: new Date(Date.now() + 15000).toISOString(),
      success: true,
    };
  },

  '/api/images/seedream4/generate': (body) => {
    const session = generateMockSession('image', 'processing');
    return {
      session_id: session.session_id,
      status: 'processing',
      estimated_completion: new Date(Date.now() + 15000).toISOString(),
      success: true,
    };
  },

  '/api/images/seedream4/history': (params) => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      ...generateMockSession('image', 'completed'),
      session_id: `mock-session-${i}-${Date.now()}`,
      created_at: new Date(Date.now() - i * 3600000).toISOString(), // 1 hour apart
    })).map(session => ({
      ...session,
      images: [generateMockImage().b2_url],
      b2_url: generateMockImage().b2_url,
    }));

    return {
      items,
      pagination: {
        page: 1,
        pages: 1,
        total: items.length,
        hasMore: false,
      },
      success: true,
    };
  },

  '/api/images/seedream4/progress': (params) => {
    const sessionId = params.session_id || 'mock-session';
    return {
      session_id: sessionId,
      status: Math.random() > 0.3 ? 'completed' : 'processing',
      progress: Math.random() > 0.3 ? [] : [{ step: 'generating', progress: Math.floor(Math.random() * 100) }],
      images: Math.random() > 0.3 ? [generateMockImage().b2_url] : [],
      success: true,
    };
  },

  '/api/images/seedream4/estimate': () => ({
    averageMs: 15000,
    success: true,
  }),

  // Video generation endpoints
  '/api/video/generate': (body) => {
    const session = generateMockSession('video', 'processing');
    return {
      session_id: session.session_id,
      status: 'processing',
      estimated_completion: new Date(Date.now() + 60000).toISOString(),
      success: true,
    };
  },

  '/api/videos/veo3/generate': (body) => {
    const session = generateMockSession('video', 'processing');
    return {
      session_id: session.session_id,
      status: 'processing',
      estimated_completion: new Date(Date.now() + 60000).toISOString(),
      success: true,
    };
  },

  '/api/videos/veo3/history': (params) => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      ...generateMockSession('video', 'completed'),
      session_id: `mock-video-${i}-${Date.now()}`,
      created_at: new Date(Date.now() - i * 7200000).toISOString(), // 2 hours apart
      video_url: `https://f005.backblazeb2.com/file/cooly-ai-content/mock-video-${i}.mp4`,
    }));

    return {
      items,
      pagination: {
        page: 1,
        pages: 1,
        total: items.length,
        hasMore: false,
      },
      success: true,
    };
  },

  // Billing endpoints
  '/api/billing/create-checkout': (body) => ({
    checkout_url: 'https://checkout.stripe.com/mock-checkout-session',
    success: true,
  }),

  '/api/billing/portal': () => ({
    portal_url: 'https://billing.stripe.com/mock-portal-session',
    success: true,
  }),

  // Admin endpoints
  '/api/admin/dashboard': () => ({
    totalUsers: 1250,
    totalCredits: 50000,
    totalRevenue: 12500.50,
    recentActivity: [],
    success: true,
  }),
};

// Mock API service
export class MockApiService {
  static async request(url, options = {}) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, MOCK_DELAY));

    // Extract path from URL
    const urlObj = new URL(url, 'http://localhost');
    const path = urlObj.pathname;
    const searchParams = urlObj.searchParams;

    // Find matching mock response
    const mockHandler = mockResponses[path];
    
    if (!mockHandler) {
      console.warn(`No mock handler for ${path}`);
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Mock endpoint not found', path }),
      };
    }

    // Parse request body if present
    let requestBody = null;
    if (options.body) {
      try {
        requestBody = JSON.parse(options.body);
      } catch (e) {
        requestBody = options.body;
      }
    }

    // Convert search params to object
    const params = Object.fromEntries(searchParams.entries());

    // Generate mock response
    const mockData = mockHandler(requestBody, params);

    // Simulate different response scenarios
    const shouldFail = Math.random() < 0.05; // 5% chance of failure
    const isSlow = Math.random() < 0.1; // 10% chance of slow response

    if (shouldFail) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'Mock server error', success: false }),
      };
    }

    // Additional delay for slow responses
    if (isSlow) {
      await new Promise(resolve => setTimeout(resolve, MOCK_DELAY * 3));
    }

    return {
      ok: true,
      status: 200,
      json: async () => mockData,
    };
  }

  // Helper method to check if mocking is enabled
  static isEnabled() {
    return String(process.env.NEXT_PUBLIC_MOCK_API || '').toLowerCase() === 'true';
  }

  // Helper method to log mock usage
  static logUsage(method, url, options) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`🎭 [MOCK API] ${method} ${url}`, options?.body ? JSON.parse(options.body) : '');
    }
  }
}

export default MockApiService;
