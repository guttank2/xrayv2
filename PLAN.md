# XRay Trend Scanner — Implementation Plan

## Concept

When user is on the **Home Feed** (or Explore/Search), XRay switches from "Profile Analysis" mode to **"Trend Scanner"** mode. Instead of tier/score analysis (which is meaningless for mixed accounts), it:

1. Sorts posts by **raw engagement** (likes + RT + replies) — the viral signal
2. Extracts **trending topics/themes** from the top posts
3. Groups posts by topic cluster
4. Sends to n8n pipeline with a **different prompt** — "what's trending, what hooks work on trending topics, suggest adjacent content ideas"
5. Dashboard displays a **Trends** view instead of the normal Data/Charts view

## Architecture

The Trend Scanner is a **parallel mode**, not a replacement. Profile scans stay exactly as-is.

### Detection
- Already handled: `popup.js:115-121` detects `page.type === 'home'`
- We add a `scanMode` field: `'profile'` vs `'trend'`
- When `page.type` is `home`, `explore`, or `search` → `scanMode = 'trend'`

## Files Changed

### 1. `content/scraper.js` — Extract author info for home feed posts

**Current**: Only extracts text, metrics, media_type, url, timestamp
**Add**: For trend mode, also extract:
- `author`: display name from the tweet article
- `author_handle`: @handle from the article link
- `card_title`: text from `[data-testid="card.wrapper"]` title element (fixes the "no text" article bug too)
- `card_description`: description from the card

**Change to `getPostData()`**:
```js
// Extract card text as fallback when tweetText is empty
if (!text && article.querySelector('[data-testid="card.wrapper"]')) {
  const cardTitle = article.querySelector('[data-testid="card.layoutLarge.detail"] > span, [data-testid="card.layoutSmall.detail"] > span');
  const cardDesc = article.querySelector('[data-testid="card.layoutLarge.detail"] div[role], [data-testid="card.layoutSmall.detail"] div[role]');
  if (cardTitle) text = cardTitle.innerText;
  if (cardDesc) text = text + ' — ' + cardDesc.innerText;
}

// Extract author (needed for trend/home feed scanning)
const authorEl = article.querySelector('[data-testid="User-Name"]');
let author = '';
let author_handle = '';
if (authorEl) {
  const nameSpan = authorEl.querySelector('span > span');
  const handleLink = authorEl.querySelector('a[href^="/"]');
  if (nameSpan) author = nameSpan.innerText;
  if (handleLink) author_handle = handleLink.getAttribute('href').replace('/', '');
}
```

Return these new fields in the post data object.

### 2. `popup/popup.js` — Trend mode UI + scan behavior

**Changes**:
- In `checkPage()`: when home/explore/search detected, set `scanMode = 'trend'` and change button text to "Scan Trends"
- Pass `scanMode` to scraper message and webhook
- In `onScrapeComplete()`: for trend mode, skip `storeScanData()` (which uses profile metrics), use `storeTrendData()` instead
- Add `storeTrendData()` function:
  - Sort posts by raw engagement (likes + RT + replies) descending
  - Extract top-20 as "trending posts"
  - Simple keyword extraction: split text into words, count frequency, filter stopwords → top topic keywords
  - Store under `trend_` prefix key

**UI changes in popup.html**:
- Change status hint text when in trend mode
- Button says "Scan Trends" instead of "Scan Posts"
- Stats card shows "Top Post" engagement instead of average stats

### 3. `background.js` — Different webhook payload for trend mode

**Changes**:
- Detect `scanMode` in the `analyzeWebhook` message
- For trend mode, send to a **different webhook endpoint** (or same endpoint with a `mode: 'trend'` flag)
- The payload includes `mode: 'trend'` so n8n can route to a different LLM prompt

```js
const payload = {
  mode: message.scanMode || 'profile',  // NEW
  account: ...,
  posts: ...,
  scraped_at: ...
};
```

### 4. `lib/trends.js` — NEW file: Trend analysis module

Lightweight client-side processing (like metrics.js but for trends):

```js
const XRayTrends = {
  processTrends(posts) {
    // 1. Sort by raw engagement
    const sorted = [...posts].sort((a, b) => {
      const engA = (a.likes || 0) + (a.retweets || 0) + (a.replies || 0);
      const engB = (b.likes || 0) + (b.retweets || 0) + (b.replies || 0);
      return engB - engA;
    });

    // 2. Extract topic keywords from top posts
    const topN = sorted.slice(0, 20);
    const keywords = extractKeywords(topN);

    // 3. Cluster posts by shared keywords (simple overlap)
    const clusters = clusterByKeywords(sorted, keywords);

    // 4. Identify trending hooks (hooks from top engagement posts)
    const trendingHooks = topN.map(p => ({
      hook: extractHook(p.text),
      engagement: (p.likes || 0) + (p.retweets || 0) + (p.replies || 0),
      author: p.author_handle || 'unknown',
      media_type: p.media_type
    }));

    return {
      sorted,
      topPosts: topN,
      keywords: keywords.slice(0, 15),
      clusters,
      trendingHooks,
      totalScanned: posts.length,
      maxEngagement: sorted[0] ? (sorted[0].likes + sorted[0].retweets + sorted[0].replies) : 0
    };
  }
};
```

**Keyword extraction** (stopword-filtered word frequency):
- Split all top-20 post texts into words
- Filter: stopwords, < 3 chars, common words
- Count frequency
- Return top 15 keywords sorted by count

**Clustering** (simple keyword overlap):
- For each keyword, collect posts that contain it
- Merge overlapping clusters
- Name cluster by its top keyword

### 5. `dashboard/dashboard.js` + `dashboard/dashboard.html` — Trends tab

**New tab**: "Trends" (shown next to History/Data/Guide/Analysis/Reference)

**Trends panel contents**:
1. **Top Keywords** — tag cloud / pill list of trending topics
2. **Viral Posts** — sorted list showing: author, hook, engagement count, media type
3. **Topic Clusters** — collapsible groups of posts by theme
4. **Trending Hooks** — the winning hooks from top-engagement posts

**Changes to loadScan()**:
- Detect if scan key starts with `trend_` → render trends view instead of profile view
- Switch to Trends tab automatically

### 6. `dashboard/dashboard.html` — Add Trends tab panel

```html
<button class="tab" data-tab="trends">Trends</button>

<section class="tab-panel" id="panel-trends">
  <div class="panel-header">
    <h2 id="trendsTitle">Trend Scanner</h2>
  </div>
  <div id="trendsKeywords" class="trends-keywords"></div>
  <div id="trendsTopPosts" class="trends-top-posts"></div>
  <div id="trendsClusters" class="trends-clusters"></div>
  <div id="trendsHooks" class="trends-hooks"></div>
  <!-- AI analysis for trends will appear in the existing Analysis tab -->
</section>
```

### 7. `dashboard/dashboard.css` — Trend-specific styles

New classes:
- `.trends-keywords` — flexbox pill/tag layout
- `.keyword-pill` — individual keyword tag with count
- `.trend-post-card` — card showing viral post (author, hook, engagement bar)
- `.cluster-group` — collapsible topic cluster
- `.engagement-bar` — visual bar showing relative engagement

### 8. `popup/popup.css` — Minor: trend mode styling

- Scan button color change in trend mode (optional visual distinction)

## Data Flow

```
[Home Feed] → scraper.js (+ author, card_text)
            → popup.js (detects trend mode)
            → trends.js (sort, keyword extract, cluster)
            → chrome.storage (trend_xxx key)
            → background.js → webhook (mode: 'trend')
            → n8n (different prompt for trend analysis)
            → background.js → chrome.storage (analysis_trend_xxx)
            → dashboard.js → Trends tab
```

## Implementation Order

1. **scraper.js** — Add author + card text extraction (fixes "no text" bug too)
2. **lib/trends.js** — Create trend processing module
3. **popup.js + popup.html** — Trend mode detection + UI
4. **background.js** — Pass scan mode to webhook
5. **dashboard.html + dashboard.css** — Trends tab markup + styles
6. **dashboard.js** — Trend rendering logic
7. **manifest.json** — No changes needed (already has all required permissions)

## What This Does NOT Include (Future)
- Comment/reply scraping (separate, much bigger feature)
- AI bot detection in comments
- Real-time trending (would need periodic auto-scanning)
- Cross-tab comparison (comparing trends across multiple scan sessions)
