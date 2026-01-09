const { Queue } = require('bullmq');

const connection = { url: process.env.REDIS_URL };

const genQueue = new Queue('generation', {
  connection,
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 }
  },
  limiter: { max: 20, duration: 1000 }
});

module.exports = { genQueue };


