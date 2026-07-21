#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MONEY ATLAS — 실시간 시세 갱신 스크립트 (API 키 불필요)

야후 파이낸스 공개 차트 API와 FRED 공개 CSV에서 최신 값을 받아
js/live.js 를 생성합니다. 실패한 지표는 건너뛰고(사이트는 내장
근사치로 대체), 성공/실패 요약을 출력합니다.

사용법:  python3 update_live.py        (money-atlas 폴더 안에서)
serve.py 실행 시 자동으로 한 번 호출됩니다.
"""
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, 'js', 'live.js')

HEADERS = {
    'User-Agent': ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                   'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')
}

# 사이트 시리즈 키 → 야후 티커
YAHOO_TICKERS = {
    'spx': '^GSPC',      # S&P 500
    'kospi': '^KS11',    # KOSPI
    'nikkei': '^N225',   # 니케이 225
    'krw': 'KRW=X',      # 원/달러
    'dxy': 'DX-Y.NYB',   # 달러인덱스
    'gold': 'GC=F',      # 금 선물
    'wti': 'CL=F',       # WTI 선물
    'vix': '^VIX',       # VIX
}

# 사이트 시리즈 키 → FRED 시리즈 ID
FRED_SERIES = {
    'us10y': 'DGS10',    # 미국 10년물
    'us2y': 'DGS2',      # 미국 2년물
    'fed': 'DFF',        # 연방기금 실효금리
}


def _ssl_context():
    """기본 → certifi → macOS 시스템 인증서 순서로 시도"""
    candidates = [None]
    try:
        import certifi
        candidates.append(certifi.where())
    except ImportError:
        pass
    candidates.append('/etc/ssl/cert.pem')
    for cafile in candidates:
        try:
            ctx = ssl.create_default_context(cafile=cafile)
            if cafile or ctx.cert_store_stats().get('x509_ca', 0) > 0:
                return ctx
        except Exception:
            continue
    return ssl.create_default_context()


SSL_CTX = _ssl_context()


def _fetch_urllib(url, timeout):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
        return r.read().decode('utf-8', 'replace')


def _fetch_curl(url, timeout):
    """urllib 이 막힌 환경(프록시·샌드박스 등) 대비 curl 폴백"""
    import subprocess
    r = subprocess.run(
        ['curl', '-fsS', '--http1.1', '--max-time', str(int(timeout)),
         '-H', 'User-Agent: ' + HEADERS['User-Agent'], url],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError('curl 실패(' + str(r.returncode) + '): ' + r.stderr.strip()[:160])
    if not r.stdout:
        raise RuntimeError('curl: 빈 응답')
    return r.stdout


def fetch(url, timeout=15, tries=3):
    """1차 urllib → 이후 curl 폴백, 429 는 길게 대기"""
    last_err = None
    for attempt in range(tries):
        method = _fetch_urllib if attempt == 0 else _fetch_curl
        try:
            return method(url, timeout)
        except Exception as e:
            last_err = e
            msg = str(e)
            is429 = ('429' in msg) or (isinstance(e, urllib.error.HTTPError) and e.code == 429)
            if attempt < tries - 1:
                time.sleep(6.0 if is429 else 1.5)
    raise last_err


def yahoo_single(symbol):
    """v8 차트 엔드포인트 — 심볼 1개. spark 차단 시 폴백. (현재가, 전일종가 or None)"""
    path = ('/v8/finance/chart/' + urllib.parse.quote(symbol)
            + '?range=2d&interval=1d')
    last_err = None
    for host in ('query2.finance.yahoo.com', 'query1.finance.yahoo.com'):
        try:
            data = json.loads(fetch('https://' + host + path, timeout=10, tries=2))
            meta = data['chart']['result'][0]['meta']
            price = float(meta['regularMarketPrice'])
            prev = meta.get('chartPreviousClose')
            return (price, float(prev) if prev else None)
        except Exception as e:
            last_err = e
    raise last_err


# 야후 차단 시 폴백: 네이버 금융 (달러인덱스는 미지원 → 직전값 유지)
NAVER_SOURCES = {
    'kospi':  ('idx',  'KOSPI'),
    'spx':    ('widx', '.INX'),
    'nikkei': ('widx', '.N225'),
    'vix':    ('widx', '.VIX'),
    'krw':    ('mkt',  'exchange', 'FX_USDKRW'),
    'gold':   ('mkt',  'metals',   'GCcv1'),
    'wti':    ('mkt',  'energy',   'CLcv1'),
}


def _num(s):
    return float(str(s).replace(',', ''))


def naver_quote(spec):
    """네이버 금융 — (가격, 당일 등락률% or None) 반환"""
    kind = spec[0]
    if kind == 'idx':
        d = json.loads(fetch('https://m.stock.naver.com/api/index/' + spec[1] + '/basic',
                             timeout=8, tries=2))
    elif kind == 'widx':
        d = json.loads(fetch('https://api.stock.naver.com/index/' + spec[1] + '/basic',
                             timeout=8, tries=2))
    else:
        d = json.loads(fetch('https://m.stock.naver.com/front-api/marketIndex/productDetail'
                             '?category=' + spec[1] + '&reutersCode=' + spec[2],
                             timeout=8, tries=2)).get('result') or {}
    price = _num(d['closePrice'])
    rate = d.get('fluctuationsRatio')
    try:
        rate = float(str(rate).replace(',', ''))
    except (TypeError, ValueError):
        rate = None
    return price, rate


NEWS_QUERY = '(증시 OR 금리 OR 환율 OR 유가 OR 연준 OR 물가 OR 반도체 OR 관세 OR 코스피) when:2d'


def fetch_news(limit=10):
    """구글 뉴스 RSS(한국) — 최근 매크로·시장 헤드라인"""
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime
    url = ('https://news.google.com/rss/search?q=' + urllib.parse.quote(NEWS_QUERY)
           + '&hl=ko&gl=KR&ceid=KR:ko')
    root = ET.fromstring(fetch(url).encode('utf-8'))
    items, seen = [], set()
    for it in root.iter('item'):
        title = (it.findtext('title') or '').strip()
        link = (it.findtext('link') or '').strip()
        src = (it.findtext('source') or '').strip()
        pub = it.findtext('pubDate') or ''
        if src and title.endswith(' - ' + src):
            title = title[: -(len(src) + 3)].strip()
        key = title[:22]
        if not title or key in seen:
            continue
        seen.add(key)
        iso = ''
        try:
            iso = parsedate_to_datetime(pub).astimezone(timezone.utc).isoformat(timespec='seconds')
        except Exception:
            pass
        if not link.startswith('http'):
            link = ''
        items.append({'t': title, 'u': link, 's': src, 'd': iso})
    items.sort(key=lambda x: x['d'], reverse=True)
    return items[:limit]


def fred_last_two(series_id, days_back=45):
    start = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime('%Y-%m-%d')
    url = ('https://fred.stlouisfed.org/graph/fredgraph.csv?id='
           + series_id + '&cosd=' + start)
    rows = [ln.split(',') for ln in fetch(url, timeout=8, tries=2).strip().splitlines()[1:]]
    vals = [(d, v) for d, v in rows if len(v) and v != '.']
    if not vals:
        raise ValueError('no data for ' + series_id)
    return vals[-2:]  # [(date, value), ...] 마지막 두 개


def fred_cpi_yoy():
    """CPIAUCSL 월간 지수에서 전년동월비(%) 계산"""
    start = (datetime.now(timezone.utc) - timedelta(days=430)).strftime('%Y-%m-%d')
    url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL&cosd=' + start
    rows = [ln.split(',') for ln in fetch(url, timeout=8, tries=2).strip().splitlines()[1:]]
    vals = [(d, float(v)) for d, v in rows if len(v) and v != '.']
    if len(vals) < 13:
        raise ValueError('CPI history too short')
    d1, v1 = vals[-1]
    d0, v0 = vals[-13]
    return d1, round((v1 / v0 - 1.0) * 100.0, 2)


def main():
    quotes = {}
    daily = {}
    asof = {}
    fails = []

    # 심볼별 v8 차트 조회 (간격 유지). 연속 429 면 조기 중단해 차단 악화를 막는다.
    consecutive_429 = 0
    for i, (key, sym) in enumerate(YAHOO_TICKERS.items()):
        if consecutive_429 >= 2:
            fails.append('야후: 연속 429 — 나머지 심볼 건너뜀 (잠시 후 재시도 권장)')
            break
        if i:
            time.sleep(0.9)
        try:
            price, prev = yahoo_single(sym)
            quotes[key] = round(price, 2)
            if prev:
                daily[key] = round((price / prev - 1.0) * 100.0, 2)
            consecutive_429 = 0
        except Exception as e:
            if '429' in str(e):
                consecutive_429 += 1
            fails.append('%s(%s): %s' % (key, sym, e))

    # 야후 실패분 → 네이버 금융 폴백 (당일 등락률 포함)
    for key, spec in NAVER_SOURCES.items():
        if key in quotes:
            continue
        time.sleep(0.4)
        try:
            price, rate = naver_quote(spec)
            quotes[key] = round(price, 2)
            if rate is not None:
                daily[key] = round(rate, 2)
        except Exception as e:
            fails.append('%s(네이버): %s' % (key, e))

    for key, sid in FRED_SERIES.items():
        time.sleep(1.5)  # FRED 속도 제한 회피
        try:
            vals = fred_last_two(sid)
            d, v = vals[-1]
            quotes[key] = round(float(v), 2)
            asof[key] = d
            if len(vals) > 1:
                daily[key] = round(float(v) - float(vals[-2][1]), 2)  # 금리는 %p 차이
        except Exception as e:
            fails.append('%s(%s): %s' % (key, sid, e))

    try:
        d, yoy = fred_cpi_yoy()
        quotes['cpi'] = yoy
        asof['cpi'] = d
    except Exception as e:
        fails.append('cpi(CPIAUCSL): %s' % e)

    news = []
    try:
        news = fetch_news()
    except Exception as e:
        fails.append('뉴스(구글 뉴스 RSS): %s' % e)

    # ---- 직전 성공값과 병합: 이번에 실패한 소스는 마지막 성공값을 유지 ----
    prev = {}
    try:
        with open(OUT_PATH, 'r', encoding='utf-8') as f:
            txt = f.read()
        i = txt.find('{')
        j = txt.rfind('}')
        if i >= 0 and j > i:
            prev = json.loads(txt[i:j + 1]) or {}
    except Exception:
        prev = {}

    now_iso = datetime.now(timezone.utc).isoformat(timespec='seconds')
    if quotes:
        quotes_at = now_iso
        merged_quotes = dict(prev.get('quotes') or {})
        merged_quotes.update(quotes)
        prev_daily = prev.get('daily') or {}
        same_day = str(prev.get('quotesAt', ''))[:10] == now_iso[:10]
        merged_daily = dict(prev_daily) if same_day else {}
        merged_daily.update(daily)
        merged_asof = dict(prev.get('asof') or {})
        merged_asof.update(asof)
    else:
        quotes_at = prev.get('quotesAt') or prev.get('fetchedAt')
        merged_quotes = prev.get('quotes') or {}
        merged_daily = prev.get('daily') or {}
        merged_asof = prev.get('asof') or {}
        if merged_quotes:
            print('[live] 시세 수집 실패 — 직전 성공값(%s)을 유지합니다.' % quotes_at)

    if news:
        news_at = now_iso
    else:
        news_at = prev.get('newsAt') or prev.get('fetchedAt')
        news = prev.get('news') or []
        if news:
            print('[live] 뉴스 수집 실패 — 직전 성공값(%s)을 유지합니다.' % news_at)

    if not merged_quotes and not news:
        print('[live] 모든 수집 실패 — live.js 를 갱신하지 않습니다.')
        for f in fails:
            print('   -', f)
        return 1

    payload = {
        'fetchedAt': now_iso,
        'quotesAt': quotes_at,
        'newsAt': news_at,
        'quotes': merged_quotes,
        'daily': merged_daily,
        'news': news,
        'asof': merged_asof,
        'source': 'Yahoo Finance(시세) · FRED(금리·CPI) · Google News RSS(뉴스)',
    }
    quotes = merged_quotes
    daily = merged_daily
    body = ('/* 자동 생성 파일 — update_live.py 가 갱신합니다. 직접 수정하지 마세요. */\n'
            'window.LIVE_DATA = ' + json.dumps(payload, ensure_ascii=False, indent=2) + ';\n')
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        f.write(body)

    print('[live] 지표 %d개 · 뉴스 %d건 갱신 완료 → js/live.js (%s)'
          % (len(quotes), len(news), payload['fetchedAt']))
    for k in sorted(quotes):
        print('   %-7s %-10s %s' % (k, quotes[k], ('당일 ' + str(daily[k])) if k in daily else ''))
    if fails:
        print('[live] 실패 %d건 (내장 근사치로 대체됩니다):' % len(fails))
        for f in fails:
            print('   -', f)
    return 0


if __name__ == '__main__':
    sys.exit(main())
