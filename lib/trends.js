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
  // Semantic approach: hashtags → named entities → noun phrases → keywords
  // Scored by engagement-weighted frequency, not just raw count

  function cleanWords(text) {
    return text.toLowerCase()
      .split(/[\s,.!?;:()\[\]{}"']+/)
      .filter(w => w.length >= 3 && !/^https?/.test(w) && !/^\d+$/.test(w) && !/^@/.test(w));
  }

  function upsertTopic(map, key, label, topicType, eng, vel) {
    if (map.has(key)) {
      const t = map.get(key);
      t.count++;
      t.totalEng += eng;
      t.totalVel += vel;
      // Keep the most "presentable" label (prefer original casing)
      if (topicType === 'entity' && /[A-Z]/.test(label)) t.label = label;
    } else {
      map.set(key, { word: key, label, count: 1, totalEng: eng, totalVel: vel, topicType });
    }
  }

  function extractTopics(posts) {
    const topics = new Map();

    posts.forEach(post => {
      const text = post.text || '';
      const eng = rawEngagement(post);
      const vel = post._velocity || 0;
      const seenInPost = new Set(); // dedupe per post

      // === 1. HASHTAGS — always a topic ===
      const hashtags = text.match(/#[a-zA-Z]\w{1,30}/g) || [];
      hashtags.forEach(tag => {
        const key = tag.toLowerCase();
        if (!seenInPost.has(key)) {
          seenInPost.add(key);
          upsertTopic(topics, key, tag, 'hashtag', eng, vel);
        }
      });

      // === 2. NAMED ENTITIES — consecutive capitalized words ===
      // Matches: "White House", "Elon Musk", "United States", "Apple Vision Pro"
      const entityRegex = /(?:^|[.!?\n]\s*)(?:[A-Z][a-zA-Z']+(?:\s+(?:of|the|and|for|in|on|de|van|von)\s+)?)+[A-Z][a-zA-Z']+/gm;
      const entityMatches = text.match(entityRegex) || [];
      entityMatches.forEach(raw => {
        const entity = raw.replace(/^[.!?\n\s]+/, '').trim();
        if (entity.length < 4 || entity.length > 60) return;
        const key = entity.toLowerCase();
        // Skip if it's just common words that happen to start a sentence
        const words = key.split(/\s+/);
        if (words.every(w => STOPWORDS.has(w))) return;
        if (!seenInPost.has(key)) {
          seenInPost.add(key);
          upsertTopic(topics, key, entity, 'entity', eng, vel);
        }
      });

      // === 3. MEANINGFUL PHRASES (bigrams where BOTH words are content words) ===
      const words = cleanWords(text);
      const contentWords = words.filter(w => !STOPWORDS.has(w));
      const uniquePhrases = new Set();
      for (let i = 0; i < words.length - 1; i++) {
        const w1 = words[i];
        const w2 = words[i + 1];
        // BOTH words must be content words (not stopwords) — much stricter
        if (STOPWORDS.has(w1) || STOPWORDS.has(w2)) continue;
        const phrase = w1 + ' ' + w2;
        if (!seenInPost.has(phrase)) {
          uniquePhrases.add(phrase);
          seenInPost.add(phrase);
        }
      }
      uniquePhrases.forEach(phrase => {
        upsertTopic(topics, phrase, phrase, 'phrase', eng, vel);
      });

      // === 4. SINGLE CONTENT WORDS (nouns only — after all filtering) ===
      const uniqueContent = new Set(contentWords);
      uniqueContent.forEach(w => {
        if (!seenInPost.has(w)) {
          seenInPost.add(w);
          upsertTopic(topics, w, w, 'keyword', eng, vel);
        }
      });
    });

    // === SCORING ===
    // score = count × log10(avgVelocity + 1) — balances frequency and virality
    // Hashtags and entities get a boost (they're more likely to be real topics)
    const TYPE_BOOST = { hashtag: 3, entity: 2, phrase: 1.5, keyword: 1 };

    const results = [...topics.values()]
      .filter(t => t.count >= 2)
      .map(t => {
        const avgVel = t.totalVel / t.count;
        const boost = TYPE_BOOST[t.topicType] || 1;
        return {
          word: t.label || t.word,
          count: t.count,
          type: t.topicType,
          avgEng: Math.round(t.totalEng / t.count),
          avgVel: Math.round(avgVel),
          score: Math.round(t.count * Math.log10(avgVel + 1) * boost * 100) / 100
        };
      })
      .sort((a, b) => b.score - a.score);

    // Deduplicate: if a single word is already covered by a phrase/entity, skip it
    const covered = new Set();
    const deduped = [];
    results.forEach(t => {
      if (t.type === 'keyword') {
        // Skip if this word is part of a higher-ranked phrase/entity/hashtag
        if (covered.has(t.word)) return;
      }
      deduped.push(t);
      // Mark component words as covered
      t.word.toLowerCase().replace(/^#/, '').split(/\s+/).forEach(w => covered.add(w));
    });

    return deduped.slice(0, 15);
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
