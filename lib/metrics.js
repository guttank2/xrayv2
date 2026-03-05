// XRay Metrics — shared computation module
// Statistical scoring with z-score normalization, Wilson intervals, significance tests

const XRayMetrics = (() => {

  // ===== PRIMITIVES =====

  function parseNum(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      v = v.toLowerCase().replace(/,/g, '');
      if (v.includes('k')) return parseFloat(v) * 1000;
      if (v.includes('m')) return parseFloat(v) * 1000000;
      return parseInt(v) || 0;
    }
    return 0;
  }

  function r2(v) { return Math.round(v * 100) / 100; }

  // ===== STATISTICAL PRIMITIVES =====

  function calcMean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  function calcStdDev(arr) {
    if (arr.length < 2) return 0;
    const mean = calcMean(arr);
    const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  }

  function zScore(value, mean, stdDev) {
    if (stdDev < 0.001) return 0;
    return (value - mean) / stdDev;
  }

  function confidenceInterval(arr, confidence) {
    if (!confidence) confidence = 0.95;
    if (arr.length < 2) return { mean: calcMean(arr), lower: calcMean(arr), upper: calcMean(arr), margin: 0 };
    const z = confidence === 0.95 ? 1.96 : confidence === 0.99 ? 2.576 : 1.96;
    const mean = calcMean(arr);
    const stdDev = calcStdDev(arr);
    const margin = z * (stdDev / Math.sqrt(arr.length));
    return { mean: r2(mean), lower: r2(mean - margin), upper: r2(mean + margin), margin: r2(margin) };
  }

  function coefficientOfVariation(arr) {
    const mean = calcMean(arr);
    if (Math.abs(mean) < 0.001) return 0;
    return r2((calcStdDev(arr) / Math.abs(mean)) * 100);
  }

  // ===== WILSON SCORE INTERVAL =====

  function wilsonLowerBound(successes, total) {
    if (total === 0) return 0;
    const z = 1.96; // 95% confidence
    const p = successes / total;
    const n = total;
    const denominator = 1 + (z * z) / n;
    const centre = p + (z * z) / (2 * n);
    const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return Math.max(0, (centre - spread) / denominator);
  }

  // ===== EFFECT SIZE =====

  function cohensD(group1, group2) {
    if (group1.length < 2 || group2.length < 2) return { d: 0, interpretation: 'insufficient data' };
    const mean1 = calcMean(group1);
    const mean2 = calcMean(group2);
    const sd1 = calcStdDev(group1);
    const sd2 = calcStdDev(group2);
    const pooledStd = Math.sqrt((sd1 * sd1 + sd2 * sd2) / 2);
    if (pooledStd < 0.001) return { d: 0, interpretation: 'no variance' };
    const d = Math.abs(mean1 - mean2) / pooledStd;
    let interpretation;
    if (d < 0.2) interpretation = 'negligible';
    else if (d < 0.5) interpretation = 'small';
    else if (d < 0.8) interpretation = 'medium';
    else interpretation = 'large';
    return { d: r2(d), interpretation };
  }

  // ===== CHI-SQUARED TEST =====

  function chiSquaredTest(observed, expected) {
    // observed and expected are arrays of counts
    if (observed.length !== expected.length || observed.length < 2) {
      return { chi2: 0, df: 0, significant: false, pApprox: 1 };
    }
    let chi2 = 0;
    for (let i = 0; i < observed.length; i++) {
      if (expected[i] > 0) {
        chi2 += ((observed[i] - expected[i]) ** 2) / expected[i];
      }
    }
    const df = observed.length - 1;
    // Approximate p-value using chi-squared survival function
    // Using Wilson-Hilferty approximation for chi-squared CDF
    const pApprox = chi2SurvivalApprox(chi2, df);
    return { chi2: r2(chi2), df, significant: pApprox < 0.05, pApprox: r2(pApprox) };
  }

  function chi2SurvivalApprox(x, df) {
    // Wilson-Hilferty approximation: transform chi2 to approximately normal
    if (df <= 0 || x <= 0) return 1;
    const z = Math.pow(x / df, 1/3) - (1 - 2 / (9 * df));
    const se = Math.sqrt(2 / (9 * df));
    const zNorm = z / se;
    // Standard normal survival: Φ(-z) ≈ using logistic approximation
    return 1 / (1 + Math.exp(1.7 * zNorm));
  }

  // ===== RAW METRIC CALCULATORS =====

  function rawMetrics(post) {
    const likes = Math.max(parseNum(post.likes), 1);
    const rt = parseNum(post.retweets);
    const rp = parseNum(post.replies);
    const views = Math.max(parseNum(post.views), 1);
    const bm = parseNum(post.bookmarks);
    const engagement = likes + rt + rp;

    const er = (engagement / views) * 100;
    const sr = (bm / views) * 100;
    const vir = rt / likes;
    const replyRate = rp / Math.max(likes + rt, 1);
    const wilson = wilsonLowerBound(engagement, views) * 100; // as %

    return {
      likes, rt, rp, views, bm, engagement,
      er: r2(er),
      sr: r2(sr),
      vir: r2(vir),
      replyRate: r2(replyRate),
      wilson_er: r2(wilson)
    };
  }

  // ===== CLASSIFICATION FUNCTIONS =====

  function calcDensity(text) {
    if (!text || text.trim().length === 0) return { density: 0, density_class: 'sparse' };
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    if (wordCount === 0) return { density: 0, density_class: 'sparse' };
    let entities = 0;
    words.forEach(w => {
      if (/^@/.test(w)) entities++;
      else if (/^#/.test(w)) entities++;
      else if (/https?:\/\//.test(w)) entities++;
      else if (/\d+[%$kKmM]|\$\d/.test(w)) entities++;
      else if (/^\d+[.,]?\d*$/.test(w)) entities++;
      else if (/^[A-Z][a-z]/.test(w) && w.length > 2) entities += 0.5;
    });
    const colons = (text.match(/:/g) || []).length;
    const brackets = (text.match(/[\[\]()]/g) || []).length;
    entities += (colons + brackets) * 0.3;
    const density = Math.round((entities / wordCount) * 100) / 100;
    const density_class = density < 0.15 ? 'sparse' : density < 0.35 ? 'medium' : 'dense';
    return { density, density_class };
  }

  function extractHook(text) {
    if (!text) return '';
    const firstLine = text.split('\n')[0].trim();
    if (firstLine.length > 0 && firstLine.length <= 200) return firstLine;
    const sentenceMatch = text.match(/^(.+?[.!?])\s/);
    if (sentenceMatch && sentenceMatch[1].length <= 200) return sentenceMatch[1];
    if (!firstLine || firstLine.length === 0) return text.substring(0, 200);
    const truncated = firstLine.substring(0, 200);
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > 50 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
  }

  function classifyHook(hook) {
    if (!hook) return 'unknown';
    if (hook.includes('?')) return 'question';
    if (/^\d+[.)]/.test(hook) || /^[-\u2022]/.test(hook)) return 'list';
    if (/^(how|why|what|when|where|who)\b/i.test(hook)) return 'how-to';
    if (/\d+[%xX]|\$\d|\d+k|\d+m/i.test(hook)) return 'statistic';
    if (/^(stop|don'?t|never|the worst|the biggest)/i.test(hook)) return 'negative-frame';
    if (/^(i |my |we )/i.test(hook)) return 'personal-story';
    return 'statement';
  }

  function classifyLength(text) {
    if (!text) return 'empty';
    const len = text.length;
    if (len < 80) return 'short';
    if (len < 180) return 'medium';
    if (len < 280) return 'full';
    return 'thread';
  }

  // ===== MAIN PROCESSING =====

  function assignTiers(posts) {
    const sorted = [...posts].sort((a, b) => b.metrics.composite_score - a.metrics.composite_score);
    const total = sorted.length;
    const topCut = Math.max(3, Math.ceil(total * 0.4));
    const midCut = Math.max(topCut + 1, Math.ceil(total * 0.75));
    sorted.forEach((p, i) => {
      if (i < topCut) p.tier = 'top';
      else if (i < midCut) p.tier = 'middle';
      else p.tier = 'bottom';
    });
    return sorted;
  }

  function avgMetric(arr, key) {
    return arr.length > 0 ? r2(arr.reduce((s, p) => s + (p.metrics[key] || 0), 0) / arr.length) : 0;
  }

  function groupBy(arr, fn) {
    const groups = {};
    arr.forEach(p => {
      const key = fn(p);
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    return groups;
  }

  function breakdownStats(groups, total) {
    const result = {};
    Object.entries(groups).forEach(([key, posts]) => {
      const scores = posts.map(p => p.metrics.composite_score);
      const ci = confidenceInterval(scores);
      result[key] = {
        count: posts.length,
        pct: r2(posts.length / total * 100),
        avg_er: avgMetric(posts, 'engagement_rate'),
        avg_score: ci.mean,
        score_ci: [ci.lower, ci.upper]
      };
    });
    return result;
  }

  function processScan(rawPosts) {
    if (rawPosts.length === 0) return { posts: [], summary: { totalPosts: 0 } };

    // Phase 1: compute raw metrics + classifications for each post
    const enriched = rawPosts.map(p => {
      const rm = rawMetrics(p);
      const hook = extractHook(p.text || '');
      const { density, density_class } = calcDensity(p.text || '');
      return {
        ...p,
        hook,
        hook_type: classifyHook(hook),
        length_class: classifyLength(p.text),
        info_density: density,
        density_class,
        _raw: rm, // temp, used for z-score
        metrics: {
          engagement_rate: rm.er,
          wilson_er: rm.wilson_er,
          save_rate: rm.sr,
          virality: rm.vir,
          reply_rate: rm.replyRate,
          composite_score: 0 // computed in phase 2
        }
      };
    });

    // Phase 2: z-score normalization across batch
    const wilsonArr = enriched.map(p => p._raw.wilson_er);
    const virArr = enriched.map(p => p._raw.vir);
    const replyArr = enriched.map(p => p._raw.replyRate);

    const wilsonMean = calcMean(wilsonArr);
    const wilsonSD = calcStdDev(wilsonArr);
    const virMean = calcMean(virArr);
    const virSD = calcStdDev(virArr);
    const replyMean = calcMean(replyArr);
    const replySD = calcStdDev(replyArr);

    enriched.forEach(p => {
      const rm = p._raw;
      const zWilson = zScore(rm.wilson_er, wilsonMean, wilsonSD);
      const zVir = zScore(rm.vir, virMean, virSD);
      const zReply = zScore(rm.replyRate, replyMean, replySD);
      const logBonus = Math.log10(Math.max(rm.engagement, 10));
      const saveBonus = rm.bm > 0 ? (rm.sr * 2) : 0;

      const score = (zWilson * 1) + (zVir * 3) + (zReply * 2) + logBonus + saveBonus;
      p.metrics.composite_score = r2(score);
      p.metrics.z_wilson = r2(zWilson);
      p.metrics.z_virality = r2(zVir);
      p.metrics.z_reply = r2(zReply);
      delete p._raw;
    });

    // Phase 3: tier assignment
    const sorted = assignTiers(enriched);
    const total = sorted.length;
    const topPosts = sorted.filter(p => p.tier === 'top');
    const midPosts = sorted.filter(p => p.tier === 'middle');
    const bottomPosts = sorted.filter(p => p.tier === 'bottom');

    // Phase 4: statistical tests
    const topScores = topPosts.map(p => p.metrics.composite_score);
    const bottomScores = bottomPosts.map(p => p.metrics.composite_score);
    const allScores = sorted.map(p => p.metrics.composite_score);

    const effectSize = cohensD(topScores, bottomScores);
    const scoreCV = coefficientOfVariation(allScores);
    const scoreCIAll = confidenceInterval(allScores);

    // Chi-squared test for hook types in top tier
    const hookTypes = [...new Set(sorted.map(p => p.hook_type))];
    const topHookObserved = hookTypes.map(ht => topPosts.filter(p => p.hook_type === ht).length);
    const topHookExpected = hookTypes.map(ht => {
      const totalOfType = sorted.filter(p => p.hook_type === ht).length;
      return (totalOfType / total) * topPosts.length;
    });
    const hookTypeSignificance = chiSquaredTest(topHookObserved, topHookExpected);
    hookTypeSignificance.types = hookTypes;

    // Phase 5: breakdowns with confidence intervals
    const hookGroups = groupBy(sorted, p => p.hook_type);
    const mediaGroups = groupBy(sorted, p => p.media_type || 'text');
    const lengthGroups = groupBy(sorted, p => p.length_class);
    const densityGroups = groupBy(sorted, p => p.density_class);

    const hook_type_breakdown = breakdownStats(hookGroups, total);
    const media_breakdown = breakdownStats(mediaGroups, total);
    const length_breakdown = breakdownStats(lengthGroups, total);
    const density_breakdown = {};
    Object.entries(densityGroups).forEach(([dc, posts]) => {
      const scores = posts.map(p => p.metrics.composite_score);
      const ci = confidenceInterval(scores);
      density_breakdown[dc] = {
        count: posts.length,
        pct: r2(posts.length / total * 100),
        avg_density: r2(posts.reduce((s, p) => s + (p.info_density || 0), 0) / posts.length),
        avg_er: avgMetric(posts, 'engagement_rate'),
        avg_score: ci.mean,
        score_ci: [ci.lower, ci.upper]
      };
    });

    const summary = {
      totalPosts: total,
      avgScore: scoreCIAll.mean,
      avgScoreCI: [scoreCIAll.lower, scoreCIAll.upper],
      avgER: avgMetric(sorted, 'engagement_rate'),
      scoreCV,
      scoreCVInterpretation: scoreCV > 80 ? 'high variance — tier boundaries may be unreliable' :
                              scoreCV > 40 ? 'moderate variance — tiers are reasonable' :
                              'low variance — scores are tightly clustered',
      effectSize,
      hookTypeSignificance,
      tierBreakdown: {
        top: topPosts.length,
        middle: midPosts.length,
        bottom: bottomPosts.length
      },
      hookTypeBreakdown: hook_type_breakdown,
      mediaBreakdown: media_breakdown,
      lengthBreakdown: length_breakdown,
      densityBreakdown: density_breakdown
    };

    return { posts: sorted, summary };
  }

  return {
    parseNum, r2,
    calcMean, calcStdDev, zScore,
    confidenceInterval, coefficientOfVariation,
    wilsonLowerBound, cohensD, chiSquaredTest,
    rawMetrics, calcDensity, extractHook, classifyHook, classifyLength,
    assignTiers, processScan
  };

})();
