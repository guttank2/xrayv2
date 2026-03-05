// XRay Trends — client-side trend analysis for home feed / explore / search scans
// Sorts by VELOCITY (eng/hour), extracts n-gram keywords, clusters by topic

const XRayTrends = (() => {

  const STOPWORDS = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
    'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
    'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
    'people', 'into', 'year', 'your', 'some', 'them', 'than', 'then', 'now',
    'its', 'also', 'after', 'how', 'our', 'well', 'way', 'even', 'new',
    'want', 'because', 'any', 'these', 'give', 'most', 'us', 'are', 'is',
    'was', 'been', 'has', 'had', 'did', 'got', 'were', 'could', 'should',
    'more', 'very', 'much', 'too', 'really', 'thing', 'things', 'don', 'doesn',
    'didn', 'won', 'isn', 'aren', 'wasn', 'weren', 'here', 'still', 'only',
    'let', 'see', 'going', 'being', 'over', 'need', 'think', 'amp', 'https',
    'http', 'www', 'com', 'every', 'first', 'right', 'back', 'been', 'before',
    'other', 'never', 'down', 'day', 'days', 'good', 'look', 'where', 'come',
    'made', 'many', 'long', 'said', 'each', 'tell', 'does', 'set', 'put'
  ]);

  function rawEngagement(post) {
    return (post.likes || 0) + (post.retweets || 0) + (post.replies || 0);
  }

  // ===== VELOCITY =====
  // Engagement per hour since posted. Higher = blowing up RIGHT NOW.
  function calcVelocity(post, scanTime) {
    const eng = rawEngagement(post);
    if (!post.timestamp) return { velocity: eng, ageHours: 0, ageLabel: 'unknown' };

    const postTime = new Date(post.timestamp).getTime();
    const now = scanTime || Date.now();
    const ageMs = Math.max(now - postTime, 60000); // Min 1 minute
    const ageHours = ageMs / 3600000;

    // Velocity = engagement / hours (floored at 0.1h to avoid infinity for very new posts)
    const velocity = eng / Math.max(ageHours, 0.1);

    // Human-readable age
    let ageLabel;
    const mins = Math.floor(ageMs / 60000);
    if (mins < 60) ageLabel = mins + 'm';
    else if (ageHours < 24) ageLabel = Math.floor(ageHours) + 'h';
    else ageLabel = Math.floor(ageHours / 24) + 'd';

    return { velocity: Math.round(velocity), ageHours, ageLabel };
  }

  // ===== N-GRAM KEYWORDS =====
  // Extracts both single words AND 2-word phrases, scored by frequency

  function cleanWords(text) {
    return text.toLowerCase()
      .split(/[\s,.!?;:()\[\]{}"']+/)
      .filter(w => w.length >= 3 && !/^https?/.test(w) && !/^\d+$/.test(w));
  }

  function extractKeywords(posts) {
    const unigramFreq = {};
    const bigramFreq = {};

    posts.forEach(post => {
      const text = (post.text || '').toLowerCase();
      const words = cleanWords(text);
      const filtered = words.filter(w => !STOPWORDS.has(w));

      // Unigrams — dedupe per post
      const uniqueWords = new Set(filtered);
      uniqueWords.forEach(w => {
        unigramFreq[w] = (unigramFreq[w] || 0) + 1;
      });

      // Bigrams — consecutive pairs (use all words for context, filter stopword-only pairs)
      const uniqueBigrams = new Set();
      for (let i = 0; i < words.length - 1; i++) {
        const w1 = words[i];
        const w2 = words[i + 1];
        // At least one word must not be a stopword
        if (STOPWORDS.has(w1) && STOPWORDS.has(w2)) continue;
        const bigram = w1 + ' ' + w2;
        uniqueBigrams.add(bigram);
      }
      uniqueBigrams.forEach(bg => {
        bigramFreq[bg] = (bigramFreq[bg] || 0) + 1;
      });
    });

    // Merge: bigrams that appear 2+ times get priority, then unigrams
    const results = [];

    // Bigrams first (more specific = more useful)
    Object.entries(bigramFreq)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([phrase, count]) => {
        results.push({ word: phrase, count, type: 'phrase' });
      });

    // Unigrams that aren't already covered by a bigram
    const bigramWords = new Set();
    results.forEach(r => r.word.split(' ').forEach(w => bigramWords.add(w)));

    Object.entries(unigramFreq)
      .filter(([word, count]) => count >= 2 && !bigramWords.has(word))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([word, count]) => {
        results.push({ word, count, type: 'word' });
      });

    // Sort all by count
    results.sort((a, b) => b.count - a.count);
    return results;
  }

  // ===== CLUSTERING =====

  function clusterByKeywords(posts, keywords) {
    if (keywords.length === 0) return [];

    const topKeywords = keywords.slice(0, 10);
    const clusters = [];

    topKeywords.forEach(kw => {
      const matching = posts.filter(p =>
        (p.text || '').toLowerCase().includes(kw.word)
      );
      if (matching.length >= 2) {
        clusters.push({
          keyword: kw.word,
          keywordType: kw.type,
          count: matching.length,
          posts: matching.slice(0, 5),
          avgEngagement: Math.round(
            matching.reduce((s, p) => s + rawEngagement(p), 0) / matching.length
          ),
          avgVelocity: Math.round(
            matching.reduce((s, p) => s + (p._velocity || 0), 0) / matching.length
          )
        });
      }
    });

    // Sort clusters by average velocity (what's hot now), not just engagement
    clusters.sort((a, b) => b.avgVelocity - a.avgVelocity);
    return clusters;
  }

  function extractHook(text) {
    if (!text) return '';
    const firstLine = text.split('\n')[0].trim();
    if (firstLine.length > 0 && firstLine.length <= 200) return firstLine;
    return firstLine.substring(0, 200) + '...';
  }

  // ===== MAIN =====

  function processTrends(posts) {
    const scanTime = Date.now();

    // 1. Compute velocity for each post
    const enriched = posts.map(p => {
      const vel = calcVelocity(p, scanTime);
      return { ...p, _velocity: vel.velocity, _ageHours: vel.ageHours, _ageLabel: vel.ageLabel };
    });

    // 2. Sort by velocity (what's blowing up NOW), not raw engagement
    const sorted = [...enriched].sort((a, b) => b._velocity - a._velocity);

    // 3. Also keep an engagement-sorted list for reference
    const engSorted = [...enriched].sort((a, b) => rawEngagement(b) - rawEngagement(a));

    // 4. Top posts = highest velocity
    const topN = sorted.slice(0, 20);

    // 5. Extract keywords from top posts (velocity-sorted)
    const keywords = extractKeywords(topN);

    // 6. Cluster all posts by keywords
    const clusters = clusterByKeywords(sorted, keywords);

    // 7. Extract trending hooks
    const trendingHooks = topN.map(p => ({
      hook: extractHook(p.text),
      engagement: rawEngagement(p),
      velocity: p._velocity,
      ageLabel: p._ageLabel,
      likes: p.likes || 0,
      retweets: p.retweets || 0,
      replies: p.replies || 0,
      author: p.author || '',
      author_handle: p.author_handle || 'unknown',
      media_type: p.media_type || 'text',
      url: p.url || ''
    }));

    // 8. Media type breakdown of top posts
    const mediaBreakdown = {};
    topN.forEach(p => {
      const mt = p.media_type || 'text';
      mediaBreakdown[mt] = (mediaBreakdown[mt] || 0) + 1;
    });

    // 9. Top authors
    const authorCounts = {};
    sorted.forEach(p => {
      const handle = p.author_handle || 'unknown';
      if (handle !== 'unknown') {
        if (!authorCounts[handle]) authorCounts[handle] = { count: 0, totalEng: 0, totalVel: 0, name: p.author || handle };
        authorCounts[handle].count++;
        authorCounts[handle].totalEng += rawEngagement(p);
        authorCounts[handle].totalVel += p._velocity;
      }
    });
    const topAuthors = Object.entries(authorCounts)
      .map(([handle, data]) => ({
        handle,
        ...data,
        avgEng: Math.round(data.totalEng / data.count),
        avgVel: Math.round(data.totalVel / data.count)
      }))
      .sort((a, b) => b.totalVel - a.totalVel) // Sort by velocity, not just total
      .slice(0, 10);

    const maxEng = engSorted[0] ? rawEngagement(engSorted[0]) : 0;
    const maxVelocity = sorted[0] ? sorted[0]._velocity : 0;

    // Clean internal fields before storing (keep ageLabel, velocity)
    const cleanPosts = sorted.map(p => {
      const { _velocity, _ageHours, _ageLabel, ...rest } = p;
      return { ...rest, velocity: _velocity, ageLabel: _ageLabel, ageHours: _ageHours };
    });

    const cleanTopPosts = topN.map(p => {
      const { _velocity, _ageHours, _ageLabel, ...rest } = p;
      return { ...rest, velocity: _velocity, ageLabel: _ageLabel, ageHours: _ageHours };
    });

    return {
      sorted: cleanPosts,
      topPosts: cleanTopPosts,
      keywords: keywords.slice(0, 15),
      clusters,
      trendingHooks,
      mediaBreakdown,
      topAuthors,
      totalScanned: posts.length,
      maxEngagement: maxEng,
      maxVelocity
    };
  }

  return { processTrends, rawEngagement, calcVelocity, extractKeywords, clusterByKeywords };

})();
