/* =====================================================
   MONEY ATLAS — 수익화 설정 (이 파일만 수정하면 됩니다)
   각 항목에 값을 채우면 사이트에 해당 기능이 자동으로 켜집니다.
   비워두면 아무것도 표시되지 않습니다.
   ===================================================== */
window.SITE_CONFIG = {

  /* 배포된 최종 주소 (예: 'https://아이디.github.io/money-atlas/')
     — SEO 태그와 사이트맵에 사용 */
  siteUrl: 'https://molahboda.github.io/money-atlas/',

  /* 후원 링크 — Buy Me a Coffee, 토스 후원 링크 등
     예: 'https://buymeacoffee.com/아이디' */
  supportLink: '',

  /* 프리미엄 출시 알림(대기명단) — 스티비 구독폼 or 구글폼 URL
     예: 'https://page.stibee.com/subscriptions/XXXXX' */
  premiumWaitlistUrl: 'https://page.stibee.com/subscriptions/506118',

  /* 구글 애널리틱스(GA4) 측정 ID — analytics.google.com 에서 발급
     예: 'G-XXXXXXXXXX' — 넣으면 방문자 통계 수집 시작 */
  gaId: 'G-WQD07SVPE1',

  /* 구글 애드센스 승인 후 발급되는 클라이언트 ID
     예: 'ca-pub-1234567890123456' */
  adsenseClient: '',

  /* (선택) 쿠팡파트너스 배너 HTML — 애드센스 승인 전 임시 수익원
     쿠팡파트너스 > 배너 만들기에서 복사한 HTML 붙여넣기 */
  coupangPartnersHtml: '',

  /* ===== 결제 (토스페이먼츠 결제위젯 — 카드·카카오페이·토스페이·네이버페이) =====
     두 값이 모두 채워지면 사이트에 "프리미엄 구매" 버튼이 자동으로 켜집니다.
     workers/README.md 의 5단계 배포 가이드를 따라 채우세요. */
  tossClientKey: '',                      /* 토스페이먼츠 클라이언트 키 (test_ck_... / live_ck_...) */
  premiumApiBase: '',                     /* 결제 서버 주소 (https://money-atlas-pay.XXX.workers.dev) */
  paymentPrice: 39000,                    /* 결제 금액(원) — workers/wrangler.toml PRICE와 일치해야 함 */
  paymentPriceOriginal: 59000,            /* 정가 표시용 */
  paymentName: '머니 아틀라스 프리미엄 1년 이용권',

  /* ===== 계정 로그인 (Supabase — 카카오·구글) =====
     두 값을 채우면 상단바에 로그인 버튼이 자동으로 켜집니다.
     supabase/README.md 의 설정 가이드를 따라 채우세요.
     (anon key는 공개용 키라 코드에 넣어도 안전합니다) */
  supabaseUrl: '',                        /* https://XXXX.supabase.co */
  supabaseAnonKey: ''
};
