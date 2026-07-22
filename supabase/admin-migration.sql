-- 머니 아틀라스 — 관리자 시스템 마이그레이션
-- 관리자: hansikgu.app@gmail.com (RLS로 서버 강제)

-- 1) profiles에 이메일·이름 컬럼
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists updated_at timestamptz default now();

-- 2) 관리자 전체 접근 정책 (기존 "own profile" 정책과 OR로 결합됨)
drop policy if exists "admin all profiles" on public.profiles;
create policy "admin all profiles" on public.profiles
  for all
  using ((auth.jwt() ->> 'email') = 'hansikgu.app@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'hansikgu.app@gmail.com');

-- 3) 문의 테이블
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  message text not null,
  handled boolean default false
);
alter table public.inquiries enable row level security;

-- 누구나(익명 포함) 문의 작성 가능
drop policy if exists "anyone insert inquiry" on public.inquiries;
create policy "anyone insert inquiry" on public.inquiries
  for insert to anon, authenticated
  with check (true);

-- 관리자만 조회·수정
drop policy if exists "admin read inquiries" on public.inquiries;
create policy "admin read inquiries" on public.inquiries
  for select
  using ((auth.jwt() ->> 'email') = 'hansikgu.app@gmail.com');

drop policy if exists "admin update inquiries" on public.inquiries;
create policy "admin update inquiries" on public.inquiries
  for update
  using ((auth.jwt() ->> 'email') = 'hansikgu.app@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'hansikgu.app@gmail.com');
