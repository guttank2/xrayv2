// XRay Charts — Canvas-based B&W chart renderer
// No dependencies. Monospace aesthetic.

const XRayCharts = (() => {

  const FONT = '10px "SF Mono", "Fira Code", "Consolas", monospace';
  const PAD = { top: 24, right: 16, bottom: 32, left: 48 };

  function setupCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.font = FONT;
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    return { ctx, w, h, plotW: w - PAD.left - PAD.right, plotH: h - PAD.top - PAD.bottom };
  }

  function drawAxes(c) {
    c.ctx.beginPath();
    c.ctx.moveTo(PAD.left, PAD.top);
    c.ctx.lineTo(PAD.left, c.h - PAD.bottom);
    c.ctx.lineTo(c.w - PAD.right, c.h - PAD.bottom);
    c.ctx.stroke();
  }

  function drawXLabel(c, x, text) {
    c.ctx.fillStyle = '#888';
    c.ctx.textAlign = 'center';
    c.ctx.fillText(text, x, c.h - PAD.bottom + 14);
    c.ctx.fillStyle = '#000';
  }

  function drawYLabel(c, y, text) {
    c.ctx.fillStyle = '#888';
    c.ctx.textAlign = 'right';
    c.ctx.fillText(text, PAD.left - 6, y + 3);
    c.ctx.fillStyle = '#000';
  }

  function drawTitle(c, text) {
    c.ctx.fillStyle = '#888';
    c.ctx.textAlign = 'left';
    c.ctx.font = '10px ' + FONT.split(',').slice(0).join(',');
    c.ctx.fillText(text, PAD.left, 12);
    c.ctx.fillStyle = '#000';
    c.ctx.font = FONT;
  }

  function drawDashedLine(c, x1, y1, x2, y2) {
    c.ctx.setLineDash([3, 3]);
    c.ctx.strokeStyle = '#888';
    c.ctx.beginPath();
    c.ctx.moveTo(x1, y1);
    c.ctx.lineTo(x2, y2);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
    c.ctx.strokeStyle = '#000';
  }

  // ===== HISTOGRAM =====
  function drawHistogram(canvas, scores, tierBoundaries) {
    if (scores.length === 0) return;
    const c = setupCanvas(canvas);

    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min || 1;
    const binCount = Math.min(Math.max(Math.ceil(Math.sqrt(scores.length)), 5), 20);
    const binWidth = range / binCount;

    const bins = new Array(binCount).fill(0);
    scores.forEach(s => {
      let idx = Math.floor((s - min) / binWidth);
      if (idx >= binCount) idx = binCount - 1;
      bins[idx]++;
    });

    const maxBin = Math.max(...bins);
    const barW = c.plotW / binCount;

    drawAxes(c);
    drawTitle(c, 'SCORE DISTRIBUTION');

    // Y ticks
    for (let i = 0; i <= 4; i++) {
      const val = Math.round(maxBin * i / 4);
      const y = c.h - PAD.bottom - (i / 4) * c.plotH;
      drawYLabel(c, y, String(val));
      if (i > 0) drawDashedLine(c, PAD.left, y, c.w - PAD.right, y);
    }

    // Bars
    bins.forEach((count, i) => {
      const x = PAD.left + i * barW;
      const barH = maxBin > 0 ? (count / maxBin) * c.plotH : 0;
      const y = c.h - PAD.bottom - barH;

      c.ctx.fillStyle = '#000';
      c.ctx.fillRect(x + 1, y, barW - 2, barH);

      // X label for every few bins
      if (i % Math.max(1, Math.floor(binCount / 5)) === 0) {
        drawXLabel(c, x + barW / 2, (min + i * binWidth).toFixed(1));
      }
    });

    // Tier boundaries as dashed lines
    if (tierBoundaries) {
      tierBoundaries.forEach(bound => {
        const x = PAD.left + ((bound - min) / range) * c.plotW;
        if (x > PAD.left && x < c.w - PAD.right) {
          drawDashedLine(c, x, PAD.top, x, c.h - PAD.bottom);
        }
      });
    }
  }

  // ===== SCATTER PLOT =====
  function drawScatter(canvas, posts) {
    if (posts.length === 0) return;
    const c = setupCanvas(canvas);

    const views = posts.map(p => Math.max(XRayMetrics.parseNum(p.views), 1));
    const ers = posts.map(p => p.metrics.engagement_rate);
    const logViews = views.map(v => Math.log10(v));

    const xMin = Math.min(...logViews);
    const xMax = Math.max(...logViews);
    const yMin = 0;
    const yMax = Math.max(...ers) * 1.1 || 1;
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    drawAxes(c);
    drawTitle(c, 'ER% vs VIEWS (log scale)');

    // X ticks
    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
      const logVal = xMin + (i / xTicks) * xRange;
      const x = PAD.left + (i / xTicks) * c.plotW;
      const realVal = Math.pow(10, logVal);
      let label;
      if (realVal >= 1000000) label = (realVal / 1000000).toFixed(0) + 'M';
      else if (realVal >= 1000) label = (realVal / 1000).toFixed(0) + 'K';
      else label = Math.round(realVal).toString();
      drawXLabel(c, x, label);
    }

    // Y ticks
    for (let i = 0; i <= 4; i++) {
      const val = yMin + (i / 4) * yRange;
      const y = c.h - PAD.bottom - (i / 4) * c.plotH;
      drawYLabel(c, y, val.toFixed(1) + '%');
      if (i > 0) drawDashedLine(c, PAD.left, y, c.w - PAD.right, y);
    }

    // Wilson curve
    c.ctx.strokeStyle = '#ccc';
    c.ctx.lineWidth = 1;
    c.ctx.beginPath();
    for (let i = 0; i <= 50; i++) {
      const lv = xMin + (i / 50) * xRange;
      const v = Math.pow(10, lv);
      const wilsonER = XRayMetrics.wilsonLowerBound(v * 0.03, v) * 100; // approx 3% ER curve
      const px = PAD.left + ((lv - xMin) / xRange) * c.plotW;
      const py = c.h - PAD.bottom - ((wilsonER - yMin) / yRange) * c.plotH;
      if (i === 0) c.ctx.moveTo(px, py);
      else c.ctx.lineTo(px, py);
    }
    c.ctx.stroke();
    c.ctx.strokeStyle = '#000';

    // Plot points
    posts.forEach((p, idx) => {
      const lv = logViews[idx];
      const er = ers[idx];
      const px = PAD.left + ((lv - xMin) / xRange) * c.plotW;
      const py = c.h - PAD.bottom - ((er - yMin) / yRange) * c.plotH;

      c.ctx.beginPath();
      c.ctx.arc(px, py, 3, 0, Math.PI * 2);
      if (p.tier === 'top') {
        c.ctx.fillStyle = '#000';
        c.ctx.fill();
      } else if (p.tier === 'middle') {
        c.ctx.fillStyle = '#888';
        c.ctx.fill();
      } else {
        c.ctx.fillStyle = '#fff';
        c.ctx.fill();
        c.ctx.stroke();
      }
    });
    c.ctx.fillStyle = '#000';
  }

  // ===== BOX PLOT =====
  function boxPlotStats(arr) {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const n = sorted.length;
    const q1 = sorted[Math.floor(n * 0.25)];
    const median = sorted[Math.floor(n * 0.5)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const whiskerLow = Math.max(sorted[0], q1 - 1.5 * iqr);
    const whiskerHigh = Math.min(sorted[n - 1], q3 + 1.5 * iqr);
    const outliers = sorted.filter(v => v < whiskerLow || v > whiskerHigh);
    return { q1, median, q3, whiskerLow, whiskerHigh, outliers, min: sorted[0], max: sorted[n - 1] };
  }

  function drawBoxPlot(canvas, tierData, effectSize) {
    // tierData: { top: [...scores], middle: [...], bottom: [...] }
    const c = setupCanvas(canvas);
    const tiers = ['top', 'middle', 'bottom'];
    const stats = {};
    let globalMin = Infinity, globalMax = -Infinity;

    tiers.forEach(t => {
      const arr = tierData[t] || [];
      if (arr.length > 0) {
        stats[t] = boxPlotStats(arr);
        globalMin = Math.min(globalMin, stats[t].min);
        globalMax = Math.max(globalMax, stats[t].max);
      }
    });

    if (globalMin === Infinity) return;
    const range = globalMax - globalMin || 1;
    globalMin -= range * 0.05;
    globalMax += range * 0.05;
    const totalRange = globalMax - globalMin;

    drawAxes(c);
    drawTitle(c, 'TIER COMPARISON');

    // Y ticks
    for (let i = 0; i <= 4; i++) {
      const val = globalMin + (i / 4) * totalRange;
      const y = c.h - PAD.bottom - (i / 4) * c.plotH;
      drawYLabel(c, y, val.toFixed(1));
      if (i > 0) drawDashedLine(c, PAD.left, y, c.w - PAD.right, y);
    }

    const boxW = c.plotW / 5;
    const positions = { top: 1, middle: 2.5, bottom: 4 };

    tiers.forEach(t => {
      const s = stats[t];
      if (!s) return;
      const cx = PAD.left + (positions[t] / 5) * c.plotW;
      const toY = v => c.h - PAD.bottom - ((v - globalMin) / totalRange) * c.plotH;

      // Whiskers
      c.ctx.beginPath();
      c.ctx.moveTo(cx, toY(s.whiskerLow));
      c.ctx.lineTo(cx, toY(s.whiskerHigh));
      c.ctx.stroke();

      // Whisker caps
      c.ctx.beginPath();
      c.ctx.moveTo(cx - boxW / 4, toY(s.whiskerLow));
      c.ctx.lineTo(cx + boxW / 4, toY(s.whiskerLow));
      c.ctx.moveTo(cx - boxW / 4, toY(s.whiskerHigh));
      c.ctx.lineTo(cx + boxW / 4, toY(s.whiskerHigh));
      c.ctx.stroke();

      // Box
      const boxTop = toY(s.q3);
      const boxBot = toY(s.q1);
      c.ctx.fillStyle = t === 'top' ? '#e5e5e5' : t === 'middle' ? '#f5f5f5' : '#fff';
      c.ctx.fillRect(cx - boxW / 2, boxTop, boxW, boxBot - boxTop);
      c.ctx.strokeRect(cx - boxW / 2, boxTop, boxW, boxBot - boxTop);

      // Median
      c.ctx.lineWidth = 2;
      c.ctx.beginPath();
      c.ctx.moveTo(cx - boxW / 2, toY(s.median));
      c.ctx.lineTo(cx + boxW / 2, toY(s.median));
      c.ctx.stroke();
      c.ctx.lineWidth = 1;

      // Outliers
      s.outliers.forEach(v => {
        c.ctx.beginPath();
        c.ctx.arc(cx, toY(v), 2, 0, Math.PI * 2);
        c.ctx.stroke();
      });

      // Label
      c.ctx.fillStyle = '#000';
      c.ctx.textAlign = 'center';
      c.ctx.fillText(t.toUpperCase(), cx, c.h - PAD.bottom + 14);
    });

    // Effect size annotation
    if (effectSize && effectSize.d > 0) {
      c.ctx.fillStyle = '#888';
      c.ctx.textAlign = 'center';
      c.ctx.fillText('d=' + effectSize.d + ' (' + effectSize.interpretation + ')',
        PAD.left + c.plotW / 2, PAD.top + 14);
    }
    c.ctx.fillStyle = '#000';
  }

  return { drawHistogram, drawScatter, drawBoxPlot, boxPlotStats };

})();
