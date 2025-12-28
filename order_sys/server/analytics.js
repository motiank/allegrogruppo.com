import express from 'express';

const router = express.Router();

/**
 * Analytics tracking endpoint
 * POST /api/track
 */
router.post('/track', (req, res) => {
  const { event, data } = req.body;
  const userId = data?.userId || 'unknown';
  console.log(`[Analytics] Event: ${event}, UserId: ${userId}`, data);
  // In production, you would save this to a database or analytics service
  res.json({ success: true });
});

export default router;

