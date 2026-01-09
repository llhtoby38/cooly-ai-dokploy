# Load Testing Guide
**Contract Item A3.1: Performance & Load Testing**

## Overview

This directory contains k6 load testing scripts for the Cooly AI platform. These tests validate system performance under concurrent load and help identify bottlenecks.

## Prerequisites

1. Install k6:
   ```bash
   # macOS
   brew install k6

   # Linux
   sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
   echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt-get update
   sudo apt-get install k6

   # Windows
   choco install k6
   ```

2. Ensure the backend server is running:
   ```bash
   cd backend
   npm start
   ```

3. Create a test user (if not using Docker seed):
   - Email: test@example.com
   - Password: testpassword123
   - Credits: 1000+

## Running Tests

### Basic Test
```bash
k6 run loadtest/k6-generation-test.js
```

### Custom Configuration
```bash
# Test against local backend
API_BASE=http://localhost:5001 k6 run loadtest/k6-generation-test.js

# Test against preview environment
API_BASE=https://cooly-ai-api-pr-123.onrender.com k6 run loadtest/k6-generation-test.js

# Custom duration and load
k6 run --duration 60s --vus 20 loadtest/k6-generation-test.js
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE` | `http://localhost:5001` | API base URL |
| `TEST_EMAIL` | `test@example.com` | Test user email |
| `TEST_PASSWORD` | `testpassword123` | Test user password |

## Test Scenarios

### k6-generation-test.js

**Purpose**: Load test image generation endpoints with concurrent requests.

**Stages**:
1. Ramp up to 5 virtual users over 10s
2. Ramp up to 10 virtual users over 20s
3. Hold at 10 users for 30s
4. Ramp down to 0 over 10s

**Total Duration**: ~70 seconds

**Metrics**:
- Response time (p95, p99)
- Error rate
- Success rate
- Credit errors
- Provider errors

**Thresholds** (Pass/Fail Criteria):
- Error rate < 10%
- 95% of requests complete within 30s
- 80% success rate
- HTTP error rate < 10%

## Interpreting Results

### Sample Output
```
scenarios: (100.00%) 1 scenario, 10 max VUs, 1m40s max duration
          default: 10 looping VUs for 1m10s (gracefulStop: 30s)

     ✓ login successful
     ✓ status is 202
     ✓ has session_id

     checks.........................: 100.00% ✓ 120    ✗ 0
     data_received..................: 48 kB   686 B/s
     data_sent......................: 24 kB   343 B/s
     errors.........................: 0.00%   ✓ 0      ✗ 120
     generation_success.............: 100.00% ✓ 120    ✗ 0
     http_req_duration..............: avg=2.1s   p(95)=4.5s
     response_time..................: avg=2100ms p(95)=4500ms
```

### Key Metrics

1. **checks**: Should be 100% - validates response structure
2. **errors**: Should be < 10% - overall error rate
3. **generation_success**: Should be > 80% - successful generations
4. **http_req_duration p(95)**: Should be < 30s - 95th percentile response time
5. **credit_errors**: Count of insufficient credit errors
6. **provider_errors**: Count of 5xx errors from providers

### Understanding Failures

#### High Error Rate
- **Cause**: Backend unable to handle load
- **Action**: Check backend logs, increase worker concurrency

#### Slow Response Times
- **Cause**: Database bottleneck or slow provider APIs
- **Action**: Review database indexes, check provider API latency

#### Credit Errors
- **Cause**: Test user running out of credits
- **Action**: Top up test user credits via admin panel

## Advanced Testing

### Stress Test (Find Breaking Point)
```bash
k6 run --stages='1m:50,2m:100,1m:0' loadtest/k6-generation-test.js
```

### Spike Test (Sudden Load Increase)
```bash
k6 run --stages='10s:10,30s:100,10s:10' loadtest/k6-generation-test.js
```

### Soak Test (Sustained Load)
```bash
k6 run --stages='2m:20,30m:20,2m:0' loadtest/k6-generation-test.js
```

## CI/CD Integration

Add to GitHub Actions workflow:

```yaml
- name: Run Load Tests
  run: |
    k6 run --out json=results.json loadtest/k6-generation-test.js
    k6 cloud upload results.json  # Optional: k6 Cloud integration
```

## Monitoring During Tests

### Watch Backend Logs
```bash
docker-compose logs -f backend
```

### Monitor Database
```bash
docker exec -it cooly-postgres psql -U postgres -d cooly_db -c "
  SELECT state, count(*)
  FROM pg_stat_activity
  WHERE state IS NOT NULL
  GROUP BY state;"
```

### Monitor Queue
```bash
# BullMQ (Redis)
docker exec -it cooly-redis redis-cli
> LLEN bull:main:wait
> LLEN bull:main:active
```

## Troubleshooting

### Issue: "Login failed"
**Solution**: Verify test user exists and credentials are correct

### Issue: "Connection refused"
**Solution**: Ensure backend is running and accessible at `API_BASE`

### Issue: "All requests fail with 402"
**Solution**: Test user has insufficient credits - top up via admin panel

### Issue: "Timeouts"
**Solution**: Increase k6 timeout or check backend/provider performance

## Best Practices

1. **Start Small**: Begin with low load (5-10 VUs) before scaling up
2. **Monitor Resources**: Watch CPU, memory, and database during tests
3. **Use Mock Mode**: For infrastructure testing, enable MOCK_API=true
4. **Test Incrementally**: Add load gradually to find breaking points
5. **Validate Results**: Check database for consistency after tests

## Related Documentation

- [Performance Optimization](../CREDIT_OPTIMIZATION_ANALYSIS.md)
- [Database Indexes](../../database/migrations/20260101_add_performance_indexes.sql)
- [Queue Configuration](../src/queue/README.md)
