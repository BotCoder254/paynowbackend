const express = require('express');
const router = express.Router();

/**
 * Health check endpoint for monitoring service status
 * @route GET /api/health
 * @returns {Object} 200 - Service status information
 */
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'PayNow API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

module.exports = router;
