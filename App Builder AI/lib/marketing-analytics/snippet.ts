/**
 * lib/marketing-analytics/snippet.ts
 *
 * A lightweight first-party analytics snippet for injected apps.
 * It tracks visits and conversion events (signup, purchase) and associates
 * them with the UTM parameters from the marketing campaign.
 */

export const ANALYTICS_SNIPPET = (projectId: string, appUrl: string) => `
(function() {
  const PROJECT_ID = ${JSON.stringify(projectId)};
  const API_URL = ${JSON.stringify(appUrl + '/api/marketing/events')};

  function getUtmParams() {
    const params = new URLSearchParams(window.location.search);
    const utm = {};
    ['source', 'medium', 'campaign', 'content', 'term'].forEach(key => {
      const val = params.get('utm_' + key);
      if (val) utm[key] = val;
    });
    return utm;
  }

  async function track(eventType, metadata = {}) {
    try {
      const utm = getUtmParams();
      const body = {
        projectId: PROJECT_ID,
        eventType,
        ...utm,
        ...metadata,
        url: window.location.href,
        referrer: document.referrer,
        timestamp: new Date().toISOString()
      };
      
      // Use sendBeacon for reliability on page hide, fetch otherwise
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API_URL, JSON.stringify(body));
      } else {
        await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true
        });
      }
    } catch (e) {
      // Silent fail
    }
  }

  // Auto-track visit
  if (!window.__aw_tracked) {
    window.__aw_tracked = true;
    track('visit');
  }

  // Expose global for manual conversion tracking (signup, purchase)
  window.awTrack = track;
})();
`.trim();
