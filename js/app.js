/* =====================================================
   MONEY ATLAS — 앱 로직
   ===================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  /* ==================== 0. 실시간 데이터 적용 ==================== */
  var DATA_ASOF = null;   // ISO 문자열 (실시간 갱신 시각)
  var LIVE_DAILY = {};    // 당일 변동 (가격: %, 금리: %p)
  var LIVE_NEWS = [];     // 실시간 뉴스 목록

  var LIVE_NEWS_AT = null;

  function applyLive() {
    var L = window.LIVE_DATA;
    if (!L) return;
    LIVE_DAILY = L.daily || {};
    LIVE_NEWS = (L.news || []).filter(function (n) { return n && n.t; });
    LIVE_NEWS_AT = L.newsAt || L.fetchedAt || null;
    if (!L.quotes) return;
    var quotesAt = L.quotesAt || L.fetchedAt;
    var liveYear = parseInt(String(quotesAt || '').slice(0, 4), 10);
    if (!liveYear || liveYear < YEAR_END) { DATA_ASOF = quotesAt; return; }
    if (liveYear > YEAR_END) {
      for (var k in SERIES) SERIES[k].vals.push(null);
      YEAR_END = liveYear;
    }
    var q = L.quotes;
    for (var key in q) {
      var s = SERIES[key];
      if (!s || typeof q[key] !== 'number' || !isFinite(q[key])) continue;
      s.vals[YEAR_END - s.start] = q[key];
      s.live = true;
    }
    var a = seriesVal('us10y', YEAR_END), b = seriesVal('us2y', YEAR_END);
    if (a !== null && b !== null) {
      SERIES.spread.vals[YEAR_END - SERIES.spread.start] = Math.round((a - b) * 100) / 100;
      SERIES.spread.live = true;
    }
    DATA_ASOF = quotesAt;
  }
  applyLive();

  function fmtAsof(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* 마지막(최신) 값·직전 값 헬퍼 — null 건너뜀 */
  function lastVal(key) {
    var s = SERIES[key];
    if (!s) return null;
    for (var i = s.vals.length - 1; i >= 0; i--) {
      if (s.vals[i] !== null && s.vals[i] !== undefined) return { v: s.vals[i], year: s.start + i, idx: i };
    }
    return null;
  }
  function prevVal(key, beforeIdx) {
    var s = SERIES[key];
    for (var i = beforeIdx - 1; i >= 0; i--) {
      if (s.vals[i] !== null && s.vals[i] !== undefined) return { v: s.vals[i], year: s.start + i, idx: i };
    }
    return null;
  }
  function latest(key) { var l = lastVal(key); return l ? l.v : null; }
  function latestDelta(key) {
    var l = lastVal(key); if (!l) return null;
    var p = prevVal(key, l.idx); if (!p) return null;
    return l.v - p.v;
  }

  /* ==================== 0.5 실시간 티커 + 뉴스 브리핑 ==================== */
  function dailyOf(key) {
    if (!(key in LIVE_DAILY)) return null;
    var s = SERIES[key];
    var v = LIVE_DAILY[key];
    var isPct = s && s.axis === 'pct';
    return { v: v, txt: (v >= 0 ? '▲' : '▼') + Math.abs(v).toFixed(isPct ? 2 : 1) + (isPct ? '%p' : '%'), up: v >= 0, flat: Math.abs(v) < (isPct ? 0.005 : 0.005) };
  }
  function ytdOf(key) {
    var lv = lastVal(key); if (!lv) return null;
    var pv = prevVal(key, lv.idx); if (!pv) return null;
    var s = SERIES[key];
    var d = s.axis === 'pct' ? lv.v - pv.v : (lv.v / pv.v - 1) * 100;
    return { v: d, txt: (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + (s.axis === 'pct' ? '%p' : '%'), up: d >= 0, baseYear: pv.year };
  }

  var TICKER_KEYS = ['spx', 'kospi', 'nikkei', 'krw', 'gold', 'wti', 'dxy', 'vix', 'us10y', 'us2y', 'fed'];

  function buildTicker() {
    var bar = $('tickerBar');
    if (!bar) return;
    var hasLive = false;
    for (var k in LIVE_DAILY) { hasLive = true; break; }
    if (!DATA_ASOF && !hasLive) { bar.style.display = 'none'; return; }
    var html = '';
    TICKER_KEYS.forEach(function (k) {
      var s = SERIES[k]; if (!s || !s.live) return;
      var lv = lastVal(k); if (!lv) return;
      var dd = dailyOf(k);
      var chunk = '<span class="tk-item"><b>' + s.short + '</b> ' + fmtValue(k, lv.v);
      if (dd) chunk += ' <em class="' + (dd.up ? 'up' : 'down') + '">' + dd.txt + '</em>';
      else {
        var yt = ytdOf(k);
        if (yt) chunk += ' <em class="' + (yt.up ? 'up' : 'down') + '">' + yt.txt + ' <i>(' + yt.baseYear + '말比)</i></em>';
      }
      chunk += '</span>';
      html += chunk;
    });
    if (!html) { bar.style.display = 'none'; return; }
    $('tickerTrack').innerHTML = html + html; /* 무한 루프용 복제 */
  }

  function relTime(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return '방금';
    if (m < 60) return m + '분 전';
    var h = Math.round(m / 60);
    if (h < 24) return h + '시간 전';
    return Math.round(h / 24) + '일 전';
  }

  function classifyNews(title) {
    var hits = [];
    for (var i = 0; i < NEWS_RULES.length; i++) {
      if (NEWS_RULES[i].re.test(title)) hits.push(NEWS_RULES[i]);
      if (hits.length >= 2) break;
    }
    return hits.length ? hits : [NEWS_FALLBACK];
  }

  function reactionTable(keys) {
    var rows = '';
    keys.forEach(function (k) {
      var s = SERIES[k]; if (!s) return;
      var lv = lastVal(k); if (!lv) return;
      var dd = dailyOf(k);
      var yt = ytdOf(k);
      rows += '<tr><td><i class="dot" style="background:' + s.color + '"></i>' + s.short + '</td>' +
        '<td>' + fmtValue(k, lv.v) + (s.live ? ' <em class="live-badge">LIVE</em>' : '') + '</td>' +
        '<td class="' + (dd ? (dd.up ? 'up' : 'down') : 'muted') + '">' + (dd ? dd.txt : '—') + '</td>' +
        '<td class="' + (yt ? (yt.up ? 'up' : 'down') : 'muted') + '">' + (yt ? yt.txt : '—') + '</td></tr>';
    });
    return '<table class="react-table"><tr><th>지표</th><th>현재</th><th>오늘</th><th>전년말比</th></tr>' + rows + '</table>';
  }

  function buildNews() {
    var list = $('newsList');
    var asof = $('newsAsof');
    if (!list) return;
    if (!LIVE_NEWS.length) {
      asof.textContent = '실시간 뉴스는 사이트 실행 시 자동 수집됩니다 (serve.py / 프리뷰 시작 시 갱신)';
      list.innerHTML = '<div class="panel muted" style="font-size:13.5px">아직 수집된 뉴스가 없습니다. ' +
        '<code>python3 money-atlas/update_live.py</code> 를 실행하거나 서버를 재시작하면 최신 헤드라인이 표시됩니다.</div>';
      return;
    }
    asof.textContent = '수집: ' + fmtAsof(LIVE_NEWS_AT) + ' · 구글 뉴스(주요 언론사) · 항목을 누르면 작용 경로와 실제 반응이 열립니다';
    list.innerHTML = '';
    LIVE_NEWS.forEach(function (n, idx) {
      var rules = classifyNews(n.t);
      var main = rules[0];
      var item = el('div', 'news-item' + (idx === 0 ? ' open' : ''));
      var chips = rules.map(function (r) { return '<span class="news-chip nc-' + r.key + '">' + r.name + '</span>'; }).join('');
      var row = el('button', 'news-row',
        '<span class="news-meta">' + esc(relTime(n.d)) + (n.s ? ' · ' + esc(n.s) : '') + '</span>' +
        chips +
        '<span class="news-title">' + esc(n.t) + '</span>' +
        '<span class="news-caret">▾</span>');
      row.onclick = function () { item.classList.toggle('open'); };
      item.appendChild(row);

      var detail = el('div', 'news-detail');
      detail.innerHTML =
        '<div class="nd-grid">' +
        '<div class="nd-block"><h5>① 이렇게 작용할 수 있다</h5><p>' + main.chain + '</p></div>' +
        '<div class="nd-block"><h5>② 역사에선 실제로</h5><ul>' + main.hist.map(function (h) { return '<li>' + h + '</li>'; }).join('') + '</ul></div>' +
        '<div class="nd-block"><h5>③ 오늘 시장의 실제 반응</h5>' + reactionTable(main.watch) + '</div>' +
        '</div>' +
        '<div class="nd-caveat"><b>주의</b> ' + main.caveat + '</div>';
      if (n.u && /^https?:\/\//.test(n.u)) {
        var a = document.createElement('a');
        a.className = 'news-link';
        a.textContent = '원문 보기 →';
        a.setAttribute('href', n.u);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        detail.appendChild(a);
      }
      item.appendChild(detail);
      list.appendChild(item);
    });
  }

  /* ==================== 1. 현재 스냅샷 ==================== */
  var SNAPSHOT_KEYS = ['fed', 'bok', 'us10y', 'spread', 'cpi', 'spx', 'kospi', 'nikkei', 'krw', 'dxy', 'gold', 'wti', 'vix', 'buffett'];

  function percentile(key) {
    var s = SERIES[key];
    var vals = s.vals.filter(function (v) { return v !== null && v !== undefined; });
    var cur = vals[vals.length - 1];
    var below = 0;
    for (var i = 0; i < vals.length; i++) if (vals[i] <= cur) below++;
    return Math.round(below / vals.length * 100);
  }

  function buildSnapshot() {
    var grid = $('snapshotGrid');
    SNAPSHOT_KEYS.forEach(function (k) {
      var s = SERIES[k];
      var lv = lastVal(k); if (!lv) return;
      var pv = prevVal(k, lv.idx); if (!pv) return;
      var isPct = s.axis === 'pct';
      var diff = isPct ? (lv.v - pv.v) : (lv.v / pv.v - 1) * 100;
      var up = diff >= 0.005;
      var flat = Math.abs(diff) < 0.005;
      var diffTxt = flat ? '보합' : (up ? '▲' : '▼') + ' ' + Math.abs(diff).toFixed(1) + (isPct ? '%p' : '%');
      var pct = percentile(k);
      var card = el('div', 'snap-card');
      card.innerHTML =
        '<div class="snap-name"><i style="background:' + s.color + '"></i>' + s.label +
        (s.live ? '<em class="live-badge">LIVE</em>' : '') + '</div>' +
        '<div class="snap-val">' + fmtValue(k, lv.v) + '</div>' +
        '<div class="snap-diff ' + (flat ? 'flat' : up ? 'up' : 'down') + '">' + diffTxt + ' <span>(' + pv.year + '말 대비)</span></div>' +
        '<div class="snap-track"><span class="snap-marker" style="left:' + pct + '%"></span></div>' +
        '<div class="snap-pct">역사적 백분위 <b>' + pct + '%</b></div>';
      grid.appendChild(card);
    });
    var cap = $('snapCaption');
    if (cap) {
      cap.textContent = DATA_ASOF
        ? '실시간 갱신: ' + fmtAsof(DATA_ASOF) + ' (LIVE 표시 지표) · 나머지는 내장 근사치 · 막대는 1970년 이후 역사 범위 내 위치'
        : '2025년 말 기준 근사치 · 막대는 1970년 이후 역사 범위 내 위치';
    }
  }

  /* ==================== 1.5 나침반 — 현 위치 진단 ==================== */
  function diagnose() {
    var cpi = latest('cpi'), dCpi = latestDelta('cpi');
    var fed = latest('fed'), dFed = latestDelta('fed');
    var spread = latest('spread');
    var buf = latest('buffett'), bufPct = percentile('buffett');
    var vix = latest('vix');
    var spxL = lastVal('spx');
    var spxP = spxL ? prevVal('spx', spxL.idx) : null;
    var spxYoY = (spxL && spxP) ? (spxL.v / spxP.v - 1) * 100 : null;
    var dxyL = lastVal('dxy');
    var dxyP = dxyL ? prevVal('dxy', dxyL.idx) : null;
    var dxyYoY = (dxyL && dxyP) ? Math.log(dxyL.v / dxyP.v) * 100 : 0;
    var dxy3 = dxyL ? seriesVal('dxy', dxyL.year - 3) : null;
    var dxyChg3 = (dxyL && dxy3) ? (dxyL.v / dxy3 - 1) * 100 : null;

    var inflState = cpi < 2 ? '낮음' : cpi < 3.5 ? '안정' : cpi < 5 ? '부담' : '고물가';
    var inflDir = dCpi === null ? '—' : dCpi <= -0.3 ? '하락' : dCpi >= 0.3 ? '상승' : '횡보';
    var gScore = ((spxYoY !== null && spxYoY > 0) ? 1 : 0) +
                 ((spread !== null && spread > 0) ? 1 : 0) +
                 ((vix !== null && vix < 20) ? 1 : 0);
    var growthState = gScore >= 2 ? '확장 우세' : gScore === 1 ? '혼조' : '수축 신호';

    var quadrant;
    if (growthState !== '수축 신호') {
      quadrant = ((inflState === '부담' || inflState === '고물가') && inflDir !== '하락') ? 'overheat' : 'recovery';
    } else {
      quadrant = (inflState === '부담' || inflState === '고물가') ? 'stagflation' : 'reflation';
    }

    var recent = [];
    var fv = SERIES.fed.vals;
    for (var i = Math.max(0, fv.length - 6); i < fv.length; i++) {
      if (fv[i] !== null && fv[i] !== undefined) recent.push(fv[i]);
    }
    var fedPeak = Math.max.apply(null, recent);
    var stageKey, stageName;
    if (fed < 2 && Math.abs(dFed || 0) < 0.5) { stageKey = 'low'; stageName = '④ 저금리기'; }
    else if (dFed !== null && dFed > 0.25) { stageKey = 'hike'; stageName = '① 인상기'; }
    else if (fedPeak - fed >= 0.75 && dFed !== null && dFed < 0.1) { stageKey = 'cut'; stageName = '③ 인하기'; }
    else { stageKey = 'plateau'; stageName = '② 고원기 (동결)'; }
    var cutType = growthState === '수축 신호' ? '침체형' : '보험성';

    var spreadState = spread === null ? '—' : spread < 0 ? '역전 중' : spread < 1 ? '재가팔음 (역전 해소 구간)' : '정상';
    var wasInverted = false;
    for (var y = YEAR_END - 3; y <= YEAR_END; y++) {
      var sv = seriesVal('spread', y);
      if (sv !== null && sv < 0) wasInverted = true;
    }

    var dollarState = dxyChg3 === null ? '—' : dxyChg3 < -3 ? '약세 사이클 진행' : dxyChg3 > 3 ? '강세 사이클 진행' : '방향 탐색';
    var valState = bufPct >= 90 ? '역사적 극단 (과열)' : bufPct >= 70 ? '고평가 부담' : bufPct >= 30 ? '중립' : '저평가';

    return {
      cpi: cpi, dCpi: dCpi, fed: fed, dFed: dFed, fedPeak: fedPeak, spread: spread,
      buf: buf, bufPct: bufPct, vix: vix, spxYoY: spxYoY, dxyYoY: dxyYoY, dxyChg3: dxyChg3,
      inflState: inflState, inflDir: inflDir, growthState: growthState, gScore: gScore,
      quadrant: quadrant, stageKey: stageKey, stageName: stageName, cutType: cutType,
      spreadState: spreadState, wasInverted: wasInverted, dollarState: dollarState, valState: valState
    };
  }

  function analogYears(d) {
    function featAt(y) {
      var c = seriesVal('cpi', y), c0 = seriesVal('cpi', y - 1);
      var f = seriesVal('fed', y), f0 = seriesVal('fed', y - 1);
      var s = seriesVal('spread', y);
      var b = seriesVal('buffett', y);
      var p1 = seriesVal('spx', y), p0 = seriesVal('spx', y - 1);
      var x1 = seriesVal('dxy', y), x0 = seriesVal('dxy', y - 1);
      var all = [c, c0, f, f0, s, b, p1, p0, x1, x0];
      for (var i = 0; i < all.length; i++) if (all[i] === null) return null;
      return [c, c - c0, f, f - f0, s, b, Math.log(p1 / p0) * 100, Math.log(x1 / x0) * 100];
    }
    var cands = [];
    for (var y = 1977; y <= YEAR_END - 2; y++) {
      var v = featAt(y);
      if (v) cands.push({ y: y, v: v });
    }
    if (cands.length < 10) return [];
    var cur = [
      d.cpi, d.dCpi === null ? 0 : d.dCpi,
      d.fed, d.dFed === null ? 0 : d.dFed,
      d.spread, d.buf,
      d.spxYoY === null ? 0 : Math.log(1 + d.spxYoY / 100) * 100,
      d.dxyYoY
    ];
    var dim = cur.length, n = cands.length;
    var mean = [], sd = [];
    for (var j = 0; j < dim; j++) {
      var m = 0;
      for (var i = 0; i < n; i++) m += cands[i].v[j];
      m /= n;
      var s2 = 0;
      for (i = 0; i < n; i++) s2 += Math.pow(cands[i].v[j] - m, 2);
      mean[j] = m;
      sd[j] = Math.sqrt(s2 / n) || 1;
    }
    function zdist(vec) {
      var d2 = 0;
      for (var j = 0; j < dim; j++) {
        d2 += Math.pow((vec[j] - mean[j]) / sd[j] - (cur[j] - mean[j]) / sd[j], 2);
      }
      return Math.sqrt(d2);
    }
    var scored = cands.map(function (c) { return { y: c.y, d: zdist(c.v) }; })
      .sort(function (a, b) { return a.d - b.d; }).slice(0, 3);
    return scored.map(function (s) {
      function ret(key) {
        var a = seriesVal(key, s.y), b = seriesVal(key, s.y + 1);
        return (a !== null && b !== null) ? (b / a - 1) * 100 : null;
      }
      var y10a = seriesVal('us10y', s.y), y10b = seriesVal('us10y', s.y + 1);
      return {
        year: s.y, sim: Math.round(100 * Math.exp(-s.d / 3)), era: eraNameFor(s.y),
        nextSpx: ret('spx'), nextGold: ret('gold'), nextKospi: ret('kospi'),
        nextY10: (y10a !== null && y10b !== null) ? y10b - y10a : null
      };
    });
  }

  function pctTxt(v, digits) {
    if (v === null) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(digits === undefined ? 0 : digits) + '%';
  }

  function buildCompass() {
    var d = diagnose();
    var quad = PLAYBOOKS[d.quadrant];

    $('compassAsof').textContent = (DATA_ASOF
      ? '데이터 기준: ' + fmtAsof(DATA_ASOF) + ' (실시간)'
      : '데이터 기준: 2025년 말 근사치') +
      ' · 규칙 기반 자동 판정 — 데이터가 갱신되면 판정도 함께 바뀝니다';

    /* --- 5개 다이얼 --- */
    var stageIdx = { hike: 0, plateau: 1, cut: 2, low: 3 }[d.stageKey];
    var dials = [
      {
        title: '투자시계 국면', value: quad.name, color: quad.color,
        basis: 'CPI ' + d.cpi.toFixed(1) + '% (' + d.inflDir + ') · 성장 프록시 ' + d.gScore + '/3 (' + d.growthState + ')',
        note: quad.intro,
        rule: '판정 규칙: 물가 수준·방향 × 성장 프록시(주가 추세 · 금리차 · VIX)'
      },
      {
        title: '금리 사이클', value: d.stageName + (d.stageKey === 'cut' ? ' · ' + d.cutType : ''), color: '#f97316',
        basis: '기준금리 ' + d.fed.toFixed(1) + '% · 전년 대비 ' + (d.dFed === null ? '—' : (d.dFed >= 0 ? '+' : '') + d.dFed.toFixed(1) + '%p') + ' · 직전 고점 ' + d.fedPeak.toFixed(1) + '%',
        note: RATE_CYCLE[stageIdx].note,
        rule: '판정 규칙: 최근 6년 고점 대비 레벨과 방향'
      },
      {
        title: '장단기 금리차', value: d.spreadState, color: '#7dd3fc',
        basis: '10Y − 2Y = ' + (d.spread === null ? '—' : (d.spread >= 0 ? '+' : '') + d.spread.toFixed(2) + '%p'),
        note: d.spreadState.indexOf('재가팔음') >= 0
          ? '주의 구간 — 1990·2001·2008년 침체는 모두 역전 "해소 직후"에 시작됐습니다. 다만 2022~25년 역전은 침체 없이 지나가고 있는 역사적 예외입니다.'
          : d.spreadState === '역전 중'
            ? '역사적으로 6~22개월 뒤 침체가 따라온 신호였습니다 (패턴 01).'
            : '정상 기울기 — 은행 마진과 신용 창출에 우호적인 환경입니다.',
        rule: '판정 규칙: 음수=역전, 0~1%p=재가팔음, 1%p 이상=정상'
      },
      {
        title: '달러 사이클', value: d.dollarState, color: '#cbd5e1',
        basis: 'DXY 3년 변화 ' + pctTxt(d.dxyChg3, 1),
        note: d.dollarState === '약세 사이클 진행'
          ? '역사적으로 약달러기는 원자재·신흥국·비달러 자산의 상대 강세기였습니다 (1985–95, 2002–11).'
          : d.dollarState === '강세 사이클 진행'
            ? '강달러 후반부는 신흥국 위기의 계절이었습니다 (1982, 1997, 2015).'
            : '7~10년 사이클의 변곡 구간 — 방향 확인이 필요합니다.',
        rule: '판정 규칙: DXY 3년 변화율 ±3% 기준'
      },
      {
        title: '밸류에이션 온도', value: d.valState, color: '#f59e0b',
        basis: '버핏지수 ' + d.buf.toFixed(0) + '% · 역사 백분위 ' + d.bufPct + '%',
        note: d.bufPct >= 90
          ? '1999년(143%) · 2021년(202%)을 넘는 수준 — 역사적으로 이 구간 이후 10년 기대수익은 낮았습니다 (패턴 07). 단기 타이밍 도구는 아닙니다.'
          : '역사 분포상 ' + d.valState + ' 영역입니다. 밸류에이션은 장기 기대수익의 온도계입니다 (패턴 07).',
        rule: '판정 규칙: 버핏지수의 1970년 이후 백분위'
      }
    ];
    var dg = $('compassDials');
    dg.innerHTML = '';
    dials.forEach(function (x) {
      dg.appendChild(el('div', 'dial-card',
        '<div class="dial-title">' + x.title + '</div>' +
        '<div class="dial-value" style="color:' + x.color + '">' + x.value + '</div>' +
        '<div class="dial-basis">' + x.basis + '</div>' +
        '<p class="dial-note">' + x.note + '</p>' +
        '<div class="dial-rule">' + x.rule + '</div>'));
    });

    /* --- 유사 연도 --- */
    var analogs = analogYears(d);
    var ag = $('analogGrid');
    ag.innerHTML = '';
    analogs.forEach(function (a) {
      var outcomes = [];
      if (a.nextSpx !== null) outcomes.push('S&P ' + pctTxt(a.nextSpx));
      if (a.nextKospi !== null) outcomes.push('KOSPI ' + pctTxt(a.nextKospi));
      if (a.nextGold !== null) outcomes.push('금 ' + pctTxt(a.nextGold));
      if (a.nextY10 !== null) outcomes.push('10년물 ' + (a.nextY10 >= 0 ? '+' : '') + a.nextY10.toFixed(1) + '%p');
      ag.appendChild(el('div', 'analog-card',
        '<div class="analog-year">' + a.year + '<span class="analog-sim">유사도 ' + a.sim + '%</span></div>' +
        '<div class="analog-era">' + (a.era || '—') + '</div>' +
        '<div class="analog-next"><b>그 뒤 1년</b> ' + outcomes.join(' · ') + '</div>'));
    });

    /* --- 종합 판정 --- */
    var warn = [];
    if (d.bufPct >= 90) warn.push('밸류에이션이 역사적 극단(백분위 ' + d.bufPct + '%)이라, 상승이 이어지더라도 장기 기대수익은 얇아진 상태입니다 (패턴 07).');
    if (d.wasInverted && d.spreadState.indexOf('재가팔음') >= 0) warn.push('장단기 금리차가 역전을 벗어나 다시 벌어지는 구간 — 과거 1990·2001·2008 침체가 시작된 바로 그 구간입니다. 이번이 예외로 남을지가 최대 논쟁거리입니다 (패턴 01).');
    if (d.stageKey === 'cut') warn.push('인하기의 성격(보험성 vs 침체형)은 사후에야 확정됩니다 — 고용과 신용 스프레드가 판별 지표입니다 (패턴 02).');
    var analogTxt = analogs.map(function (a) { return a.year; }).join(' · ');
    $('compassSummary').innerHTML =
      '<h3>종합 판정</h3>' +
      '<p class="cs-main">지금 데이터의 조합은 <b style="color:' + quad.color + '">' + quad.name + '</b>' +
      ' × <b>' + d.stageName + (d.stageKey === 'cut' ? ' (' + d.cutType + ' 성격)' : '') + '</b>' +
      ' × <b>밸류에이션 ' + d.valState + '</b>입니다. ' +
      '물가는 ' + d.cpi.toFixed(1) + '%로 ' + d.inflState + ' 상태에서 ' + d.inflDir + ' 중이고, 성장 신호(주가 추세·금리차·VIX)는 ' + d.growthState + ' 입니다.' +
      (analogTxt ? ' 1977년 이후에서 지금과 가장 닮은 해는 <b>' + analogTxt + '</b>입니다 (아래 카드).' : '') + '</p>' +
      (warn.length ? '<ul class="cs-warn">' + warn.map(function (w) { return '<li>' + w + '</li>'; }).join('') + '</ul>' : '');

    /* --- 플레이북 --- */
    $('playbookIntro').innerHTML =
      '현재 판정 국면 <b style="color:' + quad.color + '">' + quad.name + '</b> 기준의 자산군별 <b>역사 성적표</b>입니다. ' +
      quad.intro + ' <span class="muted">(국면 판정이 바뀌면 이 표도 자동으로 바뀝니다)</span>';
    var pg = $('playbookGrid');
    pg.innerHTML = '';
    quad.assets.forEach(function (a) {
      var stars = a.grade === 3 ? '★★★' : a.grade === 2 ? '★★' : a.grade === 1 ? '★' : '—';
      var cls = a.grade >= 3 ? 'g3' : a.grade === 2 ? 'g2' : a.grade === 1 ? 'g1' : 'g0';
      pg.appendChild(el('div', 'pb-card',
        '<div class="pb-head"><h4>' + a.name + '</h4><span class="pb-grade ' + cls + '">' + stars + '</span></div>' +
        '<div class="pb-hist">' + (a.hist !== '—' ? '사례: ' + a.hist : '') + '</div>' +
        '<p class="pb-why">' + a.why + '</p>' +
        (a.sector ? '<div class="pb-sector">' + a.sector + '</div>' : '') +
        '<div class="pb-risk"><b>유의</b> ' + a.risk + '</div>'));
    });

    /* --- 시나리오 --- */
    var sg = $('scenarioGrid');
    sg.innerHTML = '';
    SCENARIOS.forEach(function (s) {
      sg.appendChild(el('div', 'sc-card ' + s.tone,
        '<h4>' + s.name + '</h4>' +
        '<div class="sc-hist">' + s.hist + '</div>' +
        '<p>' + s.story + '</p>' +
        '<div class="sc-win">' + s.winners + '</div>' +
        '<div class="sc-lose">' + s.losers + '</div>' +
        '<div class="sc-watch"><b>감시 신호</b><ul>' + s.watch.map(function (w) { return '<li>' + w + '</li>'; }).join('') + '</ul></div>' +
        '<div class="sc-caveat">' + s.caveat + '</div>'));
    });
  }

  /* ==================== 2. 매크로 대시보드 ==================== */
  var dashState = { series: ['fed', 'us10y', 'spx'], range: null, normalize: true, log: true };
  var mainChart;

  var PRESETS = [
    { name: '금리 vs 주식', keys: ['fed', 'us10y', 'spx'] },
    { name: '인플레이션 시대', keys: ['cpi', 'fed', 'gold', 'wti'] },
    { name: '달러와 원자재', keys: ['dxy', 'gold', 'wti'] },
    { name: '한국 시장', keys: ['kospi', 'krw', 'bok'] },
    { name: '버블 온도계', keys: ['buffett', 'vix', 'spx'] },
    { name: '글로벌 증시', keys: ['spx', 'kospi', 'nikkei'] }
  ];
  var RANGE_PRESETS = [
    { name: '전체', r: null },
    { name: '1970s', r: [1970, 1979] }, { name: '1980s', r: [1980, 1989] },
    { name: '1990s', r: [1990, 1999] }, { name: '2000s', r: [2000, 2009] },
    { name: '2010s', r: [2010, 2019] }, { name: '2020s', r: [2020, YEAR_END] }
  ];
  var LEGEND_ORDER = ['fed', 'bok', 'us10y', 'us2y', 'spread', 'cpi', 'spx', 'kospi', 'nikkei', 'krw', 'dxy', 'gold', 'wti', 'buffett', 'vix'];

  function applyDash() {
    mainChart.setState({
      series: dashState.series, range: dashState.range,
      normalize: dashState.normalize, log: dashState.log
    });
    var r = dashState.range || [YEAR_START, YEAR_END];
    $('rangeLabel').textContent = r[0] + ' – ' + r[1];
    document.querySelectorAll('#legendChips .chip').forEach(function (c) {
      c.classList.toggle('on', dashState.series.indexOf(c.dataset.key) >= 0);
    });
    document.querySelectorAll('#rangeChips .chip').forEach(function (c) {
      var pr = RANGE_PRESETS[+c.dataset.idx].r;
      var match = (!pr && !dashState.range) || (pr && dashState.range && pr[0] === dashState.range[0] && pr[1] === dashState.range[1]);
      c.classList.toggle('on', !!match);
    });
    $('tglNorm').classList.toggle('on', dashState.normalize);
    $('tglLog').classList.toggle('on', dashState.log);
  }

  function buildDashboard() {
    var pc = $('presetChips');
    PRESETS.forEach(function (p) {
      var c = el('button', 'chip preset', p.name);
      c.onclick = function () {
        dashState.series = p.keys.slice();
        applyDash();
      };
      pc.appendChild(c);
    });
    var rc = $('rangeChips');
    RANGE_PRESETS.forEach(function (p, i) {
      var c = el('button', 'chip', p.name);
      c.dataset.idx = i;
      c.onclick = function () { dashState.range = p.r ? p.r.slice() : null; applyDash(); };
      rc.appendChild(c);
    });
    var lg = $('legendChips');
    var lastGroup = null;
    LEGEND_ORDER.forEach(function (k) {
      var s = SERIES[k];
      if (s.group !== lastGroup) {
        lg.appendChild(el('span', 'legend-group', s.group));
        lastGroup = s.group;
      }
      var c = el('button', 'chip series', '<i style="background:' + s.color + '"></i>' + s.short +
        (s.axis === 'pct' ? '<em>%</em>' : ''));
      c.dataset.key = k;
      c.title = s.label;
      c.onclick = function () {
        var i = dashState.series.indexOf(k);
        if (i >= 0) { if (dashState.series.length > 1) dashState.series.splice(i, 1); }
        else dashState.series.push(k);
        applyDash();
      };
      lg.appendChild(c);
    });

    $('tglNorm').onclick = function () { dashState.normalize = !dashState.normalize; applyDash(); };
    $('tglLog').onclick = function () { dashState.log = !dashState.log; applyDash(); };

    mainChart = new MacroChart('mainChart', 'mainTip', {
      series: dashState.series, height: 460, showEvents: true,
      onRange: function (r) { dashState.range = r; applyDash(); }
    });
    applyDash();
  }

  window.showEraInChart = function (eraId) {
    var era = null;
    ERAS.forEach(function (e) { if (e.id === eraId) era = e; });
    if (!era) return;
    closeModal();
    dashState.series = era.series.slice();
    var y0 = Math.max(YEAR_START, era.y0 - 2), y1 = Math.min(YEAR_END, era.y1 + 2);
    dashState.range = [y0, y1];
    applyDash();
    $('dashboard').scrollIntoView({ behavior: 'smooth' });
  };

  /* ==================== 3. 상관관계 매트릭스 ==================== */
  var CORR_KEYS = ['spx', 'kospi', 'nikkei', 'us10y', 'fed', 'cpi', 'dxy', 'krw', 'gold', 'wti', 'vix', 'buffett'];
  var corrState = { range: [YEAR_START, YEAR_END], sel: null };
  var CORR_RANGES = [
    { name: '전체 (1970–' + YEAR_END + ')', r: [YEAR_START, YEAR_END] },
    { name: '1970s', r: [1970, 1979] }, { name: '1980s', r: [1980, 1989] },
    { name: '1990s', r: [1990, 1999] }, { name: '2000s', r: [2000, 2009] },
    { name: '2010s', r: [2010, 2019] }, { name: '2020s', r: [2020, YEAR_END] }
  ];

  /* 연간 변화 계열: price → 로그수익률, pct → 연간 차분 */
  function changeSeries(key, y0, y1) {
    var out = {};
    var s = SERIES[key];
    for (var y = Math.max(y0 + 1, s.start + 1); y <= y1; y++) {
      var a = seriesVal(key, y - 1), b = seriesVal(key, y);
      if (a === null || b === null) continue;
      out[y] = s.axis === 'price' ? Math.log(b / a) * 100 : (b - a);
    }
    return out;
  }

  function pearson(m1, m2) {
    var xs = [], ys = [];
    for (var y in m1) if (m2[y] !== undefined) { xs.push(m1[y]); ys.push(m2[y]); }
    var n = xs.length;
    if (n < 6) return null;
    var mx = 0, my = 0;
    for (var i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    var sxy = 0, sxx = 0, syy = 0;
    for (i = 0; i < n; i++) {
      var dx = xs[i] - mx, dy = ys[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return null;
    return sxy / Math.sqrt(sxx * syy);
  }

  function corrOf(k1, k2, y0, y1) {
    return pearson(changeSeries(k1, y0, y1), changeSeries(k2, y0, y1));
  }

  function corrColor(c) {
    if (c === null) return 'rgba(148,163,184,0.06)';
    var a = Math.min(1, Math.abs(c));
    /* 한국식: 양(+) 빨강, 음(−) 파랑 */
    return c >= 0
      ? 'rgba(240, 97, 109,' + (0.08 + a * 0.72) + ')'
      : 'rgba(91, 141, 239,' + (0.08 + a * 0.72) + ')';
  }

  function renderMatrix() {
    var table = $('corrMatrix');
    table.innerHTML = '';
    var r = corrState.range;
    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', 'corner', ''));
    CORR_KEYS.forEach(function (k) {
      var th = el('th', 'col-h', '<span>' + SERIES[k].short + '</span>');
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    CORR_KEYS.forEach(function (k1) {
      var tr = el('tr');
      tr.appendChild(el('th', 'row-h', '<i style="background:' + SERIES[k1].color + '"></i>' + SERIES[k1].short));
      CORR_KEYS.forEach(function (k2) {
        var td = el('td');
        if (k1 === k2) {
          td.className = 'diag'; td.textContent = '';
        } else {
          var c = corrOf(k1, k2, r[0], r[1]);
          td.style.background = corrColor(c);
          td.textContent = c === null ? '–' : (c >= 0 ? '+' : '−') + Math.abs(c).toFixed(2).slice(1);
          td.title = SERIES[k1].label + ' × ' + SERIES[k2].label + (c === null ? ' (표본 부족)' : ' : ' + c.toFixed(2));
          td.style.cursor = 'pointer';
          td.onclick = function () { showPair(k1, k2); };
          if (corrState.sel && ((corrState.sel[0] === k1 && corrState.sel[1] === k2) || (corrState.sel[0] === k2 && corrState.sel[1] === k1))) {
            td.classList.add('sel');
          }
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function showPair(k1, k2) {
    corrState.sel = [k1, k2];
    renderMatrix();
    var d = $('corrDetail');
    var key = [k1, k2].sort().join('|');
    var note = PAIR_NOTES[key];
    var full = corrOf(k1, k2, YEAR_START, YEAR_END);
    var html = '<div class="pair-head"><i style="background:' + SERIES[k1].color + '"></i>' + SERIES[k1].short +
      ' <span>×</span> <i style="background:' + SERIES[k2].color + '"></i>' + SERIES[k2].short +
      '<b class="pair-corr">전체 ' + (full === null ? '–' : (full >= 0 ? '+' : '') + full.toFixed(2)) + '</b></div>';

    /* 10년 단위 상관 바 — 체제 변화 시각화 */
    html += '<div class="decade-bars">';
    CORR_RANGES.slice(1).forEach(function (p) {
      var c = corrOf(k1, k2, p.r[0], p.r[1]);
      var h = c === null ? 0 : Math.abs(c) * 34;
      var cls = c === null ? 'na' : c >= 0 ? 'pos' : 'neg';
      html += '<div class="dbar"><div class="dbar-area">' +
        '<div class="dbar-fill ' + cls + '" style="height:' + h + 'px;' + (c !== null && c < 0 ? 'top:35px' : 'bottom:35px') + '"></div>' +
        '</div><div class="dbar-val">' + (c === null ? '–' : (c >= 0 ? '+' : '−') + Math.abs(c).toFixed(2).slice(1)) + '</div>' +
        '<div class="dbar-label">' + p.name + '</div></div>';
    });
    html += '</div><div class="decade-note">10년 단위 상관계수 — 시대에 따라 관계가 어떻게 변하는지 보세요</div>';

    if (note) {
      html += '<h4>' + note.title + '</h4><p>' + note.body + '</p>';
    } else {
      html += '<p class="muted">두 지표의 연간 변화 기준 상관관계입니다. 상관은 인과가 아니며, 국면(물가·성장 체제)에 따라 부호가 바뀔 수 있습니다. 위 10년 단위 막대에서 관계의 변화를 확인하세요.</p>';
    }
    d.innerHTML = html;
  }

  function buildCorrelation() {
    var rc = $('corrRangeChips');
    CORR_RANGES.forEach(function (p, i) {
      var c = el('button', 'chip' + (i === 0 ? ' on' : ''), p.name);
      c.onclick = function () {
        corrState.range = p.r;
        document.querySelectorAll('#corrRangeChips .chip').forEach(function (x) { x.classList.remove('on'); });
        c.classList.add('on');
        renderMatrix();
      };
      rc.appendChild(c);
    });
    renderMatrix();
    showPair('spx', 'us10y');
    var ig = $('corrInsights');
    CORR_INSIGHTS.forEach(function (x) {
      ig.appendChild(el('div', 'card insight', '<h4>' + x.title + '</h4><p>' + x.body + '</p>'));
    });
  }

  /* ==================== 4. 사이클 ==================== */
  function buildClock() {
    var svg = $('clockSvg');
    var NS = 'http://www.w3.org/2000/svg';
    var cx = 170, cy = 170, R = 150;
    var quads = [
      { phase: CLOCK_PHASES[1], a0: -90, a1: 0, lx: 245, ly: 82 },   /* 과열: 우상 */
      { phase: CLOCK_PHASES[2], a0: 180, a1: 270, lx: 95, ly: 82 },  /* 스태그: 좌상 */
      { phase: CLOCK_PHASES[3], a0: 90, a1: 180, lx: 95, ly: 262 },  /* 침체: 좌하 */
      { phase: CLOCK_PHASES[0], a0: 0, a1: 90, lx: 245, ly: 262 }    /* 회복: 우하 */
    ];
    function pt(deg, r) {
      var rad = deg * Math.PI / 180;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    }
    quads.forEach(function (q) {
      var p0 = pt(q.a0, R), p1 = pt(q.a1, R);
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M' + cx + ',' + cy + ' L' + p0[0] + ',' + p0[1] +
        ' A' + R + ',' + R + ' 0 0 1 ' + p1[0] + ',' + p1[1] + ' Z');
      path.setAttribute('fill', q.phase.color);
      path.setAttribute('fill-opacity', '0.13');
      path.setAttribute('stroke', q.phase.color);
      path.setAttribute('stroke-opacity', '0.5');
      path.setAttribute('class', 'clock-quad');
      path.dataset.id = q.phase.id;
      path.addEventListener('click', function () { selectPhase(q.phase.id); });
      svg.appendChild(path);
      var t1 = document.createElementNS(NS, 'text');
      t1.setAttribute('x', q.lx); t1.setAttribute('y', q.ly);
      t1.setAttribute('class', 'clock-label');
      t1.setAttribute('fill', q.phase.color);
      t1.textContent = q.phase.name;
      t1.addEventListener('click', function () { selectPhase(q.phase.id); });
      svg.appendChild(t1);
      var t2 = document.createElementNS(NS, 'text');
      t2.setAttribute('x', q.lx); t2.setAttribute('y', q.ly + 17);
      t2.setAttribute('class', 'clock-sub');
      t2.textContent = q.phase.best + ' ★';
      svg.appendChild(t2);
    });
    /* 축 */
    var mkLine = function (x1, y1, x2, y2) {
      var l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke', 'rgba(148,163,184,0.35)');
      svg.appendChild(l);
    };
    mkLine(cx - R, cy, cx + R, cy);
    mkLine(cx, cy - R, cx, cy + R);
    var ax = document.createElementNS(NS, 'text');
    ax.setAttribute('x', cx + R - 4); ax.setAttribute('y', cy - 7);
    ax.setAttribute('class', 'clock-axis'); ax.setAttribute('text-anchor', 'end');
    ax.textContent = '성장 →';
    svg.appendChild(ax);
    var ay = document.createElementNS(NS, 'text');
    ay.setAttribute('x', cx + 7); ay.setAttribute('y', cy - R + 14);
    ay.setAttribute('class', 'clock-axis');
    ay.textContent = '물가 ↑';
    svg.appendChild(ay);

    function selectPhase(id) {
      var p = null;
      CLOCK_PHASES.forEach(function (x) { if (x.id === id) p = x; });
      if (!p) return;
      svg.querySelectorAll('.clock-quad').forEach(function (q) {
        q.setAttribute('fill-opacity', q.dataset.id === id ? '0.32' : '0.08');
      });
      $('clockInfo').innerHTML =
        '<div class="phase-head" style="color:' + p.color + '">' + p.name + ' <span>' + p.cond + '</span></div>' +
        '<div class="phase-order">' + p.order + '</div>' +
        '<p>' + p.why + '</p>' +
        '<div class="phase-meta"><b>금리 국면</b> ' + p.rates + '</div>' +
        '<div class="phase-meta"><b>역사적 사례</b> ' + p.cases + '</div>';
    }
    selectPhase('recovery');
  }

  function buildRateCycle() {
    var wrap = $('rateCycle');
    RATE_CYCLE.forEach(function (s, i) {
      var c = el('div', 'rate-stage');
      c.innerHTML = '<h4>' + s.name + '</h4><div class="rs-ex">' + s.ex + '</div>' +
        '<p>' + s.effect + '</p><div class="rs-note">' + s.note + '</div>';
      wrap.appendChild(c);
      if (i < RATE_CYCLE.length - 1) wrap.appendChild(el('div', 'rate-arrow', '→'));
    });
  }

  function buildSpread() {
    new MacroChart('spreadChart', 'spreadTip', {
      series: ['spread'], height: 280, normalize: false, log: false,
      zeroFill: true, showRecessions: true, showEvents: false
    });
    var tb = $('invTable');
    var html = '<tr><th>역전 시작</th><th>침체 시작</th><th>시차</th><th>맥락</th></tr>';
    INVERSIONS.forEach(function (r) {
      html += '<tr><td>' + r.inv + '</td><td>' + r.rec + '</td><td class="gap">' + r.gap + '</td><td>' + r.note + '</td></tr>';
    });
    tb.innerHTML = html;
  }

  function buildDollar() {
    new MacroChart('dollarChart', 'dollarTip', {
      series: ['dxy'], height: 280, normalize: false, log: false,
      showRecessions: false, showEvents: false, bands: DOLLAR_CYCLES,
      range: [1973, 2025]
    });
  }

  /* ==================== 5. 패턴 플레이북 ==================== */
  function buildPatterns() {
    var grid = $('patternGrid');
    PATTERNS.forEach(function (p) {
      var caseHtml = p.cases.map(function (c) { return '<li>' + c + '</li>'; }).join('');
      var card = el('div', 'card pattern');
      card.innerHTML =
        '<div class="pt-num">' + p.num + '</div>' +
        '<h3>' + p.title + '</h3>' +
        '<div class="pt-rule">' + p.rule + '</div>' +
        '<p class="pt-why">' + p.why + '</p>' +
        '<ul class="pt-cases">' + caseHtml + '</ul>' +
        '<div class="pt-caveat"><b>주의</b> ' + p.caveat + '</div>';
      grid.appendChild(card);
    });
  }

  /* ==================== 6. 역사 (시대) ==================== */
  var TAG_CLS = { '위기': 'crisis', '하락장': 'bear', '상승장': 'bull', '버블': 'bubble', '전환점': 'pivot', '횡보': 'flat' };

  function eraStat(era, key) {
    var s = SERIES[key];
    if (!s) return null;
    var baseYear = Math.max(era.y0 - 1, s.start);
    var v0 = seriesVal(key, baseYear), v1 = seriesVal(key, Math.min(era.y1, YEAR_END));
    if (v0 === null || v1 === null) return null;
    if (s.axis === 'price') {
      var chg = (v1 / v0 - 1) * 100;
      return { key: key, baseYear: baseYear, v0: v0, v1: v1, txt: (chg >= 0 ? '+' : '') + chg.toFixed(0) + '%', up: chg >= 0, pct: false };
    }
    var d = v1 - v0;
    return { key: key, baseYear: baseYear, v0: v0, v1: v1, txt: (d >= 0 ? '+' : '') + d.toFixed(1) + '%p', up: d >= 0, pct: true };
  }

  function buildEras() {
    var grid = $('eraGrid');
    ERAS.forEach(function (era) {
      var card = el('div', 'era-card');
      var stats = era.statKeys.map(function (k) { return eraStat(era, k); }).filter(Boolean).slice(0, 3);
      var statHtml = stats.map(function (st) {
        return '<span class="era-stat"><i>' + SERIES[st.key].short + '</i><b class="' + (st.up ? 'up' : 'down') + '">' + st.txt + '</b></span>';
      }).join('');
      card.innerHTML =
        '<div class="era-top"><span class="era-years">' + era.y0 + (era.y1 !== era.y0 ? '–' + String(era.y1).slice(2) : '') + '</span>' +
        '<span class="era-tag ' + (TAG_CLS[era.tag] || '') + '">' + era.tag + '</span></div>' +
        '<h3>' + era.title + '</h3>' +
        '<p class="era-tagline">' + era.tagline + '</p>' +
        '<div class="era-stats">' + statHtml + '</div>' +
        '<div class="era-more">자세히 보기 →</div>';
      card.onclick = function () { openEra(era); };
      grid.appendChild(card);
    });
  }

  function openEra(era) {
    var m = $('modal');
    var stats = era.statKeys.map(function (k) { return eraStat(era, k); }).filter(Boolean);
    var statRows = stats.map(function (st) {
      var s = SERIES[st.key];
      return '<tr><td><i class="dot" style="background:' + s.color + '"></i>' + s.label + '</td>' +
        '<td>' + fmtValue(st.key, st.v0) + ' <span class="muted">(' + st.baseYear + '말)</span></td>' +
        '<td>' + fmtValue(st.key, st.v1) + ' <span class="muted">(' + era.y1 + '말)</span></td>' +
        '<td class="' + (st.up ? 'up' : 'down') + '">' + st.txt + '</td></tr>';
    }).join('');
    var story = era.story.map(function (p) { return '<p>' + p + '</p>'; }).join('');
    var ups = era.up.map(function (u) { return '<li>' + u + '</li>'; }).join('');
    var downs = era.down.map(function (u) { return '<li>' + u + '</li>'; }).join('');
    $('modalBody').innerHTML =
      '<div class="era-top"><span class="era-years big">' + era.y0 + ' – ' + era.y1 + '</span>' +
      '<span class="era-tag ' + (TAG_CLS[era.tag] || '') + '">' + era.tag + '</span></div>' +
      '<h2>' + era.title + '</h2>' +
      '<p class="era-tagline big">' + era.tagline + '</p>' +
      '<table class="era-table"><tr><th>지표</th><th>시작</th><th>끝</th><th>변화</th></tr>' + statRows + '</table>' +
      '<h4 class="mh">무슨 일이 있었나</h4>' + story +
      '<div class="updown"><div class="ud up-box"><h4>▲ 무엇이, 왜 올랐나</h4><ul>' + ups + '</ul></div>' +
      '<div class="ud down-box"><h4>▼ 무엇이, 왜 내렸나</h4><ul>' + downs + '</ul></div></div>' +
      '<div class="lesson"><b>교훈</b> ' + era.lesson + '</div>' +
      '<button class="btn-chart" onclick="showEraInChart(\'' + era.id + '\')">이 시대를 차트에서 보기 →</button>';
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    $('modal').classList.remove('open');
    document.body.style.overflow = '';
  }
  window.closeModal = closeModal;

  $('modal').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  /* ==================== 7. 머니 플로우 지도 ==================== */
  var mechSel = null;

  function buildMech() {
    var svg = $('mechSvg');
    var NS = 'http://www.w3.org/2000/svg';
    var defs = document.createElementNS(NS, 'defs');
    defs.innerHTML =
      '<marker id="arrPos" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="#f0616d"/></marker>' +
      '<marker id="arrNeg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="#5b8def"/></marker>';
    svg.appendChild(defs);

    var nodeMap = {};
    MECH_NODES.forEach(function (n) { nodeMap[n.id] = n; });
    var NW = 128, NH = 46;

    function edgePoint(from, to) {
      /* 노드 사각형 경계에서 시작/끝나도록 */
      var dx = to.x - from.x, dy = to.y - from.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len;
      var tx = Math.abs(ux) > 0.0001 ? (NW / 2 + 4) / Math.abs(ux) : Infinity;
      var ty = Math.abs(uy) > 0.0001 ? (NH / 2 + 4) / Math.abs(uy) : Infinity;
      var t = Math.min(tx, ty);
      return [from.x + ux * t, from.y + uy * t];
    }

    var edgeEls = [];
    MECH_EDGES.forEach(function (e) {
      var a = nodeMap[e.from], b = nodeMap[e.to];
      if (!a || !b) return;
      var p0 = edgePoint(a, b), p1 = edgePoint(b, a);
      var mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      /* 살짝 휘어진 곡선 */
      var nx = -(p1[1] - p0[1]), ny = p1[0] - p0[0];
      var nl = Math.sqrt(nx * nx + ny * ny) || 1;
      var bend = 14;
      var qx = mx + nx / nl * bend, qy = my + ny / nl * bend;
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M' + p0[0] + ',' + p0[1] + ' Q' + qx + ',' + qy + ' ' + p1[0] + ',' + p1[1]);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', e.sign > 0 ? 'rgba(240,97,109,0.55)' : 'rgba(91,141,239,0.55)');
      path.setAttribute('stroke-width', '1.8');
      path.setAttribute('marker-end', e.sign > 0 ? 'url(#arrPos)' : 'url(#arrNeg)');
      path.setAttribute('class', 'mech-edge');
      var title = document.createElementNS(NS, 'title');
      title.textContent = nodeMap[e.from].label + ' ' + (e.sign > 0 ? '↑ → ' : '↑ → ') + nodeMap[e.to].label +
        (e.sign > 0 ? ' ↑' : ' ↓') + '  |  ' + e.note;
      path.appendChild(title);
      svg.appendChild(path);
      edgeEls.push({ el: path, e: e });
    });

    var nodeEls = [];
    MECH_NODES.forEach(function (n) {
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'mech-node');
      g.setAttribute('transform', 'translate(' + (n.x - NW / 2) + ',' + (n.y - NH / 2) + ')');
      var color = MECH_CATS[n.cat].color;
      var rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('width', NW); rect.setAttribute('height', NH);
      rect.setAttribute('rx', 10);
      rect.setAttribute('fill', '#131a24');
      rect.setAttribute('stroke', color);
      rect.setAttribute('stroke-opacity', '0.65');
      rect.setAttribute('stroke-width', '1.4');
      g.appendChild(rect);
      var text = document.createElementNS(NS, 'text');
      text.setAttribute('x', NW / 2); text.setAttribute('y', NH / 2 + 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', '#e6edf3');
      text.setAttribute('font-size', '12.5');
      text.setAttribute('font-weight', '600');
      text.textContent = n.label;
      g.appendChild(text);
      g.addEventListener('click', function () { selectNode(n.id); });
      svg.appendChild(g);
      nodeEls.push({ el: g, rect: rect, n: n });
    });

    function selectNode(id) {
      if (mechSel === id) { mechSel = null; } else { mechSel = id; }
      var sel = mechSel;
      edgeEls.forEach(function (x) {
        var on = !sel || x.e.from === sel || x.e.to === sel;
        x.el.style.opacity = on ? (sel ? 1 : 0.75) : 0.08;
        x.el.setAttribute('stroke-width', sel && on ? '2.6' : '1.8');
      });
      nodeEls.forEach(function (x) {
        var related = !sel || x.n.id === sel;
        if (sel && !related) {
          MECH_EDGES.forEach(function (e) {
            if ((e.from === sel && e.to === x.n.id) || (e.to === sel && e.from === x.n.id)) related = true;
          });
        }
        x.el.style.opacity = related ? 1 : 0.18;
        x.rect.setAttribute('stroke-width', sel === x.n.id ? '2.6' : '1.4');
      });
      renderMechPanel(sel);
    }

    function renderMechPanel(sel) {
      var p = $('mechPanel');
      if (!sel) {
        p.innerHTML = '<h4>노드를 클릭해보세요</h4>' +
          '<p class="muted">각 변수를 클릭하면 그 변수가 주고받는 영향만 강조되고, 전달 경로와 역사적 사례가 여기 표시됩니다.</p>' +
          '<div class="mech-legend">' +
          '<span><i class="arr pos"></i> 같은 방향 (+) — 원인↑ 이면 결과↑</span>' +
          '<span><i class="arr neg"></i> 반대 방향 (−) — 원인↑ 이면 결과↓</span>' +
          '</div>' +
          '<div class="mech-legend cats">' +
          Object.keys(MECH_CATS).map(function (c) {
            return '<span><i class="sq" style="border-color:' + MECH_CATS[c].color + '"></i>' + MECH_CATS[c].label + '</span>';
          }).join('') + '</div>';
        return;
      }
      var node = null;
      MECH_NODES.forEach(function (n) { if (n.id === sel) node = n; });
      var outs = MECH_EDGES.filter(function (e) { return e.from === sel; });
      var ins = MECH_EDGES.filter(function (e) { return e.to === sel; });
      var nm = {};
      MECH_NODES.forEach(function (n) { nm[n.id] = n.label; });
      function edgeRow(e, dir) {
        var arrow = e.sign > 0 ? '<b class="pos">＋</b>' : '<b class="neg">−</b>';
        var line = dir === 'out'
          ? '<b>' + nm[e.to] + '</b>에 영향 ' + arrow
          : '<b>' + nm[e.from] + '</b>의 영향 ' + arrow;
        return '<li>' + line + '<br><span>' + e.note + '</span><em>' + e.ex + '</em></li>';
      }
      p.innerHTML = '<h4 style="color:' + MECH_CATS[node.cat].color + '">' + node.label + '</h4>' +
        '<p>' + node.desc + '</p>' +
        (outs.length ? '<div class="mech-sub">→ 주는 영향</div><ul class="mech-list">' + outs.map(function (e) { return edgeRow(e, 'out'); }).join('') + '</ul>' : '') +
        (ins.length ? '<div class="mech-sub">← 받는 영향</div><ul class="mech-list">' + ins.map(function (e) { return edgeRow(e, 'in'); }).join('') + '</ul>' : '');
    }

    renderMechPanel(null);
  }

  /* ==================== 8. 내비게이션 ==================== */
  function buildNav() {
    var links = document.querySelectorAll('.topnav a[href^="#"]');
    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var t = document.querySelector(a.getAttribute('href'));
        if (t) t.scrollIntoView({ behavior: 'smooth' });
      });
    });
    var sections = Array.prototype.map.call(links, function (a) {
      return document.querySelector(a.getAttribute('href'));
    });
    function onScroll() {
      var pos = window.scrollY + 140;
      var active = 0;
      sections.forEach(function (s, i) { if (s && s.offsetTop <= pos) active = i; });
      links.forEach(function (a, i) { a.classList.toggle('on', i === active); });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ==================== 수익화 설정 적용 (js/config.js) ==================== */
  function applyConfig() {
    var cfg = window.SITE_CONFIG || {};

    /* 상단바 후원 버튼 */
    if (cfg.supportLink) {
      var bar = document.querySelector('.topbar');
      if (bar) {
        var a = document.createElement('a');
        a.className = 'support-btn';
        a.setAttribute('href', cfg.supportLink);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        a.textContent = '☕ 후원';
        bar.appendChild(a);
      }
    }

    /* 푸터 위 후원·프리미엄 영역 */
    var area = $('monetizeArea');
    if (area && (cfg.supportLink || cfg.premiumWaitlistUrl)) {
      var btns = '';
      if (cfg.premiumWaitlistUrl) {
        btns += '<a class="mz-btn primary" target="_blank" rel="noopener noreferrer" href="' +
          cfg.premiumWaitlistUrl + '">🔔 프리미엄 출시 알림 받기</a>';
      }
      if (cfg.supportLink) {
        btns += '<a class="mz-btn" target="_blank" rel="noopener noreferrer" href="' +
          cfg.supportLink + '">☕ 이 프로젝트 후원하기</a>';
      }
      area.innerHTML =
        '<div class="mz-title">머니 아틀라스가 도움이 되었다면</div>' +
        '<div class="mz-btns">' + btns + '</div>';
    }

    /* 광고: 애드센스 우선, 없으면 쿠팡파트너스 배너 */
    if (cfg.adsenseClient) {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
        encodeURIComponent(cfg.adsenseClient);
      s.crossOrigin = 'anonymous';
      document.head.appendChild(s);
      document.querySelectorAll('.ad-slot').forEach(function (slot) {
        slot.classList.add('on');
        slot.innerHTML = '<ins class="adsbygoogle" style="display:block" data-ad-client="' +
          cfg.adsenseClient + '" data-ad-format="auto" data-full-width-responsive="true"></ins>';
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      });
    } else if (cfg.coupangPartnersHtml) {
      var first = document.querySelector('.ad-slot');
      if (first) {
        first.classList.add('on');
        first.innerHTML = cfg.coupangPartnersHtml +
          '<div class="ad-note">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</div>';
      }
    }
  }

  /* ==================== init ==================== */
  buildTicker();
  buildNews();
  buildSnapshot();
  buildCompass();
  buildDashboard();
  if (DATA_ASOF) {
    var fn = document.querySelector('#dashboard .footnote');
    if (fn) fn.textContent += ' · 마지막 연도(' + YEAR_END + ')는 실시간 시세를 반영한 연중 값';
  }
  buildCorrelation();
  buildClock();
  buildRateCycle();
  buildSpread();
  buildDollar();
  buildPatterns();
  buildEras();
  buildMech();
  buildNav();
  applyConfig();
})();
