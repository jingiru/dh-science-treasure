'use client';

import { useEffect, useState } from 'react';
import { supabase, TreasureLog } from '@/lib/supabase';

export default function TeacherPage() {
  const [pw, setPw] = useState('');
  const [ok, setOk] = useState(false);
  const [stats, setStats] = useState<{ student_name: string; student_id: string; count: number }[]>([]);
  const [logs, setLogs] = useState<TreasureLog[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  useEffect(() => {
    if (!ok) return;
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [ok]);

  async function load() {
    const { data: rawLogs } = await supabase.from('treasure_logs').select('*').order('created_at', { ascending: false }).limit(30);
    const list = (rawLogs ?? []) as TreasureLog[];
    setLogs(list);
    const map = new Map<string, { student_name: string; student_id: string; count: number }>();
    list.forEach((l) => {
      const key = `${l.student_id}-${l.student_name}`;
      const prev = map.get(key) ?? { student_id: l.student_id, student_name: l.student_name, count: 0 };
      prev.count += 1;
      map.set(key, prev);
    });
    setStats(Array.from(map.values()).sort((a, b) => b.count - a.count));

    const { data: loc } = await supabase.from('current_locations').select('*').order('updated_at', { ascending: false });
    setLocations(loc ?? []);
  }

  if (!ok) {
    return (
      <main>
        <h1>교사용 대시보드</h1>
        <div className="card">
          <input type="password" placeholder="비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button onClick={() => setOk(pw === (process.env.NEXT_PUBLIC_TEACHER_PASSWORD ?? '1234'))}>입장</button>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>교사용 대시보드</h1>
      <div className="card">
        <h3>학생별 획득 수</h3>
        {stats.map((s) => <p key={s.student_id + s.student_name}>{s.student_name}({s.student_id}): {s.count}개</p>)}
      </div>
      <div className="card">
        <h3>최근 획득 로그</h3>
        {logs.map((l) => <p key={l.id}>{new Date(l.created_at).toLocaleTimeString()} - {l.student_name}({l.student_id}) / {l.treasure_name ?? l.treasure_id}</p>)}
      </div>
      <div className="card">
        <h3>학생 위치(마지막 위치)</h3>
        {locations.map((loc, idx) => (
          <p key={`${loc.student_id}-${idx}`}>{loc.student_name}({loc.student_id}) : {loc.latitude?.toFixed?.(5)}, {loc.longitude?.toFixed?.(5)} / {loc.updated_at}</p>
        ))}
      </div>
    </main>
  );
}
