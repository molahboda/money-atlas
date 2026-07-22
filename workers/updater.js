/* =====================================================
   MONEY ATLAS — 갱신 스케줄러 (Cloudflare Workers Cron)

   15분마다 야후 시세 + 구글 뉴스 RSS를 수집해
   GitHub의 js/live.js 를 직접 커밋합니다.
   (GitHub Actions 크론의 불안정성을 대체 — 정시 실행 보장)

   환경변수(시크릿):
     GH_TOKEN     GitHub PAT (repo contents:write 권한)
   환경변수(일반, wrangler.toml):
     GH_REPO      "molahboda/money-atlas"
     GH_PATH      "js/live.js"
     GH_BRANCH    "main"
   수동 실행: 배포 후 https://<worker>.workers.dev/run 접속
   ===================================================== */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const YAHOO = {
  spx: '^GSPC', kospi: '^KS11', nikkei: '^N225', krw: 'KRW=X',
  dxy: 'DX-Y.NYB', gold: 'GC=F', wti: 'CL=F', vix: '^VIX',
};

const NEWS_QUERY = '(증시 OR 금리 OR 환율 OR 유가 OR 연준 OR 물가 OR 반도체 OR 관세 OR 코스피) when:2d';

async function fetchText(url, opts) {
  const r = await fetch(url, Object.assign({
    headers: { 'User-Agent': UA, 'Accept': '*/*' },
    cf: { cacheTtl: 0 },
  }, opts || {}));
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url.slice(0, 60));
  return r.text();
}

async function yahooQuote(symbol) {
  const path = '/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=2d&interval=1d';
  let lastErr;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const data = JSON.parse(await fetchText('https://' + host + path));
      const meta = data.chart.result[0].meta;
      const price = Number(meta.regularMarketPrice);
      const prev = meta.chartPreviousClose ? Number(meta.chartPreviousClose) : null;
      return [price, prev];
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&');
}

function tag(xml, name) {
  // 여는 태그에 속성이 있을 수 있음: <source url="...">BBC</source>
  const m = xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>'));
  if (!m) return '';
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
}

async function fetchNews(limit) {
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(NEWS_QUERY) + '&hl=ko&gl=KR&ceid=KR:ko';
  const xml = await fetchText(url);
  const items = [];
  const seen = new Set();
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    let title = tag(block, 'title');
    const link = tag(block, 'link');
    const src = tag(block, 'source');
    const pub = tag(block, 'pubDate');
    if (src && title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3)).trim();
    const key = title.slice(0, 22);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    let iso = '';
    const t = Date.parse(pub);
    if (!isNaN(t)) iso = new Date(t).toISOString().replace(/\.\d{3}Z$/, '+00:00');
    items.push({ t: title, u: link.startsWith('http') ? link : '', s: src, d: iso });
  }
  items.sort((a, b) => (b.d > a.d ? 1 : b.d < a.d ? -1 : 0));
  return items.slice(0, limit || 10);
}

/* 직전 live.js 에서 JSON payload 파싱 (실패 소스 값 유지용) */
function parsePrev(text) {
  try {
    const i = text.indexOf('{');
    const j = text.lastIndexOf('}');
    if (i >= 0 && j > i) return JSON.parse(text.slice(i, j + 1));
  } catch (e) { }
  return {};
}

async function ghGet(env) {
  const url = 'https://api.github.com/repos/' + env.GH_REPO + '/contents/' + env.GH_PATH + '?ref=' + env.GH_BRANCH;
  const r = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + env.GH_TOKEN, 'User-Agent': 'money-atlas-updater', 'Accept': 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error('GitHub GET ' + r.status);
  const j = await r.json();
  // base64 → 바이트 → UTF-8 로 정확히 디코딩 (atob 만 쓰면 한글이 Latin1 로 깨져 누적 corruption)
  const bin = atob(j.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
  const content = new TextDecoder('utf-8').decode(bytes);
  return { sha: j.sha, content: content };
}

function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function ghPut(env, body, sha) {
  const url = 'https://api.github.com/repos/' + env.GH_REPO + '/contents/' + env.GH_PATH;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + env.GH_TOKEN, 'User-Agent': 'money-atlas-updater', 'Accept': 'application/vnd.github+json' },
    body: JSON.stringify({
      message: 'chore: 실시간 데이터 갱신 (Cloudflare)',
      content: b64utf8(body),
      sha: sha,
      branch: env.GH_BRANCH,
      committer: { name: 'money-atlas-bot', email: 'actions@users.noreply.github.com' },
    }),
  });
  if (!r.ok) throw new Error('GitHub PUT ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return r.json();
}

async function runUpdate(env) {
  const quotes = {};
  const daily = {};
  const fails = [];

  const keys = Object.keys(YAHOO);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    try {
      const [price, prev] = await yahooQuote(YAHOO[k]);
      quotes[k] = Math.round(price * 100) / 100;
      if (prev) daily[k] = Math.round((price / prev - 1) * 10000) / 100;
    } catch (e) { fails.push(k + ': ' + e.message); }
  }

  let news = [];
  try { news = await fetchNews(10); } catch (e) { fails.push('news: ' + e.message); }

  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');

  // 직전 성공값과 병합
  const cur = await ghGet(env);
  const prev = parsePrev(cur.content);

  let quotesAt, mergedQuotes, mergedDaily;
  if (Object.keys(quotes).length) {
    quotesAt = nowIso;
    mergedQuotes = Object.assign({}, prev.quotes || {}, quotes);
    const sameDay = String(prev.quotesAt || '').slice(0, 10) === nowIso.slice(0, 10);
    mergedDaily = Object.assign(sameDay ? (prev.daily || {}) : {}, daily);
  } else {
    quotesAt = prev.quotesAt || prev.fetchedAt;
    mergedQuotes = prev.quotes || {};
    mergedDaily = prev.daily || {};
  }

  let newsAt;
  if (news.length) { newsAt = nowIso; }
  else { newsAt = prev.newsAt || prev.fetchedAt; news = prev.news || []; }

  const payload = {
    fetchedAt: nowIso,
    quotesAt, newsAt,
    quotes: mergedQuotes,
    daily: mergedDaily,
    news,
    asof: prev.asof || {},
    source: 'Yahoo Finance(시세) · Google News RSS(뉴스) · Cloudflare Workers',
  };
  const body = '/* 자동 생성 파일 — Cloudflare Workers updater 가 갱신합니다. 직접 수정하지 마세요. */\n' +
    'window.LIVE_DATA = ' + JSON.stringify(payload, null, 2) + ';\n';

  // 변경 없으면 커밋 스킵 (뉴스/시세 동일 시)
  const changed = body.replace(/"fetchedAt":[^,]+,/, '') !== cur.content.replace(/"fetchedAt":[^,]+,/, '');
  if (!changed) return { skipped: true, fails };

  await ghPut(env, body, cur.sha);
  return { committed: true, quotes: Object.keys(mergedQuotes).length, news: news.length, fails };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runUpdate(env).catch((e) => console.error('update failed', e)));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      // 수동 실행은 토큰 필수 (자동 갱신은 scheduled 핸들러가 담당하므로 영향 없음)
      // 활성화하려면:  npx wrangler secret put RUN_TOKEN --config wrangler-updater.toml
      if (!env.RUN_TOKEN || url.searchParams.get('key') !== env.RUN_TOKEN) {
        return new Response('forbidden', { status: 403 });
      }
      try {
        const res = await runUpdate(env);
        return new Response(JSON.stringify(res, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response('error: ' + e.message, { status: 500 });
      }
    }
    return new Response('money-atlas updater', { status: 200 });
  },
};
