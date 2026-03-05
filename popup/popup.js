const scrapeBtn = document.getElementById('scrapeBtn');
const exportBtn = document.getElementById('exportBtn');
const statsCard = document.getElementById('statsCard');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const statusDot = document.querySelector('.status-dot');
const statusTextEl = document.querySelector('.status-text');
const statusHint = document.querySelector('.status-hint');
const postsCount = document.getElementById('postsCount');
const totalLikes = document.getElementById('totalLikes');
const totalViews = document.getElementById('totalViews');
const accountInfo = document.getElementById('accountInfo');
const accountName = document.getElementById('accountName');
const accountType = document.getElementById('accountType');
const webhookStatus = document.getElementById('webhookStatus');
const webhookDot = document.getElementById('webhookDot');
const webhookText = document.getElementById('webhookText');
const lastScan = document.getElementById('lastScan');
const lastScanText = document.getElementById('lastScanText');
const dashboardBtn = document.getElementById('dashboardBtn');

let scrapedData = [];
let settings = { maxPosts: 50, mediaFilter: 'all', webhookEnabled: true };
let scanMode = 'profile'; // 'profile' or 'trend'

// ===== SETTINGS =====
async function loadSettings() {
  const result = await chrome.storage.local.get('xraySettings');
  if (result.xraySettings) settings = result.xraySettings;
  // Update UI
  document.querySelectorAll('#postsGroup .seg-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.value) === settings.maxPosts);
  });
  document.querySelectorAll('#mediaGroup .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === settings.mediaFilter);
  });
  document.querySelectorAll('#webhookGroup .seg-btn').forEach(btn => {
    btn.classList.toggle('active', (btn.dataset.value === 'on') === settings.webhookEnabled);
  });
}

async function saveSettings() {
  await chrome.storage.local.set({ xraySettings: settings });
}

document.getElementById('postsGroup').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.maxPosts = parseInt(btn.dataset.value);
  document.querySelectorAll('#postsGroup .seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  saveSettings();
});

document.getElementById('mediaGroup').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.mediaFilter = btn.dataset.value;
  document.querySelectorAll('#mediaGroup .seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  saveSettings();
});

document.getElementById('webhookGroup').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.webhookEnabled = btn.dataset.value === 'on';
  document.querySelectorAll('#webhookGroup .seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  saveSettings();
});

// ===== PAGE DETECTION =====
const PROFILE_PAGES = /^\/((?!home|explore|search|notifications|messages|i\/|settings|compose)[a-zA-Z0-9_]+)\/?$/;
const NON_PROFILE = ['home', 'explore', 'search', 'notifications', 'messages', 'settings', 'compose', 'i'];

function detectPage(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    // /i/ paths: trending, global-trending, connect, etc.
    if (path.startsWith('/i/')) {
      if (path.includes('trending') || path.includes('global-trending')) {
        return { type: 'trending', account: null };
      }
      return { type: 'i', account: null };
    }
    // Profile page: /username or /username/with_replies etc
    const match = u.pathname.match(/^\/([a-zA-Z0-9_]+)(\/.*)?$/);
    if (!match) return { type: 'other', account: null };
    const name = match[1].toLowerCase();
    if (NON_PROFILE.includes(name)) return { type: name, account: null };
    return { type: 'profile', account: match[1] };
  } catch {
    return { type: 'other', account: null };
  }
}

async function checkPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isTwitter = tab.url.includes('twitter.com') || tab.url.includes('x.com');

  if (!isTwitter) {
    statusDot.classList.add('error');
    statusTextEl.textContent = 'Not on Twitter/X';
    statusHint.textContent = 'Navigate to a profile to scan';
    scrapeBtn.disabled = true;
    return { ok: false, tab };
  }

  const page = detectPage(tab.url);

  if (page.type === 'profile' && page.account) {
    scanMode = 'profile';
    accountInfo.style.display = 'flex';
    accountName.textContent = '@' + page.account;
    accountType.textContent = 'Profile';
    accountType.className = 'account-type';
    statusHint.textContent = 'Ready to scan this profile';
    scrapeBtn.innerHTML = '<span class="btn-icon">⊙</span> Scan Posts';
    scrapeBtn.classList.remove('trend-mode');
    return { ok: true, tab, account: page.account };
  }

  if (page.type === 'home') {
    scanMode = 'trend';
    accountInfo.style.display = 'flex';
    accountName.textContent = 'Home Feed';
    accountType.textContent = 'Trends';
    accountType.className = 'account-type trend';
    statusHint.textContent = 'Trend Scanner — find what\'s working right now';
    scrapeBtn.innerHTML = '<span class="btn-icon">◎</span> Scan Trends';
    scrapeBtn.classList.add('trend-mode');
    return { ok: true, tab, account: 'home_feed' };
  }

  if (page.type === 'search' || page.type === 'explore' || page.type === 'trending') {
    const label = page.type === 'trending' ? 'Global Trending' : page.type.charAt(0).toUpperCase() + page.type.slice(1);
    scanMode = 'trend';
    accountInfo.style.display = 'flex';
    accountName.textContent = label;
    accountType.textContent = 'Trends';
    accountType.className = 'account-type trend';
    statusHint.textContent = 'Trend Scanner — find what\'s working in ' + label.toLowerCase();
    scrapeBtn.innerHTML = '<span class="btn-icon">◎</span> Scan Trends';
    scrapeBtn.classList.add('trend-mode');
    return { ok: true, tab, account: label.toLowerCase().replace(/\s+/g, '_') };
  }

  statusHint.textContent = 'Navigate to a profile for best results';
  return { ok: true, tab, account: 'unknown' };
}

// ===== UI HELPERS =====
function setScanning(isScanning) {
  if (isScanning) {
    scrapeBtn.disabled = true;
    scrapeBtn.innerHTML = '<span class="btn-icon">◌</span> Scanning...';
    statusDot.classList.add('scanning');
    statusTextEl.textContent = scanMode === 'trend' ? 'Scanning feed...' : 'Scanning posts...';
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
  } else {
    scrapeBtn.disabled = false;
    if (scanMode === 'trend') {
      scrapeBtn.innerHTML = '<span class="btn-icon">◎</span> Scan Trends';
    } else {
      scrapeBtn.innerHTML = '<span class="btn-icon">⊙</span> Scan Posts';
    }
    statusDot.classList.remove('scanning');
  }
}

function updateProgress(current, total) {
  const percent = Math.round((current / total) * 100);
  progressFill.style.width = percent + '%';
  progressText.textContent = 'Scanned ' + current + ' of ' + total + ' posts';
}

function updateStats(data) {
  postsCount.textContent = data.length;
  if (scanMode === 'trend') {
    // Show top engagement instead of totals
    const sorted = [...data].sort((a, b) => {
      const engA = (a.likes || 0) + (a.retweets || 0) + (a.replies || 0);
      const engB = (b.likes || 0) + (b.retweets || 0) + (b.replies || 0);
      return engB - engA;
    });
    const topEng = sorted[0] ? (sorted[0].likes || 0) + (sorted[0].retweets || 0) + (sorted[0].replies || 0) : 0;
    const totalEng = data.reduce((sum, p) => sum + (p.likes || 0) + (p.retweets || 0) + (p.replies || 0), 0);
    totalLikes.textContent = formatNumber(topEng);
    totalViews.textContent = formatNumber(totalEng);
    document.querySelector('#statsCard .stat-item:nth-child(2) .stat-label').textContent = 'Top Post';
    document.querySelector('#statsCard .stat-item:nth-child(3) .stat-label').textContent = 'Total Eng';
  } else {
    const likes = data.reduce((sum, post) => sum + (post.likes || 0), 0);
    const views = data.reduce((sum, post) => sum + (post.views || 0), 0);
    totalLikes.textContent = formatNumber(likes);
    totalViews.textContent = formatNumber(views);
    document.querySelector('#statsCard .stat-item:nth-child(2) .stat-label').textContent = 'Likes';
    document.querySelector('#statsCard .stat-item:nth-child(3) .stat-label').textContent = 'Views';
  }
  statsCard.style.display = 'block';
  statsCard.classList.add('fade-in');
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function setWebhookStatus(state, text) {
  webhookStatus.style.display = 'flex';
  webhookDot.className = 'webhook-dot ' + state;
  webhookText.textContent = text;
}

// ===== PERSISTENCE =====
async function saveLastScan(account, count) {
  const data = {
    account,
    count,
    timestamp: Date.now()
  };
  await chrome.storage.local.set({ lastScan: data });
}

async function loadLastScan() {
  const result = await chrome.storage.local.get('lastScan');
  if (result.lastScan) {
    const s = result.lastScan;
    const ago = getTimeAgo(s.timestamp);
    lastScan.style.display = 'block';
    lastScanText.textContent = 'Last scan: @' + s.account + ' (' + s.count + ' posts) ' + ago;
  }
}

function getTimeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}

// ===== CSV EXPORT =====
function exportCSV(data) {
  const headers = ['timestamp', 'text', 'likes', 'retweets', 'replies', 'views', 'bookmarks', 'media_type', 'url'];
  const rows = data.map(row => {
    return headers.map(h => {
      let val = row[h] || '';
      if (typeof val === 'string') {
        val = val.replace(/"/g, '""');
        if (val.includes(',') || val.includes('\n')) {
          val = '"' + val + '"';
        }
      }
      return val;
    }).join(',');
  });
  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'xray-export-' + Date.now() + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ===== WEBHOOK (via background worker) =====
function sendToWebhook(data, tab, scanKey) {
  setWebhookStatus('sending', 'Sent to pipeline — analyzing...');
  // Extract account from scanKey (format: trend_account_timestamp or scan_account_timestamp)
  const keyParts = scanKey.split('_');
  const account = keyParts.length >= 3 ? keyParts.slice(1, -1).join('_') : 'unknown';
  const accountUrl = scanMode === 'profile' ? 'https://x.com/' + account : tab?.url || '';
  chrome.runtime.sendMessage({
    action: 'analyzeWebhook',
    scanKey: scanKey,
    scanMode: scanMode,
    data: {
      mode: scanMode,
      account: account,
      account_url: accountUrl,
      posts: data,
      scraped_at: new Date().toISOString()
    }
  }, (response) => {
    if (response && response.ok) {
      setWebhookStatus('sent', 'Pipeline analyzing — check ' + (scanMode === 'trend' ? 'Trends' : 'Analysis') + ' tab in ~2 min');
    } else {
      setWebhookStatus('error', 'Failed to reach pipeline');
    }
  });
}

// Listen for analysis completion from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'analysisComplete') {
    setWebhookStatus('sent', 'Analysis complete — open Dashboard');
  }
});

function onScrapeComplete(data, tab, scanKey) {
  if (data.length > 0 && settings.webhookEnabled) {
    sendToWebhook(data, tab, scanKey);
  }
}

// ===== DASHBOARD STORAGE =====
async function storeScanData(rawData, account, scanKey) {
  if (!rawData || rawData.length === 0) return null;
  const { posts, summary } = XRayMetrics.processScan(rawData);
  const key = scanKey;

  await chrome.storage.local.set({
    [key]: { account, timestamp: Date.now(), posts, summary }
  });

  // Update history index
  const result = await chrome.storage.local.get('scanHistory');
  const history = result.scanHistory || [];
  history.unshift({
    key,
    account,
    timestamp: Date.now(),
    postCount: summary.totalPosts,
    avgScore: summary.avgScore
  });

  // Cap at 20
  if (history.length > 20) {
    const removed = history.splice(20);
    const keysToRemove = removed.map(h => h.key);
    removed.forEach(h => keysToRemove.push('analysis_' + h.key));
    await chrome.storage.local.remove(keysToRemove);
  }

  await chrome.storage.local.set({ scanHistory: history });
  return key;
}

// ===== TREND DATA STORAGE =====
async function storeTrendData(rawData, account, scanKey) {
  if (!rawData || rawData.length === 0) return null;
  const trendResult = XRayTrends.processTrends(rawData);
  const key = scanKey;

  await chrome.storage.local.set({
    [key]: {
      account,
      timestamp: Date.now(),
      mode: 'trend',
      posts: trendResult.sorted,
      topPosts: trendResult.topPosts,
      keywords: trendResult.keywords,
      clusters: trendResult.clusters,
      trendingHooks: trendResult.trendingHooks,
      mediaBreakdown: trendResult.mediaBreakdown,
      topAuthors: trendResult.topAuthors,
      totalScanned: trendResult.totalScanned,
      maxEngagement: trendResult.maxEngagement,
      maxVelocity: trendResult.maxVelocity
    }
  });

  // Update history index
  const result = await chrome.storage.local.get('scanHistory');
  const history = result.scanHistory || [];
  history.unshift({
    key,
    account,
    timestamp: Date.now(),
    postCount: trendResult.totalScanned,
    avgScore: 0,
    mode: 'trend',
    maxEngagement: trendResult.maxEngagement
  });

  // Cap at 20
  if (history.length > 20) {
    const removed = history.splice(20);
    const keysToRemove = removed.map(h => h.key);
    removed.forEach(h => keysToRemove.push('analysis_' + h.key));
    await chrome.storage.local.remove(keysToRemove);
  }

  await chrome.storage.local.set({ scanHistory: history });
  return key;
}

// ===== BADGE =====
function setBadge(count) {
  try {
    chrome.runtime.sendMessage({
      action: 'setBadge',
      text: count > 0 ? String(count) : '',
      color: '#1a1a1a'
    });
  } catch {}
}

function sendNotification(account, count) {
  try {
    chrome.runtime.sendMessage({
      action: 'notify',
      title: 'XRay Scan Complete',
      message: 'Found ' + count + ' posts from @' + account
    });
  } catch {}
}

// ===== MAIN SCAN =====
scrapeBtn.addEventListener('click', async () => {
  const { ok, tab, account } = await checkPage();
  if (!ok) return;

  setScanning(true);
  webhookStatus.style.display = 'none';

  chrome.tabs.sendMessage(tab.id, { action: 'scrape', maxPosts: settings.maxPosts, mediaFilter: settings.mediaFilter }, (response) => {
    setScanning(false);

    if (chrome.runtime.lastError) {
      statusDot.classList.add('error');
      statusTextEl.textContent = 'Error scanning';
      statusHint.textContent = 'Refresh the page and try again';
      return;
    }

    if (response && response.data) {
      scrapedData = response.data;
      updateStats(scrapedData);
      exportBtn.disabled = false;
      statusTextEl.textContent = 'Scan complete';
      statusHint.textContent = 'Found ' + scrapedData.length + ' posts';
      progressContainer.style.display = 'none';

      // Badge + notification
      setBadge(scrapedData.length);
      sendNotification(account || 'unknown', scrapedData.length);

      // Persist
      saveLastScan(account || 'unknown', scrapedData.length);

      // Generate scanKey once — used by both storage and webhook
      const prefix = scanMode === 'trend' ? 'trend_' : 'scan_';
      const scanKey = prefix + (account || 'unknown') + '_' + Date.now();

      // Store to dashboard
      if (scanMode === 'trend') {
        storeTrendData(scrapedData, account, scanKey);
      } else {
        storeScanData(scrapedData, account, scanKey);
      }

      // Webhook (via background worker)
      onScrapeComplete(scrapedData, tab, scanKey);
    }
  });
});

exportBtn.addEventListener('click', () => {
  if (scrapedData.length > 0) exportCSV(scrapedData);
});

dashboardBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// ===== LISTEN FOR PROGRESS =====
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'progress') updateProgress(message.current, message.total);
});

// ===== INIT =====
loadSettings();
checkPage();
loadLastScan();
