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

## Supabase 테이블 예시

- `treasures`: `id`, `name`, `description`, `latitude`, `longitude`, `radius_m`, `image_url`, `remaining_count`
- `treasure_logs`: `id`, `student_id`, `student_name`, `treasure_id`, `treasure_name`, `created_at`
- `current_locations`: `student_id`, `student_name`, `latitude`, `longitude`, `updated_at`
