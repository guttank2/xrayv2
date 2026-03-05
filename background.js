// XRay Background Service Worker
// Handles badge updates, notifications, and LLM analysis webhook

// WEBHOOK_URL is loaded from config.js (git-ignored)
// Copy config.example.js → config.js and set your n8n webhook URL
importScripts('config.js');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'setBadge') {
    chrome.action.setBadgeText({ text: message.text || '' });
    chrome.action.setBadgeBackgroundColor({ color: message.color || '#1a1a1a' });
  }

  if (message.action === 'notify') {
    chrome.notifications.create('xray-' + Date.now(), {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: message.title || 'XRay',
      message: message.message || ''
    });
  }

  if (message.action === 'clearBadge') {
    chrome.action.setBadgeText({ text: '' });
  }

  if (message.action === 'analyzeWebhook') {
    const scanKey = message.scanKey;
    const payload = message.data;
    // Ensure mode is included in payload for n8n routing
    if (message.scanMode && !payload.mode) {
      payload.mode = message.scanMode;
    }

    // Store pending status immediately
    chrome.storage.local.set({
      ['analysis_' + scanKey]: { status: 'pending', timestamp: Date.now() }
    });

    // Keep service worker alive during long fetch (Chrome kills SW after ~30s idle)
    let keepAliveInterval = setInterval(() => {
      chrome.storage.local.get('_keepAlive').catch(() => {});
    }, 20000);

    // Abort after 3 minutes — n8n pipeline shouldn't take longer
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);

    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
      .then(r => {
        if (!r.ok) throw new Error('Webhook returned ' + r.status);
        return r.json();
      })
      .then(result => {
        if (result.status === 'complete' && result.llm_analysis) {
          chrome.storage.local.set({
            ['analysis_' + scanKey]: {
              status: 'complete',
              timestamp: Date.now(),
              ...result.llm_analysis
            }
          });
        } else {
          chrome.storage.local.set({
            ['analysis_' + scanKey]: {
              status: 'complete',
              timestamp: Date.now(),
              what_works: [],
              what_doesnt_work: [],
              why_it_works: [],
              templates: [],
              audience_profile: {},
              key_insight: result.message || ''
            }
          });
        }
        // Notify any open popup/dashboard
        chrome.runtime.sendMessage({ action: 'analysisComplete', scanKey }).catch(() => {});
      })
      .catch(err => {
        const errorMsg = err.name === 'AbortError'
          ? 'Pipeline timed out (3 min). Check n8n workflow.'
          : err.message;
        chrome.storage.local.set({
          ['analysis_' + scanKey]: { status: 'error', error: errorMsg, timestamp: Date.now() }
        });
        chrome.runtime.sendMessage({ action: 'analysisComplete', scanKey }).catch(() => {});
      })
      .finally(() => {
        clearTimeout(timeout);
        clearInterval(keepAliveInterval);
      });

    sendResponse({ ok: true });
    return true; // Keep message channel open for async
  }
});
