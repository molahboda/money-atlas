# 계정 로그인 설정 가이드 (Supabase — 카카오·구글)

## 1. Supabase 프로젝트 (5분)
1. https://supabase.com 가입 (GitHub 계정으로 가능) → New Project (이름: money-atlas, 리전: Northeast Asia Seoul)
2. Project Settings → API 에서 두 값을 복사 → 사이트 `js/config.js`에 입력:
   - `supabaseUrl`: Project URL (https://XXXX.supabase.co)
   - `supabaseAnonKey`: anon public 키
3. Authentication → URL Configuration:
   - Site URL: `https://molahboda.github.io/money-atlas/`
   - Redirect URLs 에 같은 주소 추가 (로컬 테스트용 `http://localhost:8741` 도 추가)

## 2. 프로필 테이블 (SQL Editor에 붙여넣고 Run)
```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  credits int not null default 8,
  unlocked jsonb not null default '[]',
  premium_until timestamptz,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);
```

## 3. 카카오 로그인
1. https://developers.kakao.com → 애플리케이션 추가 (이름: 머니 아틀라스)
2. [제품 설정 → 카카오 로그인] 활성화 ON
3. Redirect URI 등록: Supabase 대시보드 Authentication → Providers → Kakao 에 표시된
   `https://XXXX.supabase.co/auth/v1/callback` 주소를 그대로 붙여넣기
4. [동의항목] 닉네임·이메일 동의 설정 (이메일은 비즈 앱 전환 필요할 수 있음 — 선택 동의로 시작 가능)
5. 앱 키의 **REST API 키**와 [보안]의 **Client Secret**(발급+활성화)을
   Supabase → Authentication → Providers → Kakao 에 입력하고 Enable

## 4. 구글 로그인
1. https://console.cloud.google.com → 새 프로젝트 → API 및 서비스 → OAuth 동의 화면(외부, 앱 이름·이메일만) 
2. 사용자 인증 정보 → OAuth 클라이언트 ID (웹 애플리케이션):
   - 승인된 리디렉션 URI: `https://XXXX.supabase.co/auth/v1/callback`
3. 클라이언트 ID·보안 비밀을 Supabase → Providers → Google 에 입력하고 Enable

완료 후 `js/config.js` 두 값만 채워 배포하면 로그인 버튼이 자동으로 켜집니다.
