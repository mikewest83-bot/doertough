import { createDealAlert, listDealAlerts, cancelDealAlert } from './deal-alerts.mjs';

export function registerOwnerDealAlertRoutes(app, { authRequired, isOwner }) {
  const requireOwner = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'sign_in_required', message: 'Sign in to continue.' });
    if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden', message: 'Owner access required.' });
    return next();
  };

  app.get('/api/owner/deal-alerts', authRequired, requireOwner, async (req, res) => {
    try {
      const alerts = await listDealAlerts(req.user.id);
      res.json({ alerts });
    } catch (error) {
      console.error('[owner-deal-alerts] list failed:', error.message || error);
      res.status(500).json({ error: 'deal_alerts_unavailable', message: 'Could not load Deal Alerts.' });
    }
  });

  app.post('/api/owner/deal-alerts', authRequired, requireOwner, async (req, res) => {
    try {
      const alert = await createDealAlert(req.user.id, req.body || {});
      res.status(201).json({ alert });
    } catch (error) {
      const code = error.message || 'deal_alert_create_failed';
      const status = new Set([
        'deal_alert_location_required',
        'deal_alert_frequency_invalid',
        'deal_alert_radius_invalid',
        'deal_alert_budget_invalid',
        'deal_alert_limit_reached',
      ]).has(code) ? 400 : 500;
      res.status(status).json({ error: code });
    }
  });

  app.delete('/api/owner/deal-alerts/:id', authRequired, requireOwner, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'deal_alert_id_invalid' });
      const canceled = await cancelDealAlert(req.user.id, id);
      if (!canceled) return res.status(404).json({ error: 'deal_alert_not_found' });
      res.json({ canceled: true, id });
    } catch (error) {
      console.error('[owner-deal-alerts] cancel failed:', error.message || error);
      res.status(500).json({ error: 'deal_alert_cancel_failed' });
    }
  });
}
