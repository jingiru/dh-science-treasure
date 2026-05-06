'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase, TreasureLog } from '@/lib/supabase';

type StudentLocation = {
  student_id: string;
  latitude: number;
  longitude: number;
  accuracy_m?: number | null;
  student_name: string;
  updated_at: string;
};

declare global {
  interface Window {
    kakao?: any;
  }
}

const STALE_MINUTES = 3;
const DEFAULT_CENTER = { lat: 36.3744, lng: 127.3867 }; // 대전 국립중앙과학관 인근

export default function TeacherPage() {
  const [pw, setPw] = useState('');
  const [ok, setOk] = useState(false);
  const [stats, setStats] = useState<{ student_name: string; student_id: string; count: number }[]>([]);
  const [logs, setLogs] = useState<TreasureLog[]>([]);
  const [locations, setLocations] = useState<StudentLocation[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  const mapRef = useRef<any>(null);
  const clustererRef = useRef<any>(null);
  const locationsRef = useRef<StudentLocation[]>([]);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const markerStateRef = useRef<Map<string, { marker: any; infoWindow: any; staleOverlay?: any; nameLabelOverlay?: any }>>(new Map());

  useEffect(() => {
    if (!ok) return;
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [ok]);

  useEffect(() => {
    if (!ok) return;
    loadKakaoMapScript();
  }, [ok]);

  useEffect(() => {
    locationsRef.current = locations;
    if (!mapRef.current || !window.kakao?.maps) return;
    renderMarkers(locations);
  }, [locations]);

  function loadKakaoMapScript() {
    if (window.kakao?.maps) {
      initMap();
      return;
    }

    const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_APP_KEY;
    if (!appKey) {
      console.warn('NEXT_PUBLIC_KAKAO_MAP_APP_KEY 환경변수가 설정되지 않았습니다.');
      return;
    }

    const scriptId = 'kakao-map-script';
    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', initMap);
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false&libraries=clusterer`;
    script.async = true;
    script.onload = initMap;
    document.head.appendChild(script);
  }

  function initMap() {
    const kakao = window.kakao;
    if (!kakao?.maps || !mapContainerRef.current || mapRef.current) return;

    kakao.maps.load(() => {
      const options = {
        center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
        level: 4,
      };
      mapRef.current = new kakao.maps.Map(mapContainerRef.current, options);

      if (!kakao.maps.MarkerClusterer) {
        const clustererError = '카카오맵 클러스터러 로딩 실패: SDK URL에 libraries=clusterer가 포함되어 있는지 확인하세요.';
        console.error(clustererError);
        setErrorMessage(clustererError);
        return;
      }

      clustererRef.current = new kakao.maps.MarkerClusterer({
        map: mapRef.current,
        averageCenter: true,
        minLevel: 5,
        disableClickZoom: false,
        gridSize: 60,
      });

      kakao.maps.event.addListener(mapRef.current, 'zoom_changed', () => {
        renderMarkers(locationsRef.current);
      });

      renderMarkers(locationsRef.current);
    });
  }

  function getShortLabelText(name: string | undefined, studentId: string) {
    const baseText = (name ?? '').trim();
    if (baseText.length >= 2) return baseText.slice(-2);
    if (baseText.length === 1) return baseText;
    return studentId.slice(-2);
  }

  function renderMarkers(items: StudentLocation[]) {
    const kakao = window.kakao;
    const map = mapRef.current;
    const clusterer = clustererRef.current;
    if (!kakao?.maps || !map || !clusterer) return;

    markerStateRef.current.forEach(({ marker, staleOverlay, infoWindow, nameLabelOverlay }) => {
      marker.setMap(null);
      infoWindow.close();
      if (staleOverlay) staleOverlay.setMap(null);
      if (nameLabelOverlay) nameLabelOverlay.setMap(null);
    });
    markerStateRef.current.clear();
    clusterer.clear();

    const showNameLabel = map.getLevel() <= 5;
    const markers: any[] = [];

    items.forEach((loc) => {
      if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return;

      const position = new kakao.maps.LatLng(loc.latitude, loc.longitude);
      const isStale = Date.now() - new Date(loc.updated_at).getTime() >= STALE_MINUTES * 60 * 1000;
      const markerImage = new kakao.maps.MarkerImage(
        isStale
          ? 'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png'
          : 'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png',
        new kakao.maps.Size(24, 35)
      );

      const marker = new kakao.maps.Marker({
        position,
        image: markerImage,
        title: `${loc.student_name ?? '이름없음'}(${loc.student_id})`,
      });

      const updatedAtLabel = new Date(loc.updated_at).toLocaleString('ko-KR');
      const accuracy = loc.accuracy_m ?? '-';
      const staleText = isStale ? '<p style="margin:2px 0;color:#b42318;font-weight:600;">⚠ 오래됨(3분 이상)</p>' : '';
      const infoWindow = new kakao.maps.InfoWindow({
        content: `
          <div style="padding:10px 12px;min-width:220px;line-height:1.5;">
            <p style="margin:0 0 4px;"><strong>학번:</strong> ${loc.student_id}</p>
            <p style="margin:0 0 4px;"><strong>이름:</strong> ${loc.student_name ?? '이름없음'}</p>
            <p style="margin:0 0 4px;"><strong>마지막 갱신:</strong> ${updatedAtLabel}</p>
            <p style="margin:0;"><strong>GPS 정확도:</strong> ${accuracy}m</p>
            ${staleText}
          </div>
        `,
      });

      let staleOverlay;
      if (isStale) {
        staleOverlay = new kakao.maps.CustomOverlay({
          map,
          position,
          yAnchor: 2.2,
          content: '<div style="background:#fff3f2;color:#b42318;border:1px solid #fecdca;border-radius:999px;padding:2px 7px;font-size:11px;">오래됨</div>',
        });
      }

      let nameLabelOverlay;
      if (showNameLabel) {
        const shortLabel = getShortLabelText(loc.student_name, loc.student_id);
        const staleStyle = isStale ? 'opacity:0.6;filter:grayscale(0.25);' : '';
        nameLabelOverlay = new kakao.maps.CustomOverlay({
          map,
          position,
          yAnchor: 1.9,
          content: `<div style="background:white;border:1px solid #d0d7e2;border-radius:999px;padding:2px 6px;font-size:11px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,0.15);${staleStyle}">${shortLabel}</div>`,
        });
      }

      kakao.maps.event.addListener(marker, 'click', () => {
        infoWindow.open(map, marker);
      });

      markers.push(marker);
      markerStateRef.current.set(loc.student_id, { marker, infoWindow, staleOverlay, nameLabelOverlay });
    });

    if (markers.length > 0) {
      clusterer.addMarkers(markers);
    }
  }

  async function load() {
    const { data: rawLogs, error: logsError } = await supabase.from('treasure_logs').select('*').order('created_at', { ascending: false }).limit(30);
    if (logsError) {
      console.error('treasure_logs select error:', logsError);
      setErrorMessage(`획득 로그 조회 오류: ${logsError.message}`);
      return;
    }
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

    const { data: loc, error: locationError } = await supabase
      .from('current_locations')
      .select('student_id, student_name, latitude, longitude, accuracy_m, updated_at')
      .order('updated_at', { ascending: false });

    if (locationError) {
      console.error('current_locations select error:', locationError);
      setErrorMessage(`위치 조회 오류: ${locationError.message}`);
      return;
    }

    setErrorMessage('');
    setLocations((loc ?? []) as StudentLocation[]);
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
    <main className="teacher-main">
      <h1>교사용 대시보드</h1>
      {!!errorMessage && <p className="small">{errorMessage}</p>}
      <div className="card teacher-map-card">
        <h3>학생 위치 지도 (마지막 위치)</h3>
        <div ref={mapContainerRef} className="teacher-map" />
      </div>
      <div className="card">
        <h3>학생별 획득 수</h3>
        {stats.map((s) => <p key={s.student_id + s.student_name}>{s.student_name}({s.student_id}): {s.count}개</p>)}
      </div>
      <div className="card">
        <h3>최근 획득 로그</h3>
        {logs.map((l) => <p key={l.id}>{new Date(l.created_at).toLocaleTimeString()} - {l.student_name}({l.student_id}) / {l.treasure_name ?? l.treasure_id}</p>)}
      </div>
    </main>
  );
}
