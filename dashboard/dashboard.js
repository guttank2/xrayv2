// XRay Dashboard

let currentScanKey = null;
let currentPosts = [];
let sortCol = 'composite_score';
let sortAsc = false;

// ===== TABS =====
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// ===== HISTORY =====
async function loadHistory() {
  const result = await chrome.storage.local.get('scanHistory');
  const history = result.scanHistory || [];
  const container = document.getElementById('historyList');

  if (history.length === 0) {
    container.innerHTML = '<p class="empty-state">No scans yet. Go scan a profile.</p>';
    return;
  }

  container.innerHTML = history.map((entry, i) => {
    const date = new Date(entry.timestamp).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const isTrend = entry.mode === 'trend' || (entry.key && entry.key.startsWith('trend_'));
    const modeBadge = isTrend ? '<span class="history-mode">trend</span>' : '';
    const scoreText = isTrend
      ? 'top ' + formatNum(entry.maxEngagement || 0) + ' eng'
      : 'avg ' + (entry.avgScore || 0);
    return '<div class="history-item" data-index="' + i + '" data-key="' + entry.key + '">'
      + '<div>'
      + '<span class="history-account">' + (isTrend ? '' : '@') + (entry.account || 'unknown') + '</span>'
      + modeBadge
      + '<span class="history-meta"> &mdash; ' + date + '</span>'
      + '</div>'
      + '<div class="history-stats">'
      + '<span>' + (entry.postCount || 0) + ' posts</span>'
      + '<span>' + scoreText + '</span>'
      + '<button class="history-delete" data-key="' + entry.key + '" title="Delete">x</button>'
      + '</div>'
      + '</div>';
  }).join('');

  // Click to load scan
  container.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('history-delete')) return;
      container.querySelectorAll('.history-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      const key = item.dataset.key;
      const isTrend = key.startsWith('trend_');
      if (isTrend) {
        loadTrendScan(key);
        // Switch to trends tab
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-tab="trends"]').classList.add('active');
        document.getElementById('panel-trends').classList.add('active');
      } else {
        loadScan(key);
        // Switch to data tab
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-tab="data"]').classList.add('active');
        document.getElementById('panel-data').classList.add('active');
      }
    });
  });

  // Delete buttons
  container.querySelectorAll('.history-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteScan(btn.dataset.key);
    });
  });
}

async function deleteScan(key) {
  const result = await chrome.storage.local.get('scanHistory');
  let history = result.scanHistory || [];
  history = history.filter(h => h.key !== key);
  await chrome.storage.local.set({ scanHistory: history });
  await chrome.storage.local.remove([key, 'analysis_' + key]);
  if (currentScanKey === key) {
    currentScanKey = null;
    currentPosts = [];
    document.getElementById('dataTitle').textContent = 'Select a scan';
    document.getElementById('dataSummary').style.display = 'none';
    document.getElementById('dataTable').innerHTML = '<p class="empty-state">Select a scan from History to view posts.</p>';
    document.getElementById('exportCSV').disabled = true;
  }
  loadHistory();
}

document.getElementById('clearHistory').addEventListener('click', async () => {
  const result = await chrome.storage.local.get('scanHistory');
  const history = result.scanHistory || [];
  const keys = history.map(h => h.key);
  // Also remove analysis keys
  history.forEach(h => keys.push('analysis_' + h.key));
  keys.push('scanHistory');
  await chrome.storage.local.remove(keys);
  currentScanKey = null;
  currentPosts = [];
  document.getElementById('dataTitle').textContent = 'Select a scan';
  document.getElementById('dataSummary').style.display = 'none';
  document.getElementById('dataTable').innerHTML = '<p class="empty-state">Select a scan from History to view posts.</p>';
  document.getElementById('exportCSV').disabled = true;
  loadHistory();
});

// ===== LOAD SCAN DATA =====
async function loadScan(key) {
  const result = await chrome.storage.local.get(key);
  const data = result[key];
  if (!data) return;

  currentScanKey = key;
  currentPosts = data.posts || [];
  const summary = data.summary || {};
  const account = data.account || 'unknown';

  document.getElementById('dataTitle').textContent = '@' + account;
  document.getElementById('exportCSV').disabled = false;

  // Summary
  const summaryEl = document.getElementById('dataSummary');
  summaryEl.style.display = 'grid';
  const ciText = summary.avgScoreCI ? ' [' + summary.avgScoreCI[0] + ', ' + summary.avgScoreCI[1] + ']' : '';
  summaryEl.innerHTML = ''
    + summaryItem(summary.totalPosts || 0, 'Posts')
    + summaryItem((summary.avgScore || 0) + ciText, 'Avg Score (95% CI)')
    + summaryItem((summary.avgER || 0) + '%', 'Avg ER')
    + summaryItem((summary.tierBreakdown?.top || 0) + '/' + (summary.tierBreakdown?.middle || 0) + '/' + (summary.tierBreakdown?.bottom || 0), 'Top/Mid/Bot');

  // Charts
  renderCharts(currentPosts, summary);

  // Stats
  renderStats(summary);

  // Auto-diagnosis (Guide tab)
  runDiagnosis(currentPosts, summary, account);

  // LLM Analysis tab
  renderAnalysis(key);

  renderTable();
}

function summaryItem(value, label) {
  return '<div class="summary-item">'
    + '<div class="summary-value">' + value + '</div>'
    + '<div class="summary-label">' + label + '</div>'
    + '</div>';
}

// ===== SORTABLE TABLE =====
const COLUMNS = [
  { key: 'hook', label: 'Hook', sortable: true },
  { key: 'composite_score', label: 'Score', sortable: true, metric: true },
  { key: 'tier', label: 'Tier', sortable: true },
  { key: 'engagement_rate', label: 'ER%', sortable: true, metric: true },
  { key: 'wilson_er', label: 'Wilson', sortable: true, metric: true },
  { key: 'virality', label: 'Vir', sortable: true, metric: true },
  { key: 'reply_rate', label: 'Reply', sortable: true, metric: true },
  { key: 'info_density', label: 'Density', sortable: true },
  { key: 'likes', label: 'Likes', sortable: true },
  { key: 'retweets', label: 'RT', sortable: true },
  { key: 'replies', label: 'Rpl', sortable: true },
  { key: 'views', label: 'Views', sortable: true },
  { key: 'bookmarks', label: 'Bkm', sortable: true },
  { key: 'length_class', label: 'Length', sortable: true },
  { key: 'hook_type', label: 'Hook Type', sortable: true }
];

function getValue(post, col) {
  if (col.metric) return post.metrics?.[col.key] || 0;
  if (col.key === 'info_density') return post.info_density || 0;
  if (col.key === 'hook') return post.hook || '';
  if (col.key === 'tier') return post.tier || '';
  if (col.key === 'length_class') return post.length_class || '';
  if (col.key === 'hook_type') return post.hook_type || '';
  return post[col.key] || 0;
}

function renderTable() {
  const sorted = [...currentPosts].sort((a, b) => {
    const colDef = COLUMNS.find(c => c.key === sortCol);
    let va = getValue(a, colDef || COLUMNS[1]);
    let vb = getValue(b, colDef || COLUMNS[1]);
    if (typeof va === 'string') {
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return sortAsc ? va - vb : vb - va;
  });

  let html = '<table><thead><tr>';
  COLUMNS.forEach(col => {
    const arrow = sortCol === col.key ? (sortAsc ? '\u25B2' : '\u25BC') : '';
    html += '<th data-col="' + col.key + '">' + col.label + '<span class="sort-arrow">' + arrow + '</span></th>';
  });
  html += '</tr></thead><tbody>';

  sorted.forEach((post, i) => {
    const tierClass = post.tier === 'top' ? 'tier-top' : post.tier === 'bottom' ? 'tier-bottom' : '';
    html += '<tr class="post-row ' + tierClass + '" data-index="' + i + '">';
    COLUMNS.forEach(col => {
      let val = getValue(post, col);
      if (col.key === 'hook') {
        html += '<td class="hook-cell" title="' + escAttr(val) + '">' + esc(val) + '</td>';
      } else if (col.key === 'info_density') {
        html += '<td>' + val + ' (' + (post.density_class || '?') + ')</td>';
      } else {
        html += '<td>' + esc(String(val)) + '</td>';
      }
    });
    html += '</tr>';

    // Expanded row (hidden by default)
    html += '<tr class="expanded-row" data-expand="' + i + '" style="display:none;">';
    html += '<td colspan="' + COLUMNS.length + '">';
    html += '<div class="expanded-content">';
    if (post.url) html += '<a class="post-url" href="' + esc(post.url) + '" target="_blank">' + esc(post.url) + '</a>';
    html += '<div class="expanded-text">' + esc(post.text || 'No text') + '</div>';
    html += '<div class="expanded-metrics">';
    html += metric('Score', post.metrics?.composite_score);
    html += metric('ER', post.metrics?.engagement_rate + '%');
    html += metric('Wilson ER', post.metrics?.wilson_er + '%');
    html += metric('Virality', post.metrics?.virality);
    html += metric('Reply Rate', post.metrics?.reply_rate);
    html += metric('Save Rate', post.metrics?.save_rate);
    html += metric('z(Wilson)', post.metrics?.z_wilson);
    html += metric('z(Virality)', post.metrics?.z_virality);
    html += metric('z(Reply)', post.metrics?.z_reply);
    html += metric('Density', post.info_density + ' (' + (post.density_class || '?') + ')');
    html += metric('Likes', post.likes);
    html += metric('Retweets', post.retweets);
    html += metric('Replies', post.replies);
    html += metric('Views', post.views);
    html += metric('Bookmarks', post.bookmarks);
    html += metric('Media', post.media_type || 'text');
    html += metric('Length', post.length_class);
    html += metric('Hook Type', post.hook_type);
    html += '</div></div></td></tr>';
  });

  html += '</tbody></table>';
  document.getElementById('dataTable').innerHTML = html;

  // Sort handlers
  document.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortAsc = !sortAsc;
      } else {
        sortCol = col;
        sortAsc = false;
      }
      renderTable();
    });
  });

  // Expand handlers
  document.querySelectorAll('.post-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = row.dataset.index;
      const expandRow = document.querySelector('[data-expand="' + idx + '"]');
      if (expandRow) {
        expandRow.style.display = expandRow.style.display === 'none' ? '' : 'none';
      }
    });
  });
}

function metric(label, value) {
  return '<div class="expanded-metric">'
    + '<span class="expanded-metric-label">' + label + '</span>'
    + '<span>' + (value != null ? value : '-') + '</span>'
    + '</div>';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s) {
  return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== CHARTS =====
function renderCharts(posts, summary) {
  const container = document.getElementById('dataCharts');
  if (!container || posts.length === 0) {
    if (container) container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';

  // Histogram — score distribution
  const scores = posts.map(p => p.metrics?.composite_score || 0);
  const topPosts = posts.filter(p => p.tier === 'top');
  const bottomPosts = posts.filter(p => p.tier === 'bottom');
  const tierBounds = [];
  if (topPosts.length > 0 && bottomPosts.length > 0) {
    const topMin = Math.min(...topPosts.map(p => p.metrics.composite_score));
    const botMax = Math.max(...bottomPosts.map(p => p.metrics.composite_score));
    const midPosts = posts.filter(p => p.tier === 'middle');
    if (midPosts.length > 0) {
      tierBounds.push(topMin);
      tierBounds.push(Math.min(...midPosts.map(p => p.metrics.composite_score)));
    } else {
      tierBounds.push(topMin);
    }
  }
  XRayCharts.drawHistogram(document.getElementById('chartHistogram'), scores, tierBounds);

  // Scatter — ER vs Views
  XRayCharts.drawScatter(document.getElementById('chartScatter'), posts);

  // Box plot — tier comparison
  const tierData = {
    top: topPosts.map(p => p.metrics.composite_score),
    middle: posts.filter(p => p.tier === 'middle').map(p => p.metrics.composite_score),
    bottom: bottomPosts.map(p => p.metrics.composite_score)
  };
  XRayCharts.drawBoxPlot(document.getElementById('chartBoxPlot'), tierData, summary.effectSize);
}

// ===== STATS ROW =====
function renderStats(summary) {
  const container = document.getElementById('dataStats');
  if (!container) return;
  if (!summary || !summary.totalPosts) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'grid';

  let html = '';

  // Effect size
  const es = summary.effectSize || {};
  html += statCard('Effect Size', 'd = ' + (es.d || '?'), es.interpretation || 'n/a');

  // Score CV
  html += statCard('Score CV', summary.scoreCV + '%',
    summary.scoreCVInterpretation || '');

  // Hook type chi-squared
  const ht = summary.hookTypeSignificance || {};
  html += statCard('Hook Type χ²',
    'χ² = ' + (ht.chi2 || '?') + ' (df=' + (ht.df || '?') + ')',
    ht.significant ? 'Significant (p<0.05) — hook type matters' : 'Not significant — hook type may not matter');

  // Confidence interval
  const ci = summary.avgScoreCI || [];
  html += statCard('95% CI (Score)',
    '[' + (ci[0] || '?') + ', ' + (ci[1] || '?') + ']',
    'Mean: ' + (summary.avgScore || '?'));

  container.innerHTML = html;
}

function statCard(label, value, detail) {
  return '<div class="stat-card">'
    + '<div class="stat-card-label">' + label + '</div>'
    + '<div class="stat-card-value">' + value + '</div>'
    + '<div class="stat-card-detail">' + detail + '</div>'
    + '</div>';
}

// ===== CSV EXPORT =====
document.getElementById('exportCSV').addEventListener('click', () => {
  if (currentPosts.length === 0) return;
  const headers = ['hook', 'hook_type', 'length_class', 'density_class', 'info_density', 'tier',
    'composite_score', 'engagement_rate', 'wilson_er', 'virality', 'reply_rate', 'save_rate',
    'z_wilson', 'z_virality', 'z_reply',
    'likes', 'retweets', 'replies', 'views', 'bookmarks', 'media_type', 'url', 'text'];

  const METRIC_KEYS = ['composite_score', 'engagement_rate', 'wilson_er', 'virality',
    'reply_rate', 'save_rate', 'z_wilson', 'z_virality', 'z_reply'];

  const rows = currentPosts.map(p => {
    return headers.map(h => {
      let val;
      if (METRIC_KEYS.includes(h)) {
        val = p.metrics?.[h] || 0;
      } else {
        val = p[h] || '';
      }
      if (typeof val === 'string') {
        val = val.replace(/"/g, '""');
        if (val.includes(',') || val.includes('\n') || val.includes('"')) {
          val = '"' + val + '"';
        }
      }
      return val;
    }).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'xray-' + (currentScanKey || 'export') + '.csv';
  a.click();
  URL.revokeObjectURL(url);
});

// ===== ACCORDIONS =====
document.querySelectorAll('.accordion-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const accordion = btn.parentElement;
    const content = accordion.querySelector('.accordion-content');
    const arrow = btn.querySelector('.accordion-arrow');
    const isOpen = accordion.dataset.open === 'true';

    if (isOpen) {
      accordion.dataset.open = 'false';
      content.style.display = 'none';
      arrow.innerHTML = '&#9654;';
    } else {
      accordion.dataset.open = 'true';
      content.style.display = 'block';
      arrow.innerHTML = '&#9660;';
    }
  });
});

// ===== SCORE CALCULATOR =====
const calcBtn = document.getElementById('calcRun');
if (calcBtn) {
  calcBtn.addEventListener('click', () => {
    const likes = parseInt(document.getElementById('calcLikes').value) || 0;
    const rt = parseInt(document.getElementById('calcRT').value) || 0;
    const replies = parseInt(document.getElementById('calcReplies').value) || 0;
    const views = parseInt(document.getElementById('calcViews').value) || 1;
    const bookmarks = parseInt(document.getElementById('calcBookmarks').value) || 0;

    const E = likes + rt + replies;
    const rawER = (E / Math.max(views, 1)) * 100;

    // Wilson lower bound
    const p = E / Math.max(views, 1);
    const n = Math.max(views, 1);
    const z = 1.96;
    const wilson = n > 0
      ? (p + z*z/(2*n) - z*Math.sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n)
      : 0;
    const wilsonPct = Math.max(0, wilson * 100);

    const V = rt / Math.max(likes, 1);
    const R = replies / Math.max(likes + rt, 1);
    const SR = (bookmarks / Math.max(views, 1)) * 100;
    const saveBonus = bookmarks > 0 ? SR * 2 : 0;
    const logBonus = E > 0 ? Math.log10(E) : 0;

    // Simulated batch (demo z-scores assume this post IS the batch)
    // Use fixed demo batch means/stds for illustration
    const muW = 2.0, sigW = 1.5;
    const muV = 0.15, sigV = 0.1;
    const muR = 0.05, sigR = 0.04;

    const zW = (wilsonPct - muW) / Math.max(sigW, 0.001);
    const zV = (V - muV) / Math.max(sigV, 0.001);
    const zR = (R - muR) / Math.max(sigR, 0.001);

    const score = (zW * 1) + (zV * 3) + (zR * 2) + logBonus + saveBonus;

    const result = document.getElementById('calcResult');
    const breakdown = document.getElementById('calcBreakdown');
    result.style.display = 'block';

    breakdown.innerHTML = ''
      + calcLine('Raw ER', rawER.toFixed(2) + '%')
      + calcLine('Wilson ER', wilsonPct.toFixed(2) + '%')
      + calcLine('Virality (V)', V.toFixed(3))
      + calcLine('Reply Rate (R)', R.toFixed(3))
      + calcLine('Save Rate (SR)', SR.toFixed(3) + '%')
      + calcLine('z(Wilson) x1', zW.toFixed(2) + ' x 1 = ' + (zW * 1).toFixed(2))
      + calcLine('z(Virality) x3', zV.toFixed(2) + ' x 3 = ' + (zV * 3).toFixed(2))
      + calcLine('z(Reply) x2', zR.toFixed(2) + ' x 2 = ' + (zR * 2).toFixed(2))
      + calcLine('Log bonus', 'log10(' + E + ') = ' + logBonus.toFixed(2))
      + calcLine('Save bonus', saveBonus.toFixed(2))
      + '<div class="calc-line calc-total"><span>Composite Score</span><span>' + score.toFixed(2) + '</span></div>'
      + '<div style="font-size:10px;color:#888;margin-top:8px;">* z-scores use demo batch means (&mu;<sub>W</sub>=2.0, &mu;<sub>V</sub>=0.15, &mu;<sub>R</sub>=0.05). Real scores depend on your scan batch.</div>';
  });
}

function calcLine(label, value) {
  return '<div class="calc-line"><span class="calc-label">' + label + '</span><span>' + value + '</span></div>';
}

// ===== AUTO-DIAGNOSIS =====
function runDiagnosis(posts, summary, account) {
  const container = document.getElementById('guideDiagnosis');
  const body = document.getElementById('diagnosisBody');
  const accountEl = document.getElementById('diagnosisAccount');
  if (!container || !body || !summary || !posts || posts.length === 0) {
    if (container) container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  accountEl.textContent = '@' + (account || 'unknown') + ' (' + posts.length + ' posts)';

  const items = [];

  // Effect size
  const es = summary.effectSize || {};
  if (es.d != null) {
    const d = parseFloat(es.d);
    if (d < 0.2) {
      items.push({ badge: 'bad', label: 'Effect Size', text: 'd=' + es.d + ' — negligible. Your top and bottom posts perform similarly. Tiers are noise. Experiment more.' });
    } else if (d < 0.8) {
      items.push({ badge: 'warn', label: 'Effect Size', text: 'd=' + es.d + ' — moderate. Some patterns exist. Look at top posts for clues.' });
    } else {
      items.push({ badge: 'good', label: 'Effect Size', text: 'd=' + es.d + ' — large. Clear difference between tiers. Your top posts are doing something right.' });
    }
  }

  // Score CV
  if (summary.scoreCV != null) {
    const cv = parseFloat(summary.scoreCV);
    if (cv > 80) {
      items.push({ badge: 'bad', label: 'Score CV', text: cv + '% — wild variance. Scores all over the place. Need more data or focused strategy.' });
    } else if (cv > 40) {
      items.push({ badge: 'warn', label: 'Score CV', text: cv + '% — moderate spread. Normal. Focus on what winners share.' });
    } else {
      items.push({ badge: 'good', label: 'Score CV', text: cv + '% — consistent. You have a reliable formula.' });
    }
  }

  // Chi-squared
  const ht = summary.hookTypeSignificance || {};
  if (ht.chi2 != null) {
    if (ht.significant) {
      items.push({ badge: 'good', label: 'Hook Types', text: 'Significant (chi2=' + ht.chi2 + '). Certain hook types are overrepresented in top tier. Use them more.' });
    } else {
      items.push({ badge: 'warn', label: 'Hook Types', text: 'Not significant (chi2=' + ht.chi2 + '). Hook type alone doesn\'t predict success for your content.' });
    }
  }

  // CI width
  const ci = summary.avgScoreCI || [];
  if (ci.length === 2) {
    const width = parseFloat(ci[1]) - parseFloat(ci[0]);
    if (width > 5) {
      items.push({ badge: 'bad', label: '95% CI', text: '[' + ci[0] + ', ' + ci[1] + '] — very wide. Not enough data. Scan 100+ posts.' });
    } else if (width > 2) {
      items.push({ badge: 'warn', label: '95% CI', text: '[' + ci[0] + ', ' + ci[1] + '] — moderate uncertainty. More posts would help.' });
    } else {
      items.push({ badge: 'good', label: '95% CI', text: '[' + ci[0] + ', ' + ci[1] + '] — tight range. Average is reliable.' });
    }
  }

  // Best hook type in top tier
  const topPosts = posts.filter(p => p.tier === 'top');
  if (topPosts.length > 0) {
    const hookCounts = {};
    topPosts.forEach(p => {
      const ht = p.hook_type || 'statement';
      hookCounts[ht] = (hookCounts[ht] || 0) + 1;
    });
    const best = Object.entries(hookCounts).sort((a, b) => b[1] - a[1])[0];
    if (best) {
      items.push({ badge: 'good', label: 'Top Hook', text: '"' + best[0] + '" appears ' + best[1] + '/' + topPosts.length + ' times in top tier.' });
    }
  }

  // Best media type
  if (topPosts.length > 0) {
    const mediaCounts = {};
    topPosts.forEach(p => {
      const m = p.media_type || 'text';
      mediaCounts[m] = (mediaCounts[m] || 0) + 1;
    });
    const bestMedia = Object.entries(mediaCounts).sort((a, b) => b[1] - a[1])[0];
    if (bestMedia) {
      items.push({ badge: 'good', label: 'Top Media', text: '"' + bestMedia[0] + '" dominates top tier (' + bestMedia[1] + '/' + topPosts.length + ').' });
    }
  }

  body.innerHTML = items.map(item =>
    '<div class="diagnosis-item">'
    + '<span class="diagnosis-badge badge-' + item.badge + '">' + item.label + '</span>'
    + '<span class="diagnosis-text">' + item.text + '</span>'
    + '</div>'
  ).join('');
}

// ===== LLM ANALYSIS =====
async function renderAnalysis(scanKey) {
  const emptyEl = document.getElementById('analysisEmpty');
  const loadingEl = document.getElementById('analysisLoading');
  const errorEl = document.getElementById('analysisError');
  const contentEl = document.getElementById('analysisContent');
  const titleEl = document.getElementById('analysisTitle');

  // Hide all states
  emptyEl.style.display = 'none';
  loadingEl.style.display = 'none';
  errorEl.style.display = 'none';
  contentEl.style.display = 'none';

  if (!scanKey) {
    emptyEl.style.display = 'block';
    titleEl.textContent = 'AI Analysis';
    return;
  }

  const result = await chrome.storage.local.get('analysis_' + scanKey);
  const analysis = result['analysis_' + scanKey];

  if (!analysis) {
    emptyEl.style.display = 'block';
    titleEl.textContent = 'AI Analysis — no data';
    return;
  }

  if (analysis.status === 'pending') {
    // Stale detection: if pending > 5 min, the service worker probably died
    const elapsed = Date.now() - (analysis.timestamp || 0);
    if (elapsed > 300000) {
      errorEl.style.display = 'block';
      titleEl.textContent = 'AI Analysis — timed out';
      errorEl.innerHTML = 'Pipeline did not respond within 5 minutes.<br>Check if your n8n webhook is running and handles this scan mode.';
      return;
    }
    loadingEl.style.display = 'block';
    titleEl.textContent = 'AI Analysis — running...';
    return;
  }

  if (analysis.status === 'error') {
    errorEl.style.display = 'block';
    titleEl.textContent = 'AI Analysis — error';
    errorEl.innerHTML = esc(analysis.error || 'Unknown error. Check n8n webhook.');
    return;
  }

  // Complete — render
  titleEl.textContent = 'AI Analysis';
  contentEl.style.display = 'block';

  // Key Insight
  const insightCard = document.getElementById('insightCard');
  if (analysis.key_insight) {
    insightCard.style.display = 'block';
    insightCard.innerHTML = '<div class="insight-label">Key Insight</div><div class="insight-text">' + esc(analysis.key_insight) + '</div>';
  } else {
    insightCard.style.display = 'none';
  }

  // What Works
  renderPatternSection('whatWorks', analysis.what_works || []);

  // What Doesn't Work
  renderPatternSection('whatDoesntWork', analysis.what_doesnt_work || []);

  // Why It Works
  renderWhySection('whyItWorks', analysis.why_it_works || []);

  // Audience Profile
  renderAudience('audienceProfile', analysis.audience_profile || {});

  // Templates
  renderTemplates('templatesSection', analysis.templates || []);
}

function renderPatternSection(id, patterns) {
  const section = document.getElementById(id);
  const body = section.querySelector('.analysis-section-body');
  if (!patterns || patterns.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  body.innerHTML = patterns.map(p =>
    '<div class="pattern-card">'
    + '<div class="pattern-title">' + esc(p.pattern || '') + '</div>'
    + '<div class="pattern-evidence">' + esc(p.evidence || '') + '</div>'
    + (p.examples && p.examples.length > 0
      ? '<div class="pattern-examples">' + p.examples.map(ex => '<div class="pattern-example">' + esc(ex) + '</div>').join('') + '</div>'
      : '')
    + '</div>'
  ).join('');
}

function renderWhySection(id, items) {
  const section = document.getElementById(id);
  const body = section.querySelector('.analysis-section-body');
  if (!items || items.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  body.innerHTML = items.map(item =>
    '<div class="pattern-card">'
    + '<div class="pattern-title">' + esc(item.pattern || '') + '</div>'
    + '<div class="pattern-evidence">' + esc(item.mechanism || '') + '</div>'
    + '</div>'
  ).join('');
}

function renderAudience(id, profile) {
  const section = document.getElementById(id);
  const body = section.querySelector('.analysis-section-body');
  const wants = profile.wants || [];
  const pains = profile.pain_points || [];
  const identity = profile.identity || '';

  if (wants.length === 0 && pains.length === 0 && !identity) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  let html = '<div class="audience-card">';
  if (identity) {
    html += '<div class="audience-identity">' + esc(identity) + '</div>';
  }
  if (wants.length > 0) {
    html += '<div class="audience-group"><div class="audience-group-label">Wants</div>';
    html += wants.map(w => '<div class="audience-item audience-want">' + esc(w) + '</div>').join('');
    html += '</div>';
  }
  if (pains.length > 0) {
    html += '<div class="audience-group"><div class="audience-group-label">Pain Points</div>';
    html += pains.map(p => '<div class="audience-item audience-pain">' + esc(p) + '</div>').join('');
    html += '</div>';
  }
  html += '</div>';
  body.innerHTML = html;
}

function renderTemplates(id, templates) {
  const section = document.getElementById(id);
  const body = section.querySelector('.analysis-section-body');
  if (!templates || templates.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  body.innerHTML = templates.map(t =>
    '<div class="template-card">'
    + '<div class="template-body">' + esc(t.template || '') + '</div>'
    + (t.example ? '<div class="template-example"><span class="template-example-label">Example:</span> ' + esc(t.example) + '</div>' : '')
    + (t.based_on ? '<div class="template-based-on">Based on: ' + esc(t.based_on) + '</div>' : '')
    + '</div>'
  ).join('');
}

// Listen for analysis completion (background worker notifies)
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'analysisComplete' && currentScanKey) {
    // Check if this analysis matches current scan
    if (message.scanKey === currentScanKey) {
      renderAnalysis(currentScanKey);
    }
  }
});

// ===== HELPER =====
function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ===== TREND SCAN =====
async function loadTrendScan(key) {
  const result = await chrome.storage.local.get(key);
  const data = result[key];
  if (!data) return;

  currentScanKey = key;
  currentPosts = data.posts || [];
  const account = data.account || 'unknown';

  // Show trends content, hide empty state
  document.getElementById('trendsEmpty').style.display = 'none';
  document.getElementById('trendsContent').style.display = 'block';
  document.getElementById('trendsTitle').textContent = 'Trend Scanner — ' + account;

  // Summary row
  const summaryEl = document.getElementById('trendsSummary');
  summaryEl.style.display = 'grid';
  summaryEl.innerHTML = ''
    + summaryItem(data.totalScanned || 0, 'Posts Scanned')
    + summaryItem(formatNum(data.maxVelocity || 0) + '/h', 'Top Velocity')
    + summaryItem(formatNum(data.maxEngagement || 0), 'Top Engagement')
    + summaryItem((data.keywords || []).length, 'Topics Found');

  // Keywords
  renderTrendKeywords(data.keywords || []);

  // Top Posts (sorted by velocity)
  renderTrendTopPosts(data.topPosts || data.posts?.slice(0, 20) || [], data.maxEngagement || 1, data.maxVelocity || 0);

  // Top Authors
  renderTrendAuthors(data.topAuthors || []);

  // Clusters
  renderTrendClusters(data.clusters || []);

  // Hooks
  renderTrendHooks(data.trendingHooks || []);

  // Also render analysis if available
  renderAnalysis(key);
}

function renderTrendKeywords(keywords) {
  const container = document.querySelector('#trendsKeywords .trends-keywords');
  if (!keywords || keywords.length === 0) {
    document.getElementById('trendsKeywords').style.display = 'none';
    return;
  }
  document.getElementById('trendsKeywords').style.display = 'block';
  container.innerHTML = keywords.map(kw => {
    const topicType = kw.type || 'keyword';
    const typeClass = 'topic-' + topicType;
    const velText = kw.avgVel ? ' · ' + formatNum(kw.avgVel) + '/h' : '';
    return '<span class="keyword-pill ' + typeClass + '">'
      + esc(kw.word)
      + '<span class="keyword-count">' + kw.count + velText + '</span>'
      + '</span>';
  }).join('');
}

function renderTrendTopPosts(posts, maxEng, maxVelocity) {
  const container = document.querySelector('#trendsTopPosts .trends-top-posts');
  if (!posts || posts.length === 0) {
    document.getElementById('trendsTopPosts').style.display = 'none';
    return;
  }
  document.getElementById('trendsTopPosts').style.display = 'block';
  const maxVel = maxVelocity || Math.max(...posts.map(p => p.velocity || 0), 1);
  container.innerHTML = posts.map(p => {
    const eng = (p.likes || 0) + (p.retweets || 0) + (p.replies || 0);
    const vel = p.velocity || 0;
    const barWidth = maxVel > 0 ? Math.round((vel / maxVel) * 100) : 0;
    const hook = p.text ? (p.text.split('\n')[0] || '').substring(0, 200) : 'No text';
    const url = p.url || '';
    const age = p.ageLabel || '';
    return '<div class="trend-post-card">'
      + '<div class="trend-post-info">'
      + '<div class="trend-post-author">'
      + '<strong>' + esc(p.author || '') + '</strong> @' + esc(p.author_handle || 'unknown')
      + (age ? '<span class="trend-post-age">' + age + ' ago</span>' : '')
      + '</div>'
      + '<div class="trend-post-hook">' + esc(hook) + '</div>'
      + '<div class="trend-post-meta">'
      + '<span>' + formatNum(p.likes || 0) + ' likes</span>'
      + '<span>' + formatNum(p.retweets || 0) + ' RT</span>'
      + '<span>' + formatNum(p.replies || 0) + ' replies</span>'
      + '<span>' + (p.media_type || 'text') + '</span>'
      + (url ? '<a class="trend-post-url" href="' + esc(url) + '" target="_blank">view</a>' : '')
      + '</div>'
      + '</div>'
      + '<div class="trend-post-engagement">'
      + '<span class="trend-eng-number">' + formatNum(vel) + '</span>'
      + '<span class="trend-eng-label">eng/hour</span>'
      + '<div class="engagement-bar"><div class="engagement-bar-fill" style="width:' + barWidth + '%"></div></div>'
      + '<span class="trend-eng-total">' + formatNum(eng) + ' total</span>'
      + '</div>'
      + '</div>';
  }).join('');
}

function renderTrendAuthors(authors) {
  const container = document.querySelector('#trendsAuthors .trends-authors');
  if (!authors || authors.length === 0) {
    document.getElementById('trendsAuthors').style.display = 'none';
    return;
  }
  document.getElementById('trendsAuthors').style.display = 'block';
  container.innerHTML = authors.map(a =>
    '<div class="trend-author-card">'
    + '<div>'
    + '<div class="trend-author-name">' + esc(a.name || a.handle) + '</div>'
    + '<div class="trend-author-handle">@' + esc(a.handle) + '</div>'
    + '</div>'
    + '<div class="trend-author-stats">'
    + '<strong>' + a.count + '</strong> posts<br>'
    + formatNum(a.avgEng) + ' avg eng'
    + '</div>'
    + '</div>'
  ).join('');
}

function renderTrendClusters(clusters) {
  const container = document.querySelector('#trendsClusters .trends-clusters');
  if (!clusters || clusters.length === 0) {
    document.getElementById('trendsClusters').style.display = 'none';
    return;
  }
  document.getElementById('trendsClusters').style.display = 'block';
  container.innerHTML = clusters.map((cl, i) =>
    '<div class="cluster-group">'
    + '<div class="cluster-header" data-cluster="' + i + '">'
    + '<span class="cluster-keyword">#' + esc(cl.keyword) + '</span>'
    + '<span class="cluster-meta">' + cl.count + ' posts &middot; ' + formatNum(cl.avgVelocity || cl.avgEngagement) + '/h velocity</span>'
    + '</div>'
    + '<div class="cluster-posts" id="cluster-posts-' + i + '">'
    + (cl.posts || []).map(p => {
      const eng = (p.likes || 0) + (p.retweets || 0) + (p.replies || 0);
      const text = (p.text || '').split('\n')[0].substring(0, 120);
      return '<div class="cluster-post-item">'
        + '<span class="cluster-post-text">' + esc(text) + '</span>'
        + '<span class="cluster-post-eng">' + formatNum(eng) + '</span>'
        + '</div>';
    }).join('')
    + '</div>'
    + '</div>'
  ).join('');

  // Toggle cluster expansion
  container.querySelectorAll('.cluster-header').forEach(header => {
    header.addEventListener('click', () => {
      const idx = header.dataset.cluster;
      const posts = document.getElementById('cluster-posts-' + idx);
      if (posts) posts.classList.toggle('open');
    });
  });
}

function renderTrendHooks(hooks) {
  const container = document.querySelector('#trendsHooks .trends-hooks');
  if (!hooks || hooks.length === 0) {
    document.getElementById('trendsHooks').style.display = 'none';
    return;
  }
  document.getElementById('trendsHooks').style.display = 'block';
  container.innerHTML = hooks.map(h =>
    '<div class="trend-hook-card">'
    + '<span class="trend-hook-text">' + esc(h.hook || '') + '</span>'
    + '<span class="trend-hook-author">@' + esc(h.author_handle || 'unknown')
    + (h.ageLabel ? ' · ' + h.ageLabel : '') + '</span>'
    + '<span class="trend-hook-eng">' + formatNum(h.velocity || h.engagement) + '/h</span>'
    + '</div>'
  ).join('');
}

// ===== INIT =====
loadHistory();
