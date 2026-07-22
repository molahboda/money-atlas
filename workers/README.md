# 결제 서버 배포 가이드 (Cloudflare Workers · 무료)

머니 아틀라스의 결제 승인·라이선스 발급 서버입니다. 5개 명령이면 끝납니다.

## 준비물
1. **Cloudflare 계정** — https://dash.cloudflare.com/sign-up (무료)
2. **토스페이먼츠 키 2개** — https://developers.tosspayments.com 가입 → 내 개발정보
   - 클라이언트 키(`test_ck_...` / 실계약 후 `live_ck_...`) → 사이트 `js/config.js`의 `tossClientKey`
   - 시크릿 키(`test_sk_...` / `live_sk_...`) → 아래 3단계에서 서버에만 등록 (절대 코드/채팅에 붙여넣지 말 것)

## 배포 (이 폴더에서)
```bash
# 1. 로그인 (브라우저 열림)
npx wrangler login

# 2. 라이선스 저장소(KV) 생성 → 출력된 id를 wrangler.toml의 REPLACE_AFTER_CREATE에 붙여넣기
npx wrangler kv namespace create LICENSES

# 3. 토스페이먼츠 시크릿 키 등록 (입력 프롬프트에 직접 붙여넣기 — 화면에 안 남음)
npx wrangler secret put TOSS_SECRET_KEY

# 4. 배포
npx wrangler deploy
# → https://money-atlas-pay.<계정>.workers.dev 주소가 출력됨

# 5. 사이트 연결: js/config.js 에
#    tossClientKey: '클라이언트 키',
#    premiumApiBase: 'https://money-atlas-pay.<계정>.workers.dev'
```

## 테스트 → 실결제 전환
- `test_` 키로는 실제 돈이 나가지 않는 테스트 결제가 됩니다 (카드번호 아무거나 4242... 등 토스 문서의 테스트 수단).
- 실결제: 토스페이먼츠 **가맹점 심사**(사업자등록증·통신판매업신고증·사업자 통장) 통과 후 발급되는 `live_` 키 2개로 교체 + `wrangler secret put` 재실행 + `wrangler deploy`.
- 가격 변경: `wrangler.toml`의 `PRICE` 수정 후 재배포 (사이트 `config.js`의 `paymentPrice`도 동일하게).
