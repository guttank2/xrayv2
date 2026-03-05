function parseNumber(str) {
  if (!str) return 0;
  str = str.toLowerCase().replace(/,/g, '');
  if (str.includes('k')) return parseFloat(str) * 1000;
  if (str.includes('m')) return parseFloat(str) * 1000000;
  return parseInt(str) || 0;
}

function getPostData(article) {
  try {
    const textEl = article.querySelector('[data-testid="tweetText"]');
    let text = textEl ? textEl.innerText : '';
    const timeEl = article.querySelector('time');
    const timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
    const linkEl = article.querySelector('a[href*="/status/"]');
    const url = linkEl ? 'https://x.com' + linkEl.getAttribute('href') : '';
    const metrics = { replies: 0, retweets: 0, likes: 0, views: 0, bookmarks: 0 };
    
    const replyBtn = article.querySelector('[data-testid="reply"]');
    if (replyBtn) {
      const span = replyBtn.querySelector('span[data-testid="app-text-transition-container"]');
      metrics.replies = span ? parseNumber(span.innerText) : 0;
    }
    const retweetBtn = article.querySelector('[data-testid="retweet"]');
    if (retweetBtn) {
      const span = retweetBtn.querySelector('span[data-testid="app-text-transition-container"]');
      metrics.retweets = span ? parseNumber(span.innerText) : 0;
    }
    const likeBtn = article.querySelector('[data-testid="like"]');
    if (likeBtn) {
      const span = likeBtn.querySelector('span[data-testid="app-text-transition-container"]');
      metrics.likes = span ? parseNumber(span.innerText) : 0;
    }
    const analyticsLink = article.querySelector('a[href*="/analytics"]');
    if (analyticsLink) {
      const span = analyticsLink.querySelector('span');
      metrics.views = span ? parseNumber(span.innerText) : 0;
    }
    const bookmarkBtn = article.querySelector('[data-testid="bookmark"]');
    if (bookmarkBtn) {
      const span = bookmarkBtn.querySelector('span[data-testid="app-text-transition-container"]');
      metrics.bookmarks = span ? parseNumber(span.innerText) : 0;
    }
    
    let mediaType = 'text';
    if (article.querySelector('[data-testid="tweetPhoto"]')) mediaType = 'image';
    if (article.querySelector('[data-testid="videoPlayer"]')) mediaType = 'video';
    if (article.querySelector('[data-testid="card.wrapper"]')) mediaType = 'link';

    // Extract card text as fallback when tweetText is empty
    if (!text && article.querySelector('[data-testid="card.wrapper"]')) {
      const cardTitle = article.querySelector('[data-testid="card.layoutLarge.detail"] > span, [data-testid="card.layoutSmall.detail"] > span');
      const cardDesc = article.querySelector('[data-testid="card.layoutLarge.detail"] div[role], [data-testid="card.layoutSmall.detail"] div[role]');
      if (cardTitle) text = cardTitle.innerText;
      if (cardDesc) text = (text ? text + ' — ' : '') + cardDesc.innerText;
    }

    // Extract author info (needed for trend/home feed scanning)
    let author = '';
    let author_handle = '';
    // Most reliable: parse handle from the status URL (/username/status/123)
    if (linkEl) {
      const hrefParts = linkEl.getAttribute('href').split('/');
      // href = /username/status/123 → parts = ['', 'username', 'status', '123']
      if (hrefParts.length >= 2 && hrefParts[1]) {
        author_handle = hrefParts[1];
      }
    }
    // Extract display name from User-Name element
    const authorEl = article.querySelector('[data-testid="User-Name"]');
    if (authorEl) {
      // Try: first link's text content (display name)
      const nameLink = authorEl.querySelector('a');
      if (nameLink) {
        const nameText = nameLink.textContent.trim();
        if (nameText && !nameText.startsWith('@')) {
          author = nameText;
        }
      }
      // Fallback: try to find handle from a span/link containing @
      if (!author_handle) {
        const allText = authorEl.textContent;
        const handleMatch = allText.match(/@([a-zA-Z0-9_]+)/);
        if (handleMatch) author_handle = handleMatch[1];
      }
    }

    return {
      timestamp,
      text: text.substring(0, 500),
      likes: metrics.likes,
      retweets: metrics.retweets,
      replies: metrics.replies,
      views: metrics.views,
      bookmarks: metrics.bookmarks,
      media_type: mediaType,
      url,
      author,
      author_handle
    };
  } catch (e) {
    console.error('XRay: Error parsing post', e);
    return null;
  }
}

async function scrollAndCollect(maxPosts = 50) {
  const posts = new Map();
  let noNewPostsCount = 0;
  while (posts.size < maxPosts && noNewPostsCount < 5) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const prevSize = posts.size;
    articles.forEach(article => {
      const data = getPostData(article);
      if (data && data.url && !posts.has(data.url)) {
        posts.set(data.url, data);
      }
    });
    if (posts.size === prevSize) {
      noNewPostsCount++;
    } else {
      noNewPostsCount = 0;
    }
    // Report progress back to popup
    try {
      chrome.runtime.sendMessage({ action: 'progress', current: posts.size, total: maxPosts });
    } catch {}
    window.scrollBy(0, 1000);
    await new Promise(r => setTimeout(r, 800));
  }
  return Array.from(posts.values());
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrape') {
    const maxPosts = request.maxPosts || 50;
    const mediaFilter = request.mediaFilter || 'all';
    scrollAndCollect(maxPosts).then(data => {
      let filtered = data;
      if (mediaFilter !== 'all') {
        filtered = data.filter(p => p.media_type === mediaFilter);
      }
      sendResponse({ data: filtered });
    });
    return true;
  }
});

console.log('XRay: Content script loaded');
