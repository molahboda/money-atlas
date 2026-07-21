/* =====================================================
   MONEY ATLAS — 캔버스 차트 엔진
   연간 시계열 멀티시리즈 차트 (이중축, 로그, 지수화,
   침체 음영, 사건 마커, 드래그 확대, 툴팁)
   ===================================================== */

(function (global) {
  'use strict';

  var FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif';

  function niceTicks(min, max, count) {
    if (min === max) { max = min + 1; }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = (span / count) / step;
    if (err >= 7.5) step *= 10;
    else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;
    var ticks = [];
    var start = Math.ceil(min / step) * step;
    for (var v = start; v <= max + step * 0.001; v += step) {
      ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
    }
    return ticks;
  }

  function logTicks(min, max) {
    var ticks = [];
    var e0 = Math.floor(Math.log10(min));
    var e1 = Math.ceil(Math.log10(max));
    var bases = [1, 2, 5];
    for (var e = e0; e <= e1; e++) {
      for (var b = 0; b < bases.length; b++) {
        var v = bases[b] * Math.pow(10, e);
        if (v >= min * 0.999 && v <= max * 1.001) ticks.push(v);
      }
    }
    if (ticks.length > 8) {
      var filtered = [];
      for (var i = 0; i < ticks.length; i++) {
        var m = ticks[i] / Math.pow(10, Math.floor(Math.log10(ticks[i])));
        if (Math.abs(m - 1) < 0.01 || Math.abs(m - 5) < 0.01) filtered.push(ticks[i]);
      }
      ticks = filtered;
    }
    return ticks;
  }

  function compactNum(v) {
    var a = Math.abs(v);
    if (a >= 100000) return (v / 1000).toFixed(0) + 'k';
    if (a >= 10000) return (v / 1000).toFixed(1) + 'k';
    if (a >= 1000) return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(0);
    if (a >= 1) return v.toFixed(1);
    return v.toFixed(2);
  }

  function fmtValue(key, v) {
    var s = SERIES[key];
    if (v === null || v === undefined) return '—';
    switch (s.fmt) {
      case 'pct': return v.toFixed(1) + '%';
      case 'pct0': return v.toFixed(0) + '%';
      case 'usd': return '$' + (v >= 1000 ? v.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : v < 20 ? v.toFixed(1) : v.toFixed(0));
      case 'krw': return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '원';
      case 'num1': return v.toFixed(1);
      default:
        return v >= 1000 ? v.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : (v >= 100 ? v.toFixed(0) : v.toFixed(1));
    }
  }
  global.fmtValue = fmtValue;

  function MacroChart(canvasId, tipId, opts) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.tip = tipId ? document.getElementById(tipId) : null;
    this.o = Object.assign({
      series: [], range: null, normalize: true, log: true,
      showRecessions: true, showEvents: false, bands: null,
      zeroFill: false, height: 440, onRange: null
    }, opts || {});
    this.hoverYear = null;
    this.hoverEvent = null;
    this.drag = null;
    this._bind();
    this.resize();
  }

  MacroChart.prototype._bind = function () {
    var self = this;
    var wrap = this.canvas.parentElement;
    window.addEventListener('resize', function () { self.resize(); });
    if (window.ResizeObserver) {
      var lastW = 0;
      new ResizeObserver(function () {
        var w = wrap.clientWidth;
        if (w && w !== lastW) { lastW = w; self.resize(); }
      }).observe(wrap);
    }

    wrap.addEventListener('mousemove', function (e) {
      var r = self.canvas.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      if (self.drag) { self.drag.x1 = x; self.draw(); return; }
      self._hover(x, y, e);
    });
    wrap.addEventListener('mouseleave', function () {
      self.hoverYear = null; self.hoverEvent = null; self.drag = null;
      if (self.tip) self.tip.style.display = 'none';
      self.draw();
    });
    wrap.addEventListener('mousedown', function (e) {
      if (!self.o.onRange) return;
      var r = self.canvas.getBoundingClientRect();
      self.drag = { x0: e.clientX - r.left, x1: e.clientX - r.left };
    });
    window.addEventListener('mouseup', function () {
      if (!self.drag) return;
      var d = self.drag; self.drag = null;
      if (Math.abs(d.x1 - d.x0) > 12 && self.o.onRange) {
        var y0 = self._xToYear(Math.min(d.x0, d.x1));
        var y1 = self._xToYear(Math.max(d.x0, d.x1));
        if (y1 - y0 >= 2) { self.o.onRange([y0, y1]); return; }
      }
      self.draw();
    });
    wrap.addEventListener('dblclick', function () {
      if (self.o.onRange) self.o.onRange(null);
    });
  };

  MacroChart.prototype.setState = function (patch) {
    Object.assign(this.o, patch);
    this.hoverYear = null;
    this.hoverEvent = null;
    if (this.tip) this.tip.style.display = 'none';
    this.draw();
  };

  MacroChart.prototype.resize = function () {
    var wrap = this.canvas.parentElement;
    var w = wrap.clientWidth || 600;
    var h = this.o.height;
    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = h;
    this.draw();
  };

  MacroChart.prototype._rangeYears = function () {
    var r = this.o.range;
    var y0 = r ? r[0] : YEAR_START, y1 = r ? r[1] : YEAR_END;
    y0 = Math.max(YEAR_START, Math.min(y0, YEAR_END - 2));
    y1 = Math.min(YEAR_END, Math.max(y1, y0 + 2));
    return [y0, y1];
  };

  MacroChart.prototype._xToYear = function (x) {
    var L = this.L;
    var t = (x - L.padL) / L.plotW;
    t = Math.max(0, Math.min(1, t));
    return Math.round(L.y0 + t * (L.y1 - L.y0));
  };

  MacroChart.prototype.draw = function () {
    var ctx = this.ctx, o = this.o;
    var W = this.W, H = this.H;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);

    var yr = this._rangeYears();
    var y0 = yr[0], y1 = yr[1];

    var priceKeys = [], pctKeys = [];
    o.series.forEach(function (k) {
      if (!SERIES[k]) return;
      (SERIES[k].axis === 'price' ? priceKeys : pctKeys).push(k);
    });

    var padL = 58, padR = pctKeys.length && priceKeys.length ? 52 : 14;
    if (!priceKeys.length) { padL = 52; padR = 14; }
    var padT = o.showEvents ? 30 : 18, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var self = this;

    function xPos(yFrac) { return padL + (yFrac - y0) / (y1 - y0) * plotW; }

    /* --- 데이터 수집 및 도메인 --- */
    var priceData = {}, pMin = Infinity, pMax = -Infinity;
    priceKeys.forEach(function (k) {
      var s = SERIES[k], pts = [], base = null;
      for (var y = Math.max(y0, s.start); y <= y1; y++) {
        var v = seriesVal(k, y);
        if (v === null) continue;
        if (base === null) base = v;
        var val = o.normalize ? v / base * 100 : v;
        pts.push({ y: y, v: val, raw: v });
        if (val < pMin) pMin = val;
        if (val > pMax) pMax = val;
      }
      priceData[k] = pts;
    });
    var useLog = o.log && priceKeys.length && pMin > 0;
    var pDomain = null;
    if (priceKeys.length && pMin < Infinity) {
      if (useLog) {
        var lmin = Math.log10(pMin), lmax = Math.log10(pMax);
        var lpad = (lmax - lmin) * 0.06 || 0.1;
        pDomain = [lmin - lpad, lmax + lpad];
      } else {
        var ppad = (pMax - pMin) * 0.08 || 1;
        pDomain = [pMin - ppad, pMax + ppad];
      }
    }
    function pY(v) {
      var t = useLog ? (Math.log10(v) - pDomain[0]) / (pDomain[1] - pDomain[0])
                     : (v - pDomain[0]) / (pDomain[1] - pDomain[0]);
      return padT + (1 - t) * plotH;
    }

    var pctData = {}, qMin = Infinity, qMax = -Infinity;
    pctKeys.forEach(function (k) {
      var s = SERIES[k], pts = [];
      for (var y = Math.max(y0, s.start); y <= y1; y++) {
        var v = seriesVal(k, y);
        if (v === null) continue;
        pts.push({ y: y, v: v, raw: v });
        if (v < qMin) qMin = v;
        if (v > qMax) qMax = v;
      }
      pctData[k] = pts;
    });
    var qDomain = null;
    if (pctKeys.length && qMin < Infinity) {
      qMin = Math.min(0, qMin); qMax = Math.max(0, qMax);
      var qpad = (qMax - qMin) * 0.08 || 1;
      qDomain = [qMin - (qMin < 0 ? qpad : 0), qMax + qpad];
    }
    function qY(v) {
      var t = (v - qDomain[0]) / (qDomain[1] - qDomain[0]);
      return padT + (1 - t) * plotH;
    }

    this.L = { y0: y0, y1: y1, padL: padL, padT: padT, plotW: plotW, plotH: plotH, priceData: priceData, pctData: pctData };

    /* --- 커스텀 밴드 (달러 사이클 등) --- */
    if (o.bands) {
      o.bands.forEach(function (b) {
        var a = Math.max(b.x0, y0), z = Math.min(b.x1, y1);
        if (z <= a) return;
        ctx.fillStyle = b.type === 'strong' ? 'rgba(240,97,109,0.09)' : 'rgba(96,165,250,0.09)';
        ctx.fillRect(xPos(a), padT, xPos(z) - xPos(a), plotH);
        ctx.save();
        ctx.fillStyle = b.type === 'strong' ? 'rgba(252,165,165,0.85)' : 'rgba(147,197,253,0.85)';
        ctx.font = '10px ' + FONT;
        ctx.textAlign = 'left';
        var label = b.label;
        var bw = xPos(z) - xPos(a);
        if (bw > 70) ctx.fillText(label, xPos(a) + 5, padT + 12);
        ctx.restore();
      });
    }

    /* --- 침체 음영 --- */
    if (o.showRecessions) {
      ctx.fillStyle = 'rgba(148,163,184,0.13)';
      RECESSIONS.forEach(function (r) {
        var a = Math.max(r[0], y0), z = Math.min(r[1], y1 + 0.999);
        if (z <= a) return;
        ctx.fillRect(xPos(a), padT, Math.max(2, xPos(z) - xPos(a)), plotH);
      });
    }

    /* --- 그리드 + 축 --- */
    ctx.font = '10.5px ' + FONT;
    ctx.lineWidth = 1;
    var gridTicks, leftIsPrice = priceKeys.length > 0;
    if (leftIsPrice) {
      gridTicks = useLog ? logTicks(Math.pow(10, pDomain[0]), Math.pow(10, pDomain[1])) : niceTicks(pDomain[0], pDomain[1], 5);
    } else if (qDomain) {
      gridTicks = niceTicks(qDomain[0], qDomain[1], 5);
    } else gridTicks = [];

    gridTicks.forEach(function (t) {
      var yy = leftIsPrice ? pY(t) : qY(t);
      if (yy < padT - 2 || yy > padT + plotH + 2) return;
      ctx.strokeStyle = 'rgba(148,163,184,0.10)';
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
      ctx.fillStyle = 'rgba(139,152,169,0.9)';
      ctx.textAlign = 'right';
      ctx.fillText(leftIsPrice ? compactNum(t) : compactNum(t) + '%', padL - 7, yy + 3.5);
    });

    /* 오른쪽 % 축 */
    if (pctKeys.length && priceKeys.length && qDomain) {
      var rticks = niceTicks(qDomain[0], qDomain[1], 5);
      ctx.textAlign = 'left';
      rticks.forEach(function (t) {
        var yy = qY(t);
        if (yy < padT - 2 || yy > padT + plotH + 2) return;
        ctx.fillStyle = 'rgba(139,152,169,0.75)';
        ctx.fillText(compactNum(t) + '%', padL + plotW + 7, yy + 3.5);
      });
    }

    /* 0선 (% 축) */
    if (qDomain && qDomain[0] < 0) {
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(padL, qY(0)); ctx.lineTo(padL + plotW, qY(0)); ctx.stroke();
      ctx.setLineDash([]);
    }

    /* x축 연도 */
    var span = y1 - y0;
    var step = span <= 10 ? 1 : span <= 20 ? 2 : span <= 40 ? 5 : 10;
    ctx.fillStyle = 'rgba(139,152,169,0.9)';
    ctx.textAlign = 'center';
    for (var y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      ctx.fillText(String(y), xPos(y), H - 8);
      ctx.strokeStyle = 'rgba(148,163,184,0.06)';
      ctx.beginPath(); ctx.moveTo(xPos(y), padT); ctx.lineTo(xPos(y), padT + plotH); ctx.stroke();
    }

    /* --- zeroFill (금리차 차트: 0 밑 빨강 / 위 파랑) --- */
    if (o.zeroFill && pctKeys.length === 1 && qDomain) {
      var k0 = pctKeys[0], pts0 = pctData[k0];
      if (pts0.length > 1) {
        var zy = qY(0);
        ['pos', 'neg'].forEach(function (mode) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(padL, mode === 'pos' ? padT : zy, plotW, mode === 'pos' ? zy - padT : padT + plotH - zy);
          ctx.clip();
          ctx.beginPath();
          ctx.moveTo(xPos(pts0[0].y), zy);
          pts0.forEach(function (p) { ctx.lineTo(xPos(p.y), qY(p.v)); });
          ctx.lineTo(xPos(pts0[pts0.length - 1].y), zy);
          ctx.closePath();
          ctx.fillStyle = mode === 'pos' ? 'rgba(96,165,250,0.16)' : 'rgba(240,97,109,0.22)';
          ctx.fill();
          ctx.restore();
        });
      }
    }

    /* --- 라인 --- */
    function drawLine(pts, color, yFn) {
      if (pts.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.1;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach(function (p, i) {
        var px = xPos(p.y), py = yFn(p.v);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    priceKeys.forEach(function (k) { drawLine(priceData[k], SERIES[k].color, pY); });
    pctKeys.forEach(function (k) { drawLine(pctData[k], SERIES[k].color, qY); });

    /* --- 사건 마커 --- */
    this._eventPts = [];
    if (o.showEvents) {
      var evs = EVENTS.filter(function (e) { return e.y >= y0 && e.y <= y1; });
      var selfEv = this._eventPts;
      evs.forEach(function (e) {
        var px = xPos(e.y);
        selfEv.push({ x: px, e: e });
        var hot = self.hoverEvent === e;
        ctx.fillStyle = hot ? '#fbbf24' : 'rgba(251,191,36,0.55)';
        ctx.beginPath();
        ctx.moveTo(px, 8); ctx.lineTo(px + 4.5, 15.5); ctx.lineTo(px - 4.5, 15.5);
        ctx.closePath(); ctx.fill();
        if (hot) {
          ctx.strokeStyle = 'rgba(251,191,36,0.45)';
          ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(px, 17); ctx.lineTo(px, padT + plotH); ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }

    /* --- 드래그 선택 영역 --- */
    if (this.drag) {
      var dx0 = Math.min(this.drag.x0, this.drag.x1), dx1 = Math.max(this.drag.x0, this.drag.x1);
      ctx.fillStyle = 'rgba(96,165,250,0.14)';
      ctx.fillRect(dx0, padT, dx1 - dx0, plotH);
      ctx.strokeStyle = 'rgba(96,165,250,0.6)';
      ctx.strokeRect(dx0 + 0.5, padT + 0.5, dx1 - dx0 - 1, plotH - 1);
    }

    /* --- 크로스헤어 --- */
    if (this.hoverYear !== null && this.hoverYear >= y0 && this.hoverYear <= y1) {
      var hx = xPos(this.hoverYear);
      ctx.strokeStyle = 'rgba(230,237,243,0.35)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
      var dotFn = function (k, data, yFn) {
        var pt = null;
        for (var i = 0; i < data[k].length; i++) if (data[k][i].y === self.hoverYear) { pt = data[k][i]; break; }
        if (!pt) return;
        ctx.fillStyle = SERIES[k].color;
        ctx.beginPath(); ctx.arc(hx, yFn(pt.v), 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(11,14,20,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
      };
      priceKeys.forEach(function (k) { dotFn(k, priceData, pY); });
      pctKeys.forEach(function (k) { dotFn(k, pctData, qY); });
    }
  };

  MacroChart.prototype._hover = function (x, y, e) {
    var L = this.L;
    if (!L) return;
    /* 사건 마커 우선 */
    this.hoverEvent = null;
    if (this.o.showEvents && y < 22 && this._eventPts) {
      for (var i = 0; i < this._eventPts.length; i++) {
        if (Math.abs(this._eventPts[i].x - x) < 7) { this.hoverEvent = this._eventPts[i].e; break; }
      }
    }
    if (x < L.padL - 6 || x > L.padL + L.plotW + 6) {
      this.hoverYear = null;
      if (this.tip) this.tip.style.display = 'none';
      this.draw(); return;
    }
    this.hoverYear = this._xToYear(x);
    this.draw();
    this._showTip(x, y);
  };

  MacroChart.prototype._showTip = function (x, y) {
    if (!this.tip) return;
    var yr = this.hoverYear;
    var o = this.o;
    var html = '';
    if (this.hoverEvent) {
      html += '<div class="tip-event">◆ ' + this.hoverEvent.y + ' · ' + this.hoverEvent.t + '</div>';
    }
    var era = eraNameFor(yr);
    html += '<div class="tip-head">' + yr + (era ? ' <span>· ' + era + '</span>' : '') + '</div>';
    var self = this;
    o.series.forEach(function (k) {
      var s = SERIES[k]; if (!s) return;
      var v = seriesVal(k, yr);
      if (v === null) return;
      var extra = '';
      if (s.axis === 'price' && o.normalize) {
        var data = self.L.priceData[k];
        if (data && data.length) {
          for (var i = 0; i < data.length; i++) {
            if (data[i].y === yr) { extra = ' <em>(지수 ' + data[i].v.toFixed(0) + ')</em>'; break; }
          }
        }
      }
      html += '<div class="tip-row"><i style="background:' + s.color + '"></i>' + s.label +
        ' <b>' + fmtValue(k, v) + '</b>' + extra + '</div>';
    });
    var ev = null;
    if (!this.hoverEvent) {
      for (var i = 0; i < EVENTS.length; i++) if (EVENTS[i].y === yr) { ev = EVENTS[i]; break; }
      if (ev && o.showEvents) html += '<div class="tip-event small">◆ ' + ev.t + '</div>';
    }
    this.tip.innerHTML = html;
    this.tip.style.display = 'block';
    var wrapW = this.canvas.parentElement.clientWidth;
    var tw = this.tip.offsetWidth;
    var left = x + 16;
    if (left + tw > wrapW - 6) left = x - tw - 16;
    if (left < 4) left = 4;
    this.tip.style.left = left + 'px';
    this.tip.style.top = Math.max(6, Math.min(y + 14, this.o.height - this.tip.offsetHeight - 8)) + 'px';
  };

  global.MacroChart = MacroChart;
})(window);
