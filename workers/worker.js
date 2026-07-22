/* =====================================================
   MONEY ATLAS — 결제 승인·라이선스 서버 (Cloudflare Workers)

   엔드포인트
   - POST /confirm  { paymentKey, orderId, amount }
       토스페이먼츠 결제 승인 → 라이선스 키 발급(KV 저장, 1년)
   - POST /validate { licenseKey }
       라이선스 유효성 확인 → { valid, expiresAt }

   환경변수(시크릿):  TOSS_SECRET_KEY   토스페이먼츠 시크릿 키
   환경변수(일반):    PRICE             결제 금액(원), 기본 39000
                      ALLOW_ORIGIN      허용 도메인
   KV 바인딩:         LICENSES
   ===================================================== */

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || 'https://molahboda.github.io',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors(env)),
  });
}

function makeLicenseKey() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 문자(I,L,O,0,1) 제외
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += abc[buf[i] % abc.length];
    if (i % 4 === 3 && i < 11) s += '-';
  }
  return 'MA-' + s;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }
    if (request.method !== 'POST') {
      return json(env, 405, { error: 'method not allowed' });
    }
    const url = new URL(request.url);
    let body;
    try { body = await request.json(); } catch (e) {
      return json(env, 400, { error: 'invalid json' });
    }

    /* ---------- 결제 승인 → 라이선스 발급 ---------- */
    if (url.pathname === '/confirm') {
      const { paymentKey, orderId, amount } = body || {};
      if (!paymentKey || !orderId || !amount) {
        return json(env, 400, { error: 'missing params' });
      }
      const expected = parseInt(env.PRICE || '39000', 10);
      if (parseInt(amount, 10) !== expected) {
        return json(env, 400, { error: 'amount mismatch' }); // 금액 위변조 차단
      }
      if (!env.TOSS_SECRET_KEY) {
        return json(env, 500, { error: 'server not configured' });
      }
      /* 중복 승인 방지 */
      const dup = await env.LICENSES.get('order:' + orderId);
      if (dup) return json(env, 200, JSON.parse(dup));

      const auth = 'Basic ' + btoa(env.TOSS_SECRET_KEY + ':');
      const res = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
        method: 'POST',
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentKey, orderId, amount: expected }),
      });
      const pay = await res.json();
      if (!res.ok) {
        return json(env, 402, { error: pay.message || '결제 승인 실패', code: pay.code });
      }

      const licenseKey = makeLicenseKey();
      const record = {
        licenseKey,
        orderId,
        method: pay.method || '',
        approvedAt: pay.approvedAt || new Date().toISOString(),
        expiresAt: new Date(Date.now() + 366 * 24 * 3600 * 1000).toISOString(),
      };
      await env.LICENSES.put('key:' + licenseKey, JSON.stringify(record));
      await env.LICENSES.put('order:' + orderId, JSON.stringify({ licenseKey, expiresAt: record.expiresAt }));
      return json(env, 200, { licenseKey, expiresAt: record.expiresAt });
    }

    /* ---------- 라이선스 검증 ---------- */
    if (url.pathname === '/validate') {
      const { licenseKey } = body || {};
      if (!licenseKey) return json(env, 400, { error: 'missing licenseKey' });
      const raw = await env.LICENSES.get('key:' + String(licenseKey).trim().toUpperCase());
      if (!raw) return json(env, 200, { valid: false });
      const rec = JSON.parse(raw);
      const valid = new Date(rec.expiresAt).getTime() > Date.now();
      return json(env, 200, { valid, expiresAt: rec.expiresAt });
    }

    return json(env, 404, { error: 'not found' });
  },
};
