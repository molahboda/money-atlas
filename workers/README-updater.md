# 갱신 스케줄러 배포 (Cloudflare Workers Cron · 무료)

GitHub Actions 크론(불안정·정시 미보장)을 대체합니다.
15분마다 Cloudflare가 정시에 뉴스·시세를 수집해 `js/live.js`를 GitHub에 커밋합니다.

## 준비물
1. **Cloudflare 계정** — https://dash.cloudflare.com/sign-up (무료, 카드 불필요)
2. **GitHub 토큰 (Fine-grained PAT)** — https://github.com/settings/tokens?type=beta
   - Repository access: **Only select repositories → molahboda/money-atlas**
   - Permissions: **Contents → Read and write** (이것만)
   - 생성된 `github_pat_...` 토큰 복사 (한 번만 표시됨)

## 배포 (이 workers 폴더에서)
```bash
# 1. 로그인 (브라우저 열림)
npx wrangler login

# 2. GitHub 토큰 등록 (프롬프트에 붙여넣기 — 화면에 안 남음)
npx wrangler secret put GH_TOKEN --config wrangler-updater.toml

# 3. 배포 (Cron 트리거 자동 등록됨)
npx wrangler deploy --config wrangler-updater.toml
# → https://money-atlas-updater.<계정>.workers.dev 출력됨

# 4. 즉시 테스트: 위 주소 + /run 접속
#    → {"committed":true,"quotes":8,"news":10} 나오면 성공
#    (GitHub에 "chore: 실시간 데이터 갱신 (Cloudflare)" 커밋 생김)
```

## GitHub Actions 크론 끄기 (중복 방지)
Cloudflare가 갱신을 맡으므로, GitHub Actions 스케줄은 꺼둡니다:
`.github/workflows/update-live.yml`의 `schedule:` 블록을 주석 처리하거나
workflow_dispatch(수동)만 남기면 됩니다. (백업으로 남겨둬도 무방)

## 참고
- Cloudflare 무료 티어: 하루 10만 요청 · Cron 포함. 우리 사용량(하루 96회)은 0.1% → 사실상 영구 무료.
- 뉴스만 수집(구글 RSS)·시세는 야후. 미국 금리·CPI(FRED)는 이 Worker에 없음 —
  기존 내장 근사치 사용. FRED가 필요하면 나중에 Worker에 추가 가능.
- 로그: `npx wrangler tail --config wrangler-updater.toml` 로 실시간 확인.
