# dh-science-treasure

대전동화중 국립중앙과학관 보물찾기 MVP입니다.

## 실행 방법

1. 의존성 설치
```bash
npm install
```
2. 환경변수 설정 (`.env.local`)
```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_TEACHER_PASSWORD=1234
```
3. 실행
```bash
npm run dev
```

## Supabase SQL 예시

```sql
create table if not exists public.students (
  student_id text primary key,
  student_name text not null,
  created_at timestamptz default now(),
  last_login_at timestamptz default now()
);

create table if not exists public.current_locations (
  student_id text primary key,
  student_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  updated_at timestamptz default now()
);
```

## RLS 테스트용 정책 예시

```sql
alter table public.students enable row level security;
alter table public.current_locations enable row level security;

create policy "students_select_test"
on public.students
for select
to anon
using (true);

create policy "students_insert_test"
on public.students
for insert
to anon
with check (true);

create policy "students_update_test"
on public.students
for update
to anon
using (true)
with check (true);

create policy "locations_select_test"
on public.current_locations
for select
to anon
using (true);

create policy "locations_insert_test"
on public.current_locations
for insert
to anon
with check (true);

create policy "locations_update_test"
on public.current_locations
for update
to anon
using (true)
with check (true);
```

## 기존 테이블

- `treasures`: `id`, `name`, `description`, `latitude`, `longitude`, `radius_m`, `image_url`, `remaining_count`
- `treasure_logs`: `id`, `student_id`, `student_name`, `treasure_id`, `treasure_name`, `created_at`
