'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { supabase, Treasure } from '@/lib/supabase';

type Student = { studentId: string; studentName: string };
type Coord = { latitude: number; longitude: number };
type PositionSnapshot = Coord & { accuracy: number };
type TreasureStatus = Treasure & { near: boolean; taken: boolean; distanceM: number | null; effectiveRadiusM: number; soldOut: boolean };

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
  const [pinInput, setPinInput] = useState('');
  const [treasures, setTreasures] = useState<Treasure[]>([]);
  const [myLogs, setMyLogs] = useState<string[]>([]);
  const [current, setCurrent] = useState<Coord | null>(null);
  const [currentAccuracy, setCurrentAccuracy] = useState<number | null>(null);
  const [myTreasureNames, setMyTreasureNames] = useState<string[]>([]);
  const [locationNotice, setLocationNotice] = useState('');
  const [supabaseErrorMessage, setSupabaseErrorMessage] = useState('');
  const [selected, setSelected] = useState<TreasureStatus | null>(null);
  const [message, setMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedRef = useRef<PositionSnapshot | null>(null);
  const lastSavedAtRef = useRef<number>(0);

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
    if (!window.isSecureContext || location.protocol !== 'https:') {
      setLocationNotice('위치 기능은 HTTPS 환경에서만 안정적으로 동작합니다. Vercel 배포 주소(https)에서 이용해주세요.');
      return;
    }
    if (!navigator.geolocation) {
      setLocationNotice('이 브라우저는 위치 서비스를 지원하지 않습니다.');
      return;
    }

    setLocationNotice('');
    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setCurrent(loc);
        setCurrentAccuracy(pos.coords.accuracy);

        if (pos.coords.accuracy > 100) {
          setLocationNotice('위치 정확도가 낮아 보물 판정이 넓게 적용될 수 있습니다.');
        }

        const now = Date.now();
        if (now - lastSavedAtRef.current < 30000) {
          return;
        }

        const previous = lastSavedRef.current;
        if (previous && distanceMeter(previous, loc) < 5) {
          return;
        }

        const { error } = await supabase.from('current_locations').upsert({
          student_id: student.studentId,
          student_name: student.studentName,
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy_m: pos.coords.accuracy,
          updated_at: new Date().toISOString()
        }, { onConflict: 'student_id' });

        if (error) {
          console.error('current_locations upsert error:', error);
          setLocationNotice('위치 저장 중 오류가 발생했습니다.');
          setSupabaseErrorMessage(`위치 저장 실패: ${error.message}`);
          return;
        }

        lastSavedRef.current = { ...loc, accuracy: pos.coords.accuracy };
        lastSavedAtRef.current = now;
        if (pos.coords.accuracy <= 100) {
          setLocationNotice('');
        }
        setSupabaseErrorMessage('');
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [student]);

  const statusList = useMemo<TreasureStatus[]>(() => {
    return treasures.map((t) => {
      const distanceM = current
        ? distanceMeter(current, { latitude: t.latitude, longitude: t.longitude })
        : null;
      const effectiveRadiusM = currentAccuracy
        ? Math.min(100, Math.max(t.radius_m, currentAccuracy * 0.7))
        : t.radius_m;
      const near = distanceM !== null ? distanceM <= effectiveRadiusM : false;
      const taken = myLogs.includes(String(t.id));
      return { ...t, near, taken, distanceM, effectiveRadiusM, soldOut: t.remaining_count <= 0 };
    });
  }, [treasures, current, currentAccuracy, myLogs]);

  async function fetchTreasures() {
    const { data, error } = await supabase.from('treasures').select('*').order('order_index', { ascending: true });
    if (error) {
      console.error('treasures select error:', error);
      setMessage(`보물 목록 조회 오류: ${error.message}`);
      return;
    }
    setTreasures((data ?? []) as Treasure[]);
  }

  async function fetchMyLogs(studentId: string) {
    const { data, error } = await supabase.from('treasure_logs').select('treasure_id, treasure_name').eq('student_id', studentId);
    if (error) {
      console.error('treasure_logs select error:', error);
      setMessage(`내 획득 기록 조회 오류: ${error.message}`);
      return;
    }
    const logs = data ?? [];
    setMyLogs(logs.map((v) => String(v.treasure_id)));
    setMyTreasureNames(logs.map((v) => v.treasure_name as string).filter(Boolean));
  }

  async function login() {
    if (!/^\d{4}$/.test(idInput)) {
      setMessage('학번은 숫자 4자리로 입력해주세요.');
      return;
    }
    if (nameInput.trim().length < 1) {
      setMessage('이름을 1글자 이상 입력해주세요.');
      return;
    }
    if (!/^\d{4}$/.test(pinInput)) {
      setMessage('비밀번호는 숫자 4자리로 입력해주세요.');
      return;
    }
    const s = { studentId: idInput, studentName: nameInput.trim() };

    const { data, error } = await supabase.rpc('login_or_register_student', {
      p_student_id: s.studentId,
      p_student_name: s.studentName,
      p_pin: pinInput,
    });

    if (error) {
      console.error('login_or_register_student rpc error:', error);
      setMessage(error.message);
      return;
    }

    const result = Array.isArray(data) ? data[0] : null;
    if (!result?.ok) {
      setMessage(result?.message ?? '로그인에 실패했습니다.');
      return;
    }

    setStudent(s);
    localStorage.setItem('dh-student', JSON.stringify(s));
    setPinInput('');
    setMessage('로그인되었습니다.');
  }

  async function openCamera(t: TreasureStatus) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setSelected(t);
      setSupabaseErrorMessage('');
    } catch (error) {
      console.error('camera open error:', error);
      setMessage('카메라 권한이 필요합니다.');
    }
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
      .eq('treasure_id', String(selected.id))
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

    const { error: insertError } = await supabase.from('treasure_logs').insert({
      student_id: student.studentId,
      student_name: student.studentName,
      treasure_id: String(selected.id),
      treasure_name: target.name,
      latitude: current?.latitude ?? selected.latitude,
      longitude: current?.longitude ?? selected.longitude,
      created_at: new Date().toISOString()
    });
    if (insertError) {
      console.error('treasure_logs insert error:', insertError);
      setMessage(insertError.message);
      return;
    }

    if (target.remaining_count < 999) {
      const { error: updateError } = await supabase
        .from('treasures')
        .update({ remaining_count: target.remaining_count - 1 })
        .eq('id', selected.id)
        .gt('remaining_count', 0);
      if (updateError) {
        console.error('treasures update error:', updateError);
        setMessage(updateError.message);
      }
    }

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
          <input placeholder="학번 4자리" maxLength={4} value={idInput} onChange={(e) => setIdInput(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          <input placeholder="이름" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
          <input
            type="password"
            inputMode="numeric"
            placeholder="비밀번호 숫자 4자리"
            maxLength={4}
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <p className="small">처음 로그인할 때 입력한 숫자 4자리가 비밀번호로 등록됩니다.</p>
          <p className="small">비밀번호를 잘 기억하세요.</p>
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
        {!!locationNotice && <p className="small">{locationNotice}</p>}
        {!!supabaseErrorMessage && <p className="small">{supabaseErrorMessage}</p>}
        <p className="small">※ 앱이 백그라운드 상태이거나 화면이 꺼지면 위치 갱신이 일시 중단될 수 있습니다.</p>
      </div>

      <h3>보물 목록</h3>
      {statusList.map((t) => (
        <div key={t.id} className="card">
          <div className="row"><strong>{t.name}</strong>{t.near ? <span className="badge badge-ok">탐색 가능</span> : <span className="badge badge-no">이동 필요</span>}</div>
          <p>{t.description}</p>
          <p className="small">현재 거리: {t.distanceM !== null ? `${Math.round(t.distanceM)} m` : '측정 중'}</p>
          <p className="small">판정 반경: {Math.round(t.effectiveRadiusM)} m</p>
          <p className="small">잔여 수량: {t.remaining_count}</p>
          <button disabled={!t.near || t.taken || t.soldOut} onClick={() => openCamera(t)}>
            {t.taken ? '이미 획득' : t.soldOut ? '품절' : '카메라로 찾기'}
          </button>
        </div>
      ))}

      <div className="card">
        <h3>내 현황</h3>
        <p>획득 개수: {myLogs.length}개</p>
        <p className="small">획득 보물 이름: {myTreasureNames.join(', ') || '없음'}</p>
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
