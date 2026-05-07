'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, TreasureLog } from '@/lib/supabase';

const TEACHER_AUTH_STORAGE_KEY = 'dh-teacher-auth';
const DEFAULT_CENTER = { lat: 36.375508, lng: 127.375847 };
const TOP_LIMIT = 15;

type StudentLocation = {
  student_id: string;
  latitude: number;
  longitude: number;
  accuracy_m?: number | null;
  student_name: string;
  updated_at: string;
};

type StudentLogin = {
  student_id: string;
  student_name: string;
  last_login_at?: string | null;
};

type Treasure = {
  id: string;
  name: string;
  order_index: number;
  radius_m: number;
  latitude: number;
  longitude: number;
};

declare global {
  interface Window { kakao?: any }
}

export default function TeacherPage() {
  const [pw, setPw] = useState('');
  const [ok, setOk] = useState(false);
  const [logs, setLogs] = useState<TreasureLog[]>([]);
  const [locations, setLocations] = useState<StudentLocation[]>([]);
  const [students, setStudents] = useState<StudentLogin[]>([]);
  const [stats, setStats] = useState<{ student_name: string; student_id: string; count: number; updated_at?: string | null; accuracy_m?: number | null }[]>([]);
  const [treasures, setTreasures] = useState<Treasure[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedClass, setSelectedClass] = useState('전체');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAllStats, setShowAllStats] = useState(false);
  const [showAllMissingLocations, setShowAllMissingLocations] = useState(false);

  const mapRef = useRef<any>(null);
  const clustererRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const locationsRef = useRef<StudentLocation[]>([]);
  const markerStateRef = useRef<Map<string, { marker: any; infoWindow: any; nameLabelOverlay?: any }>>(new Map());
  const treasureStateRef = useRef<{ markers: any[]; overlays: any[]; infoWindows: any[] }>({ markers: [], overlays: [], infoWindows: [] });
  const openedInfoWindowRef = useRef<any>(null);

  const classes = ['전체', ...Array.from({ length: 9 }, (_, i) => `${i + 1}반`)];

  const classOf = (studentId?: string) => studentId?.[1] ?? '';
  const byClass = (studentId: string) => selectedClass === '전체' || classOf(studentId) === selectedClass[0];
  const bySearch = (studentId: string, name: string) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return studentId.toLowerCase().includes(q) || (name ?? '').toLowerCase().includes(q);
  };

  const filteredLocations = useMemo(
    () => locations.filter((loc) => byClass(loc.student_id) && bySearch(loc.student_id, loc.student_name)),
    [locations, selectedClass, searchTerm],
  );

  const filteredStats = useMemo(
    () => stats.filter((s) => byClass(s.student_id) && bySearch(s.student_id, s.student_name)),
    [stats, selectedClass, searchTerm],
  );

  const filteredStudents = useMemo(
    () => students.filter((s) => byClass(s.student_id) && bySearch(s.student_id, s.student_name)),
    [students, selectedClass, searchTerm],
  );

  const missingLocationStudents = useMemo(() => {
    const locationStudentIds = new Set(filteredLocations.map((loc) => loc.student_id));
    return filteredStudents.filter((student) => !locationStudentIds.has(student.student_id));
  }, [filteredStudents, filteredLocations]);

  const displayedStats = showAllStats ? filteredStats : filteredStats.slice(0, TOP_LIMIT);
  const displayedMissingLocationStudents = showAllMissingLocations ? missingLocationStudents : missingLocationStudents.slice(0, TOP_LIMIT);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(TEACHER_AUTH_STORAGE_KEY) === 'true') setOk(true);
  }, []);

  useEffect(() => {
    if (!ok) return;
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [ok]);

  useEffect(() => { if (ok) loadKakaoMapScript(); }, [ok]);

  useEffect(() => {
    locationsRef.current = filteredLocations;
    if (!mapRef.current || !window.kakao?.maps) return;
    renderMarkers(filteredLocations);
  }, [filteredLocations, treasures]);

  function loadKakaoMapScript() {
    if (window.kakao?.maps) return initMap();
    const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_APP_KEY;
    if (!appKey) return;
    const existing = document.getElementById('kakao-map-script') as HTMLScriptElement | null;
    if (existing) return existing.addEventListener('load', initMap);
    const script = document.createElement('script');
    script.id = 'kakao-map-script';
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false&libraries=clusterer`;
    script.async = true;
    script.onload = initMap;
    document.head.appendChild(script);
  }

  function initMap() {
    const kakao = window.kakao;
    if (!kakao?.maps || !mapContainerRef.current || mapRef.current) return;
    kakao.maps.load(() => {
      mapRef.current = new kakao.maps.Map(mapContainerRef.current, { center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng), level: 4 });
      clustererRef.current = new kakao.maps.MarkerClusterer({ map: mapRef.current, averageCenter: true, minLevel: 5, gridSize: 60 });
      renderMarkers(locationsRef.current);
    });
  }

  function closeOpened() {
    if (openedInfoWindowRef.current) openedInfoWindowRef.current.close();
  }

  function renderTreasureMarkers(map: any, kakao: any) {
    treasureStateRef.current.markers.forEach((m) => m.setMap(null));
    treasureStateRef.current.overlays.forEach((o) => o.setMap(null));
    treasureStateRef.current.infoWindows.forEach((i) => i.close());
    treasureStateRef.current = { markers: [], overlays: [], infoWindows: [] };

    treasures.forEach((t, idx) => {
      const position = new kakao.maps.LatLng(t.latitude, t.longitude);
      const marker = new kakao.maps.Marker({ position, map, title: `보물 ${idx + 1}` });
      const overlay = new kakao.maps.CustomOverlay({
        map,
        position,
        yAnchor: 2.1,
        content: `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:999px;padding:2px 7px;font-size:12px;font-weight:700;">🎁 ${idx + 1}</div>`,
      });
      const infoWindow = new kakao.maps.InfoWindow({ content: `<div style="padding:10px;line-height:1.45;"><p style="margin:0 0 4px;"><strong>보물 번호:</strong> ${idx + 1}</p><p style="margin:0 0 4px;"><strong>보물 이름:</strong> ${t.name}</p><p style="margin:0;"><strong>반경:</strong> ${t.radius_m}m</p></div>` });
      kakao.maps.event.addListener(marker, 'click', () => { closeOpened(); infoWindow.open(map, marker); openedInfoWindowRef.current = infoWindow; });
      treasureStateRef.current.markers.push(marker);
      treasureStateRef.current.overlays.push(overlay);
      treasureStateRef.current.infoWindows.push(infoWindow);
    });
  }

  function renderMarkers(items: StudentLocation[]) {
    const kakao = window.kakao;
    const map = mapRef.current;
    const clusterer = clustererRef.current;
    if (!kakao?.maps || !map || !clusterer) return;

    closeOpened();
    markerStateRef.current.forEach(({ marker, infoWindow, nameLabelOverlay }) => { marker.setMap(null); infoWindow.close(); if (nameLabelOverlay) nameLabelOverlay.setMap(null); });
    markerStateRef.current.clear();
    clusterer.clear();

    const markers: any[] = [];
    const showNameLabel = map.getLevel() <= 5;

    items.forEach((loc) => {
      const position = new kakao.maps.LatLng(loc.latitude, loc.longitude);
      const marker = new kakao.maps.Marker({ position, title: `${loc.student_name}(${loc.student_id})` });
      const infoWindow = new kakao.maps.InfoWindow({ content: `<div style="padding:10px 12px;min-width:220px;line-height:1.5;"><p style="margin:0 0 4px;"><strong>학번:</strong> ${loc.student_id}</p><p style="margin:0 0 4px;"><strong>이름:</strong> ${loc.student_name ?? '이름없음'}</p><p style="margin:0 0 4px;"><strong>마지막 갱신:</strong> ${new Date(loc.updated_at).toLocaleString('ko-KR')}</p><p style="margin:0 0 8px;"><strong>GPS 정확도:</strong> ${typeof loc.accuracy_m === 'number' ? loc.accuracy_m.toFixed(3) : '-'}${typeof loc.accuracy_m === 'number' ? 'm' : ''}</p><button id="close-${loc.student_id}" style="border:none;background:#e7eefc;color:#1f3f83;padding:6px 10px;border-radius:8px;cursor:pointer;">닫기</button></div>` });

      let nameLabelOverlay;
      if (showNameLabel) {
        const shortLabel = (loc.student_name ?? '').trim().slice(-2) || loc.student_id.slice(-2);
        nameLabelOverlay = new kakao.maps.CustomOverlay({ map, position, yAnchor: 1.9, content: `<div style="background:white;border:1px solid #d0d7e2;border-radius:999px;padding:2px 6px;font-size:11px;font-weight:700;">${shortLabel}</div>` });
      }

      kakao.maps.event.addListener(marker, 'click', () => {
        closeOpened();
        infoWindow.open(map, marker);
        openedInfoWindowRef.current = infoWindow;
      });

      kakao.maps.event.addListener(infoWindow, 'domready', () => {
        const btn = document.getElementById(`close-${loc.student_id}`);
        if (btn) btn.onclick = () => infoWindow.close();
      });

      markers.push(marker);
      markerStateRef.current.set(loc.student_id, { marker, infoWindow, nameLabelOverlay });
    });

    if (markers.length) clusterer.addMarkers(markers);
    renderTreasureMarkers(map, kakao);
  }

  function focusStudent(studentId: string) {
    const state = markerStateRef.current.get(studentId);
    if (!state || !mapRef.current) return;
    closeOpened();
    mapRef.current.panTo(state.marker.getPosition());
    state.infoWindow.open(mapRef.current, state.marker);
    openedInfoWindowRef.current = state.infoWindow;
  }

  async function load() {
    const [
      { data: rawLogs, error: logsError },
      { data: loc, error: locError },
      { data: treasureData, error: treasureError },
      { data: studentData, error: studentError },
    ] = await Promise.all([
      supabase.from('treasure_logs').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('current_locations').select('student_id, student_name, latitude, longitude, accuracy_m, updated_at').order('updated_at', { ascending: false }),
      supabase.from('treasures').select('id, name, order_index, radius_m, latitude, longitude').order('order_index', { ascending: true }),
      supabase.from('students').select('student_id, student_name, last_login_at').not('student_id', 'is', null),
    ]);

    if (logsError || locError || treasureError || studentError) {
      setErrorMessage(logsError?.message ?? locError?.message ?? treasureError?.message ?? studentError?.message ?? '조회 오류');
      return;
    }

    const list = (rawLogs ?? []) as TreasureLog[];
    const locationList = (loc ?? []) as StudentLocation[];

    setLogs(list.slice(0, 30));
    setLocations(locationList);
    setStudents((studentData ?? []) as StudentLogin[]);

    const countMap = new Map<string, { student_name: string; student_id: string; count: number }>();
    list.forEach((l) => {
      const prev = countMap.get(l.student_id) ?? { student_name: l.student_name, student_id: l.student_id, count: 0 };
      prev.count += 1;
      countMap.set(l.student_id, prev);
    });

    const locationMap = new Map(locationList.map((item) => [item.student_id, item]));
    const mergedIds = new Set<string>([...countMap.keys(), ...locationMap.keys()]);

    const mergedStats = Array.from(mergedIds).map((studentId) => {
      const fromLog = countMap.get(studentId);
      const fromLocation = locationMap.get(studentId);
      return {
        student_id: studentId,
        student_name: fromLocation?.student_name || fromLog?.student_name || '-',
        count: fromLog?.count ?? 0,
        updated_at: fromLocation?.updated_at ?? null,
        accuracy_m: fromLocation?.accuracy_m,
      };
    });

    mergedStats.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.student_id.localeCompare(b.student_id);
    });

    setStats(mergedStats);
    setTreasures((treasureData ?? []) as Treasure[]);
    setErrorMessage('');
  }

  function handleLogin() {
    if (pw === (process.env.NEXT_PUBLIC_TEACHER_PASSWORD ?? '1234')) {
      setOk(true); setErrorMessage(''); window.localStorage.setItem(TEACHER_AUTH_STORAGE_KEY, 'true'); return;
    }
    setErrorMessage('비밀번호가 올바르지 않습니다. 다시 확인해주세요.');
  }

  if (!ok) return <main><h1>교사용 대시보드</h1>{!!errorMessage && <p className="small">{errorMessage}</p>}<div className="card"><input type="password" placeholder="비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} /><button onClick={handleLogin}>입장</button></div></main>;

  return (
    <main className="teacher-main">
      <div className="teacher-header"><h1>교사용 대시보드</h1><button className="teacher-logout" onClick={() => { window.localStorage.removeItem(TEACHER_AUTH_STORAGE_KEY); setOk(false); }}>로그아웃</button></div>
      {!!errorMessage && <p className="small">{errorMessage}</p>}

      <div className="card teacher-filter-card">
        <div className="teacher-class-filters">{classes.map((c) => <button key={c} className={`teacher-filter-button ${selectedClass === c ? 'active' : ''}`} onClick={() => setSelectedClass(c)}>{c}</button>)}</div>
        <input placeholder="학번 또는 이름 검색" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>

      <div className="card teacher-summary-card">
        <h3>로그인/위치 수집 요약</h3>
        <p>전체 로그인 학생: <strong>{filteredStudents.length}명</strong></p>
        <p>위치 수집 성공: <strong>{filteredLocations.length}명</strong></p>
        <p>위치 미수집: <strong>{missingLocationStudents.length}명</strong></p>
      </div>

      <div className="card teacher-map-card"><h3>학생/보물 위치 지도</h3><div ref={mapContainerRef} className="teacher-map" /></div>

      <div className="teacher-bottom-grid">
        <div className="card teacher-status-card">
          <h3>학생 획득 현황</h3>
          <div className="teacher-student-list teacher-status-list">
            {displayedStats.map((s) => (
              <button key={s.student_id} className="teacher-student-item" onClick={() => focusStudent(s.student_id)}>
                <strong>{s.student_id} {s.student_name}</strong>
                <span>획득: {s.count}개</span>
                <span>갱신: {s.updated_at ? new Date(s.updated_at).toLocaleString('ko-KR') : '-'}</span>
                <span>GPS 정확도: {typeof s.accuracy_m === 'number' ? `${s.accuracy_m.toFixed(3)}m` : '-'}</span>
              </button>
            ))}
          </div>
          {filteredStats.length > TOP_LIMIT && <button className="teacher-toggle" onClick={() => setShowAllStats((v) => !v)}>{showAllStats ? '접기' : '펼치기'}</button>}
        </div>

        <div className="card teacher-missing-location-card">
          <h3>위치 미수집 학생</h3>
          <div className="teacher-student-list teacher-missing-location-list">
            {displayedMissingLocationStudents.length === 0 && <p className="small">현재 조건에서 위치 미수집 학생이 없습니다.</p>}
            {displayedMissingLocationStudents.map((s) => (
              <div key={s.student_id} className="teacher-student-item teacher-missing-location-item">
                <strong>{s.student_id} {s.student_name}</strong>
                <span>마지막 로그인: {s.last_login_at ? new Date(s.last_login_at).toLocaleString('ko-KR') : '-'}</span>
                <span>위치 정보 없음 - 위치 권한 허용 후 새로고침 필요</span>
              </div>
            ))}
          </div>
          {missingLocationStudents.length > TOP_LIMIT && <button className="teacher-toggle" onClick={() => setShowAllMissingLocations((v) => !v)}>{showAllMissingLocations ? '접기' : '펼치기'}</button>}
          <p className="small teacher-missing-location-guide">학생에게 브라우저 위치 권한을 허용한 뒤, 학생 화면의 새로고침 버튼을 누르도록 안내하세요.</p>
        </div>
      </div>

      <div className="card"><h3>최근 획득 로그</h3>{logs.map((l) => <p key={l.id}>{new Date(l.created_at).toLocaleTimeString()} - {l.student_name}({l.student_id}) / {l.treasure_name ?? l.treasure_id}</p>)}</div>
    </main>
  );
}
