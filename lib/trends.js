// XRay Trends — client-side trend analysis for home feed / explore / search scans
// Sorts by VELOCITY (eng/hour), extracts TOPICS (not just keywords), clusters by theme

const XRayTrends = (() => {

  // ===== STOPWORDS =====
  // Comprehensive list: function words + common verbs + adjectives + adverbs + filler
  // Goal: only let through NOUNS and NOUN PHRASES that represent actual topics
  const STOPWORDS = new Set([
    // Function words (determiners, pronouns, prepositions, conjunctions)
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
    'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
    'when', 'make', 'can', 'like', 'no', 'just', 'him', 'know', 'take',
    'into', 'your', 'some', 'them', 'than', 'then', 'now',
    'its', 'also', 'after', 'how', 'our', 'way', 'even',
    'want', 'because', 'any', 'these', 'give', 'most', 'us', 'are', 'is',
    'was', 'been', 'has', 'had', 'did', 'got', 'were', 'could', 'should',
    'more', 'very', 'much', 'too', 'really', 'don', 'doesn',
    'didn', 'won', 'isn', 'aren', 'wasn', 'weren', 'here', 'still', 'only',
    'let', 'see', 'being', 'over', 'need', 'think', 'amp', 'https',
    'http', 'www', 'com', 'every', 'right', 'back', 'before',
    'other', 'never', 'down', 'where', 'come',
    'made', 'many', 'long', 'said', 'each', 'tell', 'does', 'set', 'put',
    // Common verbs (not topics — "introducing" something ≠ topic)
    'introducing', 'makes', 'making', 'used', 'using', 'getting', 'going',
    'looking', 'working', 'trying', 'coming', 'starting', 'running', 'taking',
    'giving', 'putting', 'keeping', 'finding', 'showing', 'building', 'creating',
    'adding', 'changing', 'moving', 'playing', 'turning', 'calling', 'paying',
    'leaving', 'reading', 'writing', 'learning', 'spending', 'winning', 'losing',
    'breaking', 'holding', 'opening', 'closing', 'following', 'sending', 'posting',
    'sharing', 'talking', 'thinking', 'feeling', 'waiting', 'watching', 'living',
    'doing', 'saying', 'bringing', 'buying', 'selling', 'helping', 'asking',
    'telling', 'becoming', 'sitting', 'standing', 'happening', 'meaning',
    'stop', 'start', 'keep', 'end', 'use', 'try', 'run', 'help',
    'believe', 'understand', 'remember', 'imagine', 'realize', 'happen',
    // Common adjectives & adverbs (not topics — "most advanced" ≠ topic)
    'same', 'advanced', 'new', 'old', 'big', 'small', 'great', 'best', 'worst',
    'first', 'last', 'next', 'real', 'true', 'full', 'whole', 'different',
    'important', 'possible', 'available', 'special', 'certain', 'clear', 'likely',
    'hard', 'easy', 'fast', 'slow', 'high', 'low', 'better', 'worse',
    'able', 'sure', 'ready', 'free', 'open', 'close', 'wrong', 'bad', 'nice',
    'pretty', 'little', 'few', 'less', 'least', 'enough', 'else',
    // Temporal & filler (not topics)
    'today', 'yesterday', 'tomorrow', 'always', 'already', 'actually',
    'basically', 'literally', 'honestly', 'seriously', 'apparently',
    'definitely', 'probably', 'maybe', 'perhaps', 'simply', 'finally',
    'almost', 'exactly', 'absolutely', 'completely', 'totally',
    'just', 'really', 'quite', 'rather', 'ever', 'yet', 'soon', 'ago',
    'time', 'thing', 'things', 'people', 'year', 'years', 'day', 'days',
    'week', 'weeks', 'month', 'months', 'life', 'lot', 'world',
    'good', 'well', 'look', 'feel', 'point', 'part', 'case', 'fact'
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

  // ===== TOPIC EXTRACTION =====
  // Per-post approach: extract ONE primary topic from EACH viral post
  // Then merge duplicates. No minimum count — a topic from 1 viral post is valuable.

  function cleanWords(text) {
    return text.toLowerCase()
      .split(/[\s,.!?;:()\[\]{}"'…–—]+/)
      .filter(w => w.length >= 3 && !/^https?/.test(w) && !/^\d+$/.test(w) && !/^@/.test(w));
  }

  // Extract the SINGLE best topic label from a post's text
  // Priority: hashtag > named entity > noun phrase from hook
  function extractPostTopic(text) {
    if (!text) return null;

    // 1. First hashtag = explicit topic signal
    const hashtags = text.match(/#[a-zA-Z]\w{1,30}/g);
    if (hashtags && hashtags.length > 0) {
      return { label: hashtags[0], type: 'hashtag' };
    }

    // 2. Named entities — consecutive capitalized words (skip sentence starts)
    // Look for 2+ capitalized words in a row: "Google Workspace", "Arsenal", etc.
    const entityRegex = /(?:\s|^)([A-Z][a-zA-Z']{2,}(?:\s+(?:of|the|and|for|in|on)\s+)?[A-Z][a-zA-Z']{2,}(?:\s+[A-Z][a-zA-Z']{2,})*)/g;
    let match;
    while ((match = entityRegex.exec(text)) !== null) {
      const entity = match[1].trim();
      if (entity.length >= 4 && entity.length <= 50) {
        const words = entity.toLowerCase().split(/\s+/);
        if (!words.every(w => STOPWORDS.has(w))) {
          return { label: entity, type: 'entity' };
        }
      }
    }

    // 3. Single capitalized word that's not a sentence start (proper noun)
    // Check words AFTER the first word of text
    const afterFirst = text.replace(/^[^\s]+\s+/, ''); // skip first word
    const properNoun = afterFirst.match(/\b([A-Z][a-z]{2,})\b/);
    if (properNoun) {
      const word = properNoun[1];
      if (!STOPWORDS.has(word.toLowerCase()) && word.length >= 3) {
        return { label: word, type: 'entity' };
      }
    }

    // 4. Best noun phrase from the hook (first line)
    const hook = (text.split('\n')[0] || '').trim();
    const words = cleanWords(hook);
    const content = words.filter(w => !STOPWORDS.has(w));

    // Try to find a 2-word content phrase
    for (let i = 0; i < words.length - 1; i++) {
      if (!STOPWORDS.has(words[i]) && !STOPWORDS.has(words[i + 1])) {
        return { label: words[i] + ' ' + words[i + 1], type: 'phrase' };
      }
    }

    // 5. Fallback: first content word from hook
    if (content.length > 0) {
      return { label: content[0], type: 'keyword' };
    }

    return null;
  }

  function extractTopics(posts) {
    const topicMap = new Map(); // normalized key → { label, type, count, totalEng, totalVel, topVel }

    posts.forEach(post => {
      const text = post.text || '';
      const eng = rawEngagement(post);
      const vel = post._velocity || 0;

      const topic = extractPostTopic(text);
      if (!topic) return;

      const key = topic.label.toLowerCase().replace(/^#/, '');

      if (topicMap.has(key)) {
        const t = topicMap.get(key);
        t.count++;
        t.totalEng += eng;
        t.totalVel += vel;
        if (vel > t.topVel) t.topVel = vel;
        // Keep best label (prefer original casing)
        if (/[A-Z]/.test(topic.label) && !/[A-Z]/.test(t.label)) t.label = topic.label;
      } else {
        topicMap.set(key, {
          label: topic.label,
          type: topic.type,
          count: 1,
          totalEng: eng,
          totalVel: vel,
          topVel: vel
        });
      }
    });

    // Score and rank — velocity is king, count is a bonus
    const results = [...topicMap.values()]
      .map(t => ({
        word: t.label,
        count: t.count,
        type: t.type,
        avgEng: Math.round(t.totalEng / t.count),
        avgVel: Math.round(t.totalVel / t.count),
        topVel: t.topVel,
        score: Math.round(t.topVel * (1 + Math.log2(t.count)))
      }))
      .sort((a, b) => b.score - a.score);

    // Deduplicate: skip topics whose words are covered by higher-ranked ones
    const covered = new Set();
    const deduped = [];
    results.forEach(t => {
      const key = t.word.toLowerCase().replace(/^#/, '');
      const words = key.split(/\s+/);
      // Skip if ALL words are already covered
      if (words.length > 0 && words.every(w => covered.has(w))) return;
      deduped.push(t);
      words.forEach(w => covered.add(w));
    });

    return deduped.slice(0, 12);
  }

  // Backward compatibility wrapper
  function extractKeywords(posts) {
    return extractTopics(posts);
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

  return { processTrends, rawEngagement, calcVelocity, extractTopics, extractKeywords, clusterByKeywords };

})();
