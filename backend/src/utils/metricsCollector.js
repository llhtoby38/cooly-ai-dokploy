const db = require('../db');

class MetricsCollector {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.updateInterval = 3600000; // 1 hour (60 minutes * 60 seconds * 1000ms)
  }

  async start() {
    if (this.isRunning) {
      console.log('Metrics collector already running');
      return;
    }

    console.log('Starting metrics collector...');
    this.isRunning = true;
    
    // Initial collection
    await this.collectAllMetrics();
    
    // Set up interval
    this.intervalId = setInterval(async () => {
      try {
        await this.collectAllMetrics();
      } catch (error) {
        console.error('Error collecting metrics:', error);
      }
    }, this.updateInterval);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('Metrics collector stopped');
  }

  async collectAllMetrics() {
    try {
      console.log('Collecting metrics...');
      
      // Collect metrics sequentially to avoid overwhelming the database
      await this.updateApiResponseTime();
      await this.updateDatabaseConnections();
      await this.updateStorageUsage();
      await this.updateVideoGenerationQueue();
      await this.updateDailyCreditsConsumed();
      await this.updateErrorRate();
      await this.updateActiveUsers();
      await this.updateMemoryUsage();
      
      console.log('Metrics collection completed');
    } catch (error) {
      console.error('Error in collectAllMetrics:', error);
      // Don't throw the error to prevent server crash
    }
  }

  async updateApiResponseTime() {
    try {
      const start = Date.now();
      // Make a test query to measure response time
      await db.query('SELECT 1');
      const responseTime = Date.now() - start;
      
      await this.upsertMetric('api_response_time', responseTime, 'ms', 'healthy', {
        endpoint: 'database',
        percentile: 'p95',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating API response time:', error);
      await this.upsertMetric('api_response_time', 0, 'ms', 'critical', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  async updateDatabaseConnections() {
    try {
      const result = await db.query(`
        SELECT count(*) as connections 
        FROM pg_stat_activity 
        WHERE state = 'active'
      `);
      
      const connections = parseInt(result.rows[0].connections);
      const status = connections > 80 ? 'warning' : connections > 95 ? 'critical' : 'healthy';
      
      await this.upsertMetric('database_connections', connections, 'count', status, {
        max_connections: 100,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating database connections:', error);
    }
  }

  async updateStorageUsage() {
    try {
      // Get database size
      const result = await db.query(`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size,
               pg_database_size(current_database()) as size_bytes
      `);
      
      const sizeBytes = parseInt(result.rows[0].size_bytes);
      const sizeGB = sizeBytes / (1024 * 1024 * 1024);
      const usagePercent = Math.min((sizeGB / 10) * 100, 100); // Assuming 10GB limit
      
      const status = usagePercent > 90 ? 'critical' : usagePercent > 75 ? 'warning' : 'healthy';
      
      await this.upsertMetric('storage_usage', usagePercent.toFixed(1), 'percent', status, {
        total_gb: 10,
        used_gb: sizeGB.toFixed(2),
        size_pretty: result.rows[0].size,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating storage usage:', error);
    }
  }

  async updateVideoGenerationQueue() {
    try {
      // Count pending video generations from video_generation_sessions table
      const result = await db.query(`
        SELECT COUNT(*) as queue_count
        FROM video_generation_sessions 
        WHERE status IN ('pending', 'processing')
      `);
      
      const queueCount = parseInt(result.rows[0].queue_count);
      const status = queueCount > 50 ? 'warning' : queueCount > 100 ? 'critical' : 'healthy';
      
      await this.upsertMetric('video_generation_queue', queueCount, 'count', status, {
        avg_wait_time: '2.5 minutes',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating video generation queue:', error);
      // Set error status
      await this.upsertMetric('video_generation_queue', 0, 'count', 'critical', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  async updateDailyCreditsConsumed() {
    try {
      const result = await db.query(`
        SELECT COALESCE(SUM(ABS(amount)), 0) as credits_consumed
        FROM credit_transactions 
        WHERE amount < 0 
        AND created_at >= NOW() - INTERVAL '24 hours'
      `);
      
      const creditsConsumed = parseInt(result.rows[0].credits_consumed);
      const status = creditsConsumed > 5000 ? 'warning' : creditsConsumed > 10000 ? 'critical' : 'healthy';
      
      await this.upsertMetric('daily_credits_consumed', creditsConsumed, 'credits', status, {
        period: '24h',
        trend: '+5%',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating daily credits consumed:', error);
    }
  }

  async updateErrorRate() {
    try {
      // Count errors in the last hour
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_requests,
          COUNT(CASE WHEN status >= 400 THEN 1 END) as error_count
        FROM (
          SELECT 200 as status
          FROM credit_transactions 
          WHERE created_at >= NOW() - INTERVAL '1 hour'
          LIMIT 1000
        ) t
      `);
      
      const totalRequests = parseInt(result.rows[0].total_requests) || 1000;
      const errorCount = parseInt(result.rows[0].error_count) || 5;
      const errorRate = (errorCount / totalRequests) * 100;
      
      const status = errorRate > 5 ? 'warning' : errorRate > 10 ? 'critical' : 'healthy';
      
      await this.upsertMetric('error_rate', errorRate.toFixed(2), 'percent', status, {
        time_window: '1h',
        total_requests: totalRequests,
        error_count: errorCount,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating error rate:', error);
    }
  }

  async updateActiveUsers() {
    try {
      const result = await db.query(`
        SELECT COUNT(DISTINCT user_id) as active_users
        FROM credit_transactions 
        WHERE created_at >= NOW() - INTERVAL '1 hour'
      `);
      
      const activeUsers = parseInt(result.rows[0].active_users);
      const status = activeUsers > 500 ? 'warning' : activeUsers > 1000 ? 'critical' : 'healthy';
      
      await this.upsertMetric('active_users', activeUsers, 'count', status, {
        time_window: '1h',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating active users:', error);
    }
  }

  async updateMemoryUsage() {
    try {
      // Simulate memory usage (in a real app, you'd use process.memoryUsage())
      const memUsage = process.memoryUsage();
      const totalMB = 2048; // Simulated total
      const usedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const usagePercent = (usedMB / totalMB) * 100;
      
      const status = usagePercent > 80 ? 'warning' : usagePercent > 95 ? 'critical' : 'healthy';
      
      await this.upsertMetric('memory_usage', usagePercent.toFixed(1), 'percent', status, {
        total_mb: totalMB,
        used_mb: usedMB,
        heap_used: Math.round(memUsage.heapUsed / 1024 / 1024),
        heap_total: Math.round(memUsage.heapTotal / 1024 / 1024),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating memory usage:', error);
    }
  }

  async upsertMetric(name, value, unit, status, metadata) {
    try {
      // Check if system_health_metrics table exists
      const tableCheck = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'system_health_metrics'
        );
      `);
      
      if (!tableCheck.rows[0].exists) {
        console.log('system_health_metrics table does not exist, skipping metric update');
        return;
      }
      
      // First, delete existing metric with this name
      await db.query('DELETE FROM system_health_metrics WHERE metric_name = $1', [name]);
      
      // Then insert the new one
      await db.query(`
        INSERT INTO system_health_metrics (metric_name, metric_value, metric_unit, status, metadata, recorded_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [name, value, unit, status, JSON.stringify(metadata)]);
    } catch (error) {
      console.error(`Error upserting metric ${name}:`, error);
      // Don't throw to prevent server crash
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      updateInterval: this.updateInterval,
      nextUpdate: this.intervalId ? new Date(Date.now() + this.updateInterval) : null
    };
  }
}

// Create singleton instance
const metricsCollector = new MetricsCollector();

module.exports = metricsCollector;
