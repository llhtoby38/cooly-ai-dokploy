# Mock API System Guide

This guide explains how to use the mock API system to develop and test your application without making real API calls that incur costs.

## Overview

The mock API system allows you to simulate API responses without making actual external API calls. This is particularly useful for:

- **Development**: Test UI components without API costs
- **Testing**: Run tests without external dependencies
- **Demo**: Show functionality without real data
- **Cost Control**: Avoid expensive AI API calls during development

## Quick Start

### 1. Enable Mock Mode

Create a `.env.local` file in your project root:

```bash
# Enable mock API mode
NEXT_PUBLIC_MOCK_API=true

# Your regular API base (used when mock mode is disabled)
NEXT_PUBLIC_API_BASE=https://cooly-ai.onrender.com
```

### 2. Restart Your Development Server

```bash
npm run dev
```

### 3. Verify Mock Mode is Active

You should see a **"MOCK API"** indicator in the top-right corner of your application when mock mode is enabled.

## How It Works

### Architecture

```
Frontend Components
       ↓
   API Service Layer
       ↓
┌─────────────────┬─────────────────┐
│   Mock Mode     │   Live Mode     │
│   (No API calls)│   (Real API)    │
└─────────────────┴─────────────────┘
```

### Mock Responses

The system provides realistic mock responses for:

- **Authentication**: Login, user profile, credits
- **Image Generation**: Seedream4, Seedream, image history
- **Video Generation**: Veo3, Seedance, video history
- **Billing**: Stripe checkout, portal sessions
- **Admin**: Dashboard data, settings

### Realistic Behavior

- **Network Delays**: Simulates real API response times (1-3 seconds)
- **Random Failures**: 5% chance of simulated errors
- **Slow Responses**: 10% chance of slower responses
- **Realistic Data**: Generated mock data that matches your real API structure

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_MOCK_API` | Enable/disable mock mode | `false` |
| `NEXT_PUBLIC_API_BASE` | Real API base URL | Auto-detected |
| `NEXT_PUBLIC_DEBUG_LOGS` | Enable debug logging | `true` in development |

## Usage Examples

### Basic API Call

```javascript
import apiService from '../services/apiService';

// This automatically uses mock or real API based on environment
const response = await apiService.post('/api/images/seedream4/generate', {
  prompt: 'A beautiful landscape',
  model: 'seedream-4-0-250828'
});
```

### Check Mock Mode Status

```javascript
import { useMockMode } from '../hooks/useApiBase';

function MyComponent() {
  const isMockMode = useMockMode();
  
  return (
    <div>
      {isMockMode ? 'Using Mock API' : 'Using Live API'}
    </div>
  );
}
```

### Custom Mock Response

To add new mock endpoints, edit `frontend/src/app/services/mockApi.js`:

```javascript
const mockResponses = {
  '/api/my-new-endpoint': (body, params) => ({
    data: 'mock response',
    success: true,
  }),
};
```

## Industry Standards

This implementation follows industry best practices:

### 1. **Mock Service Worker (MSW) Alternative**
- MSW is the most popular choice for React apps
- Our approach is simpler and doesn't require service workers
- Better for server-side rendering (Next.js)

### 2. **Environment-Based Switching**
- Clean separation between environments
- No code changes needed to switch modes
- Easy to integrate with CI/CD pipelines

### 3. **Realistic Mock Data**
- Generated data matches real API structure
- Includes edge cases (errors, slow responses)
- Maintains data consistency

## Advanced Configuration

### Custom Mock Data

You can customize mock responses by modifying the generators in `mockApi.js`:

```javascript
const generateMockUser = () => ({
  id: 'custom-user-id',
  email: 'your-email@example.com',
  credits: 5000, // Custom credit amount
  // ... other fields
});
```

### Adding New Endpoints

1. Add the endpoint to `mockResponses` object
2. Create a mock handler function
3. Return realistic mock data
4. Test with your frontend components

### Debugging

Enable debug logs to see mock API usage:

```bash
NEXT_PUBLIC_DEBUG_LOGS=true
```

This will log all mock API calls to the console.

## Best Practices

### 1. **Development Workflow**
- Always use mock mode during development
- Switch to live mode only for final testing
- Use mock mode for demos and presentations

### 2. **Testing**
- Write tests that work with both mock and real APIs
- Use mock mode for unit tests
- Use real API for integration tests (sparingly)

### 3. **Cost Management**
- Set up alerts for API usage
- Use mock mode for all development work
- Only use live API for production deployments

## Troubleshooting

### Mock Mode Not Working

1. Check `.env.local` file exists and has `NEXT_PUBLIC_MOCK_API=true`
2. Restart your development server
3. Check browser console for mock API logs
4. Verify the mock mode indicator is showing

### Mock Data Issues

1. Check `mockApi.js` for the correct endpoint
2. Verify mock response structure matches real API
3. Use browser dev tools to inspect mock responses

### Performance Issues

1. Mock responses include artificial delays
2. Reduce `MOCK_DELAY` in `mockApi.js` for faster development
3. Disable slow response simulation if needed

## Migration Guide

### From Direct Fetch Calls

**Before:**
```javascript
const response = await fetch(`${API_BASE}/api/endpoint`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
```

**After:**
```javascript
const response = await apiService.post(`${API_BASE}/api/endpoint`, data);
```

### Gradual Migration

You can migrate endpoints gradually:

1. Import `apiService` in your component
2. Replace `fetch` calls with `apiService` methods
3. Test with both mock and live modes
4. Remove old fetch calls when satisfied

## Support

For issues or questions about the mock API system:

1. Check this documentation
2. Review the mock API service code
3. Check browser console for debug logs
4. Create an issue in your project repository

## Cost Savings

Using mock mode can save significant costs:

- **AI Generation APIs**: $0.01-$0.10 per request
- **Image Processing**: $0.001-$0.01 per image
- **Video Generation**: $0.10-$1.00 per video

During active development, you might make hundreds of requests per day, potentially saving $10-100+ per day in API costs.
