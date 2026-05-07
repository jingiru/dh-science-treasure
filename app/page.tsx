'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, Treasure } from '@/lib/supabase';

type Student = { studentId: string; studentName: string };
type Coord = { latitude: number; longitude: number };
type PositionSnapshot = Coord & { accuracy: number };
type SignalLevel = 'collected' | 'available' | 'hot' | 'warm' | 'weak' | 'cold';
type TreasureStatus = Treasure & { taken: boolean; signal: SignalLevel; soldOut: boolean };

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
  const [locationNotice, setLocationNotice] = useState('');
  const [supabaseErrorMessage, setSupabaseErrorMessage] = useState('');
  const [selected, setSelected] = useState<TreasureStatus | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [overlayImageError, setOverlayImageError] = useState(false);
  const [cameraPlaybackError, setCameraPlaybackError] = useState('');
  const [message, setMessage] = useState('');
  const [isRefreshingLocation, setIsRefreshingLocation] = useState(false);
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

  async function saveCurrentLocation(studentInfo: Student, pos: GeolocationPosition) {
    const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    const accuracy = pos.coords.accuracy;

    setCurrent(loc);
    setCurrentAccuracy(accuracy);

    const { error } = await supabase.from('current_locations').upsert({
      student_id: studentInfo.studentId,
      student_name: studentInfo.studentName,
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy_m: accuracy,
      updated_at: new Date().toISOString()
    }, { onConflict: 'student_id' });

    if (error) {
      console.error('current_locations upsert error:', error);
      throw error;
    }

    lastSavedRef.current = { ...loc, accuracy };
    lastSavedAtRef.current = Date.now();
  }

  async function manualRefreshLocation() {
    if (!student || !navigator.geolocation || isRefreshingLocation) return;

    setIsRefreshingLocation(true);
    setMessage('');

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 10000
        });
      });

      await saveCurrentLocation(student, pos);
      if (pos.coords.accuracy > 100) {
        setLocationNotice('위치 신호가 약합니다. 잠시 멈춰서 다시 확인해보세요.');
      } else {
        setLocationNotice('');
      }
      setSupabaseErrorMessage('');
      setMessage('보물 신호가 갱신되었습니다.');
    } catch (error) {
      console.error('manual location refresh error:', error);
      setMessage('위치 정보를 갱신하지 못했습니다. 위치 권한을 확인해주세요.');
    } finally {
      setIsRefreshingLocation(false);
    }
  }

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
        const now = Date.now();
        const previous = lastSavedRef.current;

        setCurrent(loc);
        setCurrentAccuracy(pos.coords.accuracy);

        if (pos.coords.accuracy > 100) {
          setLocationNotice('위치 신호가 약합니다. 잠시 멈춰서 다시 확인해보세요.');
        }

        if (now - lastSavedAtRef.current < 30000) return;
        if (previous && distanceMeter(previous, loc) < 5) return;

        try {
          await saveCurrentLocation(student, pos);
          if (pos.coords.accuracy <= 100) {
            setLocationNotice('');
          }
          setSupabaseErrorMessage('');
        } catch (error) {
          const upsertError = error as Error;
          setLocationNotice('위치 저장 중 오류가 발생했습니다.');
          setSupabaseErrorMessage(`위치 저장 실패: ${upsertError.message}`);
        }
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocationNotice('위치 권한을 허용해주세요.');
          return;
        }
        setLocationNotice('위치 신호를 확인하는 중입니다.');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [student]);


  useEffect(() => {
    if (!selected) {
      setOverlayImageError(false);
      setCameraPlaybackError('');
    }
  }, [selected]);

  useEffect(() => {
    if (!selected || !cameraStream || !videoRef.current) return;

    const video = videoRef.current;
    video.srcObject = cameraStream;
    video.play().catch((error) => {
      console.error('camera play error:', error);
      setCameraPlaybackError('카메라 재생을 시작하지 못했습니다. 화면을 한 번 터치해보세요.');
    });
  }, [selected, cameraStream]);

  useEffect(() => {
    if (selected) return;
    if (!cameraStream) return;

    cameraStream.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
  }, [selected, cameraStream]);

  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraStream]);

  const statusList = useMemo<TreasureStatus[]>(() => {
    return treasures.map((t) => {
      const distanceM = current
        ? distanceMeter(current, { latitude: t.latitude, longitude: t.longitude })
        : null;
      const effectiveRadiusM = currentAccuracy
        ? Math.min(100, Math.max(t.radius_m, currentAccuracy * 0.7))
        : t.radius_m;
      const taken = myLogs.includes(String(t.id));
      let signal: SignalLevel = 'cold';
      if (taken) {
        signal = 'collected';
      } else if (distanceM !== null) {
        if (distanceM <= effectiveRadiusM) signal = 'available';
        else if (distanceM <= effectiveRadiusM * 1.6) signal = 'hot';
        else if (distanceM <= effectiveRadiusM * 2.4) signal = 'warm';
        else if (distanceM <= effectiveRadiusM * 3.2) signal = 'weak';
      }
      return { ...t, taken, signal, soldOut: t.remaining_count <= 0 };
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
    if (t.taken) {
      setMessage('이미 획득한 보물입니다.');
      return;
    }
    if (t.signal !== 'available' || t.soldOut) {
      return;
    }

    setSelected(t);
    setOverlayImageError(false);
    setCameraPlaybackError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      setCameraStream(stream);
      setSupabaseErrorMessage('');
    } catch (error) {
      console.error('camera open error:', error);
      setSelected(null);
      setCameraStream(null);
      setMessage('카메라 권한이 필요합니다.');
    }
  }

  function closeCamera() {
    cameraStream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraStream(null);
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
        <div className="row"><strong>{student.studentName} ({student.studentId})</strong><div className="student-actions"><button className="mini-button mini-button--secondary" onClick={manualRefreshLocation} disabled={isRefreshingLocation}>{isRefreshingLocation ? '갱신 중...' : '새로고침'}</button><button className="mini-button" onClick={() => { localStorage.removeItem('dh-student'); setStudent(null); }}>로그아웃</button></div></div>
        {!current && <p className="small">위치 신호를 확인하는 중입니다.</p>}
        {!!locationNotice && <p className="small">{locationNotice}</p>}
        {!!supabaseErrorMessage && <p className="small">{supabaseErrorMessage}</p>}
        <div className="compact-notice">
          <p className="small">보물 신호는 이동하면서 자동으로 바뀝니다.</p>
          <p className="small">새로고침 버튼을 누르면 위치 정보가 바로 갱신됩니다.</p>
          <p className="small">건물 안이나 이동 중에는 신호가 늦게 바뀔 수 있습니다.</p>
        </div>

        <section className="signal-guide">
          <h3 className="signal-guide__title">보물 신호 안내</h3>
          <div className="signal-legend">
            <span className="signal-legend__item"><span className="signal-dot signal-dot--cold" aria-hidden />반경 밖</span>
            <span className="signal-legend__item"><span className="signal-dot signal-dot--weak" aria-hidden />100m</span>
            <span className="signal-legend__item"><span className="signal-dot signal-dot--warm" aria-hidden />70m</span>
            <span className="signal-legend__item"><span className="signal-dot signal-dot--hot" aria-hidden />50m</span>
            <span className="signal-legend__item"><span className="signal-dot signal-dot--available" aria-hidden />30m(획득 가능)</span>
            <span className="signal-legend__item"><span className="signal-dot signal-dot--collected" aria-hidden />완료</span>
          </div>
          <p className="small signal-guide__note">GPS 상태에 따라 실제 반응 범위는 조금 달라질 수 있습니다.</p>
        </section>
      </div>

      <div className="card">
        <h3>획득한 보물 {myLogs.length} / 16</h3>
        <div className="treasure-grid">
          {statusList.map((t, index) => {
            const disabled = t.signal !== 'available' || t.taken || t.soldOut;
            return (
              <button
                key={t.id}
                type="button"
                className={`treasure-icon treasure-icon--${t.signal}`}
                onClick={() => openCamera(t)}
                disabled={disabled}
                aria-label={`보물 ${index + 1}`}
              >
                <span className="treasure-icon__number">{index + 1}</span>
                {t.taken && <span className="treasure-icon__check">✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="card">
          <h3>카메라 탐색</h3>
          <div className="video-wrap">
            <video ref={videoRef} muted playsInline autoPlay />
            {overlayImageError ? (
              <button type="button" className="overlay-treasure" onClick={collectTreasure} aria-label={`${selected.name} 기본 보물`}>
                🎁
              </button>
            ) : (
              <img
                src={selected.image_url}
                alt={selected.name}
                className="overlay-treasure"
                onClick={collectTreasure}
                onError={() => setOverlayImageError(true)}
              />
            )}
          </div>
          <p className="small">화면의 보물 이미지를 터치하면 획득됩니다.</p>
          {!!cameraPlaybackError && <p className="small">{cameraPlaybackError}</p>}
          <button onClick={closeCamera}>닫기</button>
        </div>
      )}

      {!!message && <p className="small">{message}</p>}
    </main>
  );
}
