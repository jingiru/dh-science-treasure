import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('Supabase 환경변수가 설정되지 않았습니다.');
}

export const supabase = createClient(url ?? '', anonKey ?? '');

export type Treasure = {
  id: number;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  image_url: string;
  remaining_count: number;
};

export type TreasureLog = {
  id: number;
  student_id: string;
  student_name: string;
  treasure_id: number;
  treasure_name?: string;
  created_at: string;
};
