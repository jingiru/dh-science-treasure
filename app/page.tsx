'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { supabase, Treasure } from '@/lib/supabase';

type Student = { studentId: string; studentName: string };
type Coord = { latitude: number; longitude: number };

function distanceMeter(a: Coord, b: Coord) {
  const R = 6371e3;
  const p1 = (a.latitude * Math.PI) / 180;
  const p2 = (b.latitude * Math.PI) / 180;
  const dp = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dl = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

export default function Home() {
  const [student, setStudent] = useState<Student | null>(null);
  const [idInput, setIdInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [treasures, setTreasures] = useState<Treasure[]>([]);
  const [myLogs, setMyLogs] = useState<number[]>([]);
  const [current, setCurrent] = useState<Coord | null>(null);
  const [selected, setSelected] = useState<Treasure | null>(null);
  const [message, setMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const raw = localStorage.getItem('dh-student');
    if (raw) setStudent(JSON.parse(raw));
  }, []);

  useEffect(() => {
    if (!student) return;
    fetchTreasures();
    fetchMyLogs(student.studentId);
  }, [student]);

  useEffect(() => {
    if (!student) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setCurrent(loc);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [student]);

  useEffect(() => {
    if (!student || !current) return;
    const timer = setInterval(async () => {
      await supabase.from('current_locations').upsert({
        student_id: student.studentId,
        student_name: student.studentName,
        latitude: current.latitude,
        longitude: current.longitude,
        updated_at: new Date().toISOString()
      });
    }, 30000);
    return () => clearInterval(timer);
  }, [student, current]);

  const statusList = useMemo(() => {
    return treasures.map((t) => {
      const near = current
        ? distanceMeter(current, { latitude: t.latitude, longitude: t.longitude }) <= t.radius_m
        : false;
      const taken = myLogs.includes(t.id);
      return { ...t, near, taken, soldOut: t.remaining_count <= 0 };
    });
  }, [treasures, current, myLogs]);

  async function fetchTreasures() {
    const { data } = await supabase.from('treasures').select('*').order('id');
    setTreasures((data ?? []) as Treasure[]);
  }

  async function fetchMyLogs(studentId: string) {
    const { data } = await supabase.from('treasure_logs').select('treasure_id').eq('student_id', studentId);
    setMyLogs((data ?? []).map((v) => v.treasure_id as number));
  }

  async function login() {
    if (!/^\d{4}$/.test(idInput) || nameInput.trim().length < 1) {
      setMessage('학번 4자리와 이름을 정확히 입력해주세요.');
      return;
    }
    const s = { studentId: idInput, studentName: nameInput.trim() };
    setStudent(s);
    localStorage.setItem('dh-student', JSON.stringify(s));
    setMessage('로그인되었습니다.');
  }

  async function openCamera(t: Treasure) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    setSelected(t);
  }

  function closeCamera() {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    setSelected(null);
  }

  async function collectTreasure() {
    if (!student || !selected) return;

    const { data: already } = await supabase
      .from('treasure_logs')
      .select('id')
      .eq('student_id', student.studentId)
      .eq('treasure_id', selected.id)
      .maybeSingle();
    if (already) {
      setMessage('이미 획득한 보물입니다.');
      closeCamera();
      return;
    }

    const { data: target } = await supabase.from('treasures').select('remaining_count,name').eq('id', selected.id).maybeSingle();
    if (!target || target.remaining_count <= 0) {
      setMessage('잔여 수량이 없어 획득할 수 없습니다.');
      closeCamera();
      return;
    }

    await supabase.from('treasure_logs').insert({
      student_id: student.studentId,
      student_name: student.studentName,
      treasure_id: selected.id,
      treasure_name: target.name
    });

    await supabase
      .from('treasures')
      .update({ remaining_count: target.remaining_count - 1 })
      .eq('id', selected.id)
      .gt('remaining_count', 0);

    setMessage(`${target.name} 획득 성공!`);
    closeCamera();
    fetchTreasures();
    fetchMyLogs(student.studentId);
  }

  if (!student) {
    return (
      <main>
        <h1>대전동화중 과학관 보물찾기</h1>
        <div className="card">
          <input placeholder="학번 4자리" maxLength={4} value={idInput} onChange={(e) => setIdInput(e.target.value)} />
          <input placeholder="이름" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
          <button onClick={login}>로그인</button>
          <p className="small">{message}</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>보물찾기</h1>
      <div className="card">
        <div className="row"><strong>{student.studentName} ({student.studentId})</strong><button onClick={() => { localStorage.removeItem('dh-student'); setStudent(null); }} style={{ width: 80, padding: 8 }}>로그아웃</button></div>
        <p className="small">현재 위치: {current ? `${current.latitude.toFixed(5)}, ${current.longitude.toFixed(5)}` : '확인 중'}</p>
      </div>

      <h3>보물 목록</h3>
      {statusList.map((t) => (
        <div key={t.id} className="card">
          <div className="row"><strong>{t.name}</strong>{t.near ? <span className="badge badge-ok">탐색 가능</span> : <span className="badge badge-no">이동 필요</span>}</div>
          <p>{t.description}</p>
          <p className="small">잔여 수량: {t.remaining_count}</p>
          <button disabled={!t.near || t.taken || t.soldOut} onClick={() => openCamera(t)}>
            {t.taken ? '이미 획득' : t.soldOut ? '품절' : '카메라 탐색 시작'}
          </button>
        </div>
      ))}

      <div className="card">
        <h3>내 현황</h3>
        <p>획득 개수: {myLogs.length}개</p>
        <p className="small">획득 보물 ID: {myLogs.join(', ') || '없음'}</p>
      </div>

      {selected && (
        <div className="card">
          <h3>카메라 탐색: {selected.name}</h3>
          <div className="video-wrap">
            <video ref={videoRef} muted playsInline />
            <Image src={selected.image_url} alt={selected.name} width={220} height={220} className="overlay-treasure" onClick={collectTreasure} />
          </div>
          <p className="small">화면의 보물 이미지를 터치하면 획득됩니다.</p>
          <button onClick={closeCamera}>닫기</button>
        </div>
      )}

      {!!message && <p className="small">{message}</p>}
    </main>
  );
}
