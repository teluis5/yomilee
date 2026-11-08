#!/usr/bin/env node
/**
 * weekly_pokemon_predictor.mjs
 * ANA ポケモン特別塗装機（全5機・ピカチュウ/イーブイ/赤/緑/前期）
 * リアルタイム運航追跡 ＆ 国内線（JA819A）週間フライト予測エンジン
 * 
 * ちいかわジェット（JA609A）で確立した
 * 【公式ODPTダイヤ突合 × FR24リアルタイム × ターンアラウンド × スポット連動判定 × 翌日3大プラン予測】
 * をポケモンジェット全機へ完全展開する統合予測エンジン。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YOMILEE_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(YOMILEE_ROOT, 'data');
const SRC_DATA_DIR = path.join(YOMILEE_ROOT, 'src', 'data');
const ANA_FLEET_STATUS_FILE = path.join(DATA_DIR, 'ana_fleet_status.json');
const OUTPUT_JSON_FILE = path.join(DATA_DIR, 'pokemon_weekly_prediction.json');
const SRC_OUTPUT_JSON_FILE = path.join(SRC_DATA_DIR, 'pokemon_weekly_prediction.json');
const STATUS_JSON_FILE = path.join(DATA_DIR, 'pokemon_jet_status.json');
const SRC_STATUS_JSON_FILE = path.join(SRC_DATA_DIR, 'pokemon_jet_status.json');

// 全日本空輸 (ANA) ポケモンジェット フリートマスター
export const POKEMON_JET_FLEET = [
  {
    id: 'pokemon-red',
    reg: 'JA819A',
    name: 'ポケモンジェット 赤',
    nameEn: 'Pokemon Jet Red',
    type: 'domestic',
    aircraftType: 'Boeing 787-8 Dreamliner',
    modelCode: 'B788',
    category: '国内線仕様機',
    badge: '国内線 (最も会いやすい！)',
    theme: 'ポケモン30周年記念（赤・カントー御三家：リザードン・フシギバナ・カメックス）',
    routesSummary: '羽田 ➔ 福岡 / 新千歳 / 伊丹 / 松山 / 函館 / 那覇 / 宮古 / 石垣 / 長崎',
    color: '#ef4444',
    serviceStart: '2026-07-29'
  },
  {
    id: 'pikachu-nh',
    reg: 'JA894A',
    name: 'ピカチュウジェット NH',
    nameEn: 'Pikachu Jet NH',
    type: 'international',
    aircraftType: 'Boeing 787-9 Dreamliner',
    modelCode: 'B789',
    category: '国際線仕様機',
    badge: '国際線 中長距離',
    theme: 'そらとぶピカチュウプロジェクト（ピカチュウ・リザードン・ラティアス等）',
    routesSummary: '羽田/成田 ➔ シンガポール / バンクーバー / ホノルル / シドニー / マニラ / ジャカルタ',
    color: '#eab308',
    serviceStart: '2023-06-04'
  },
  {
    id: 'eevee-nh',
    reg: 'JA784A',
    name: 'イーブイジェット NH',
    nameEn: 'Eevee Jet NH',
    type: 'international',
    aircraftType: 'Boeing 777-300ER',
    modelCode: 'B77W',
    category: '国際線フラッグシップ大型機',
    badge: '国際線 長距離幹線',
    theme: 'そらとぶピカチュウプロジェクト（イーブイ・ブイズ進化形8種）',
    routesSummary: '羽田/成田 ➔ サンフランシスコ / シカゴ / ロンドン / ニューヨーク',
    color: '#d97706',
    serviceStart: '2023-08-31'
  },
  {
    id: 'pokemon-green',
    reg: 'JA923A',
    name: 'ポケモンジェット 緑',
    nameEn: 'Pokemon Jet Green',
    type: 'international',
    aircraftType: 'Boeing 787-9 Dreamliner',
    modelCode: 'B789',
    category: '国際線仕様機',
    badge: '国際線 中長距離',
    theme: 'ポケモン30周年記念（緑・草タイプ・フシギバナモチーフ）',
    routesSummary: '羽田/成田 ➔ シアトル / 欧州 / 北米 / バンコク / アジア幹線',
    color: '#22c55e',
    serviceStart: '2026-09-18'
  },
  {
    id: 'pikachu-legacy',
    reg: 'JA872A',
    name: 'ピカチュウジェット NH (前期)',
    nameEn: 'Pikachu Jet NH (Initial)',
    type: 'international',
    aircraftType: 'Boeing 787-9 Dreamliner',
    modelCode: 'B789',
    category: '国際線仕様機',
    badge: '国際線',
    theme: 'そらとぶピカチュウプロジェクト（B787-9前期運用機）',
    routesSummary: '羽田/成田 ➔ フランクフルト / パリ / ロサンゼルス / アジア',
    color: '#f59e0b',
    serviceStart: '2023-06-04'
  }
];

// 空港名称辞書
const AIRPORT_NAMES = {
  HND: '東京(羽田)',
  NRT: '東京(成田)',
  ITM: '大阪(伊丹)',
  KIX: '大阪(関空)',
  UKB: '神戸',
  NGO: '名古屋(中部)',
  CTS: '札幌(新千歳)',
  FUK: '福岡',
  OKA: '沖縄(那覇)',
  ISG: '石垣',
  MMY: '宮古',
  MYJ: '松山',
  NGS: '長崎',
  KMJ: '熊本',
  KOJ: '鹿児島',
  HIJ: '広島',
  TAK: '高松',
  KCZ: '高知',
  HKD: '函館',
  AKX: '秋田',
  SYO: '庄内',
  TOY: '富山',
  KMQ: '小松',
  FSZ: '静岡',
  UBJ: '山口宇部',
  TKS: '徳島',
  KMI: '宮崎',
  OIT: '大分',
  ASJ: '奄美',
  SIN: 'シンガポール',
  BKK: 'バンコク',
  CGK: 'ジャカルタ',
  HNL: 'ホノルル',
  SFO: 'サンフランシスコ',
  LAX: 'ロサンゼルス',
  ORD: 'シカゴ',
  JFK: 'ニューヨーク',
  LHR: 'ロンドン',
  CDG: 'パリ(シャルルドゴール)',
  FRA: 'フランクフルト',
  MUC: 'ミュンヘン',
  SYD: 'シドニー',
  YVR: 'バンクーバー',
  MNL: 'マニラ',
  SEA: 'シアトル'
};

function formatAirport(code) {
  if (!code) return '';
  return AIRPORT_NAMES[code] ? `${AIRPORT_NAMES[code]} (${code})` : code;
}

function shortAirportName(code) {
  if (!code) return '';
  const fullName = AIRPORT_NAMES[code] || code;
  return fullName.replace(/東京\(|\)|大阪\(|札幌\(|沖縄\(/g, '').trim();
}

function parseTimeToMinutes(t) {
  if (!t || typeof t !== 'string') return null;
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function getTodayJstDateStr() {
  const now = new Date();
  const jst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60 * 1000);
  const yyyy = jst.getFullYear();
  const mm = String(jst.getMonth() + 1).padStart(2, '0');
  const dd = String(jst.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// FR24 API 取得（curl経由でWAFを安全に通過）
export function fetchAircraftFlightsFR24(reg, limit = 15) {
  const url = `https://api.flightradar24.com/common/v1/flight/list.json?query=${reg}&fetchBy=reg&page=1&limit=${limit}`;
  try {
    const cmd = `curl.exe -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" "${url}"`;
    const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 15000 });
    const json = JSON.parse(stdout);
    return json.result?.response?.data || [];
  } catch (e) {
    console.warn(`⚠️ [FR24] ${reg} のフライトデータ取得失敗: ${e.message}`);
    return [];
  }
}

// ODPT 機材・ダイヤデータ読み込み
function loadOdptData() {
  if (fs.existsSync(ANA_FLEET_STATUS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ANA_FLEET_STATUS_FILE, 'utf-8'));
    } catch (e) {
      console.warn('⚠️ ODPT機材データ読み込み失敗:', e.message);
    }
  }
  return null;
}

// 羽田空港（第2ターミナル）のスポット親和性判定
function evaluateHndSpotAffinity(currentSpot, candidateDepGate, turnaroundMin) {
  if (!currentSpot || !candidateDepGate) return 1.0;
  const s1 = parseInt(String(currentSpot).replace(/[^0-9]/g, ''), 10);
  const s2 = parseInt(String(candidateDepGate).replace(/[^0-9]/g, ''), 10);
  if (isNaN(s1) || isNaN(s2)) return 1.0;

  if (s1 === s2) {
    if (turnaroundMin >= 40 && turnaroundMin <= 85) return 4.0;
    return 2.2;
  }
  const isBus1 = s1 >= 500 && s1 < 600;
  const isBus2 = s2 >= 500 && s2 < 600;
  if (isBus1 && isBus2) return 2.8;
  if (isBus1 !== isBus2) {
    if (turnaroundMin <= 75) return 0.2;
    return 0.6;
  }
  const diff = Math.abs(s1 - s2);
  if (diff <= 3) return 1.5;
  if (diff <= 8) return 1.2;
  if (diff >= 12 && turnaroundMin <= 85) return 0.25;
  return 1.0;
}

// Hamilton法による100%正規化
function normalizeTo100Percent(items, weightKey = 'weight', minFloor = 5) {
  if (!items || items.length === 0) return [];
  const total = items.reduce((sum, it) => sum + (it[weightKey] || 0), 0);
  if (total <= 0) {
    const eq = Math.floor(100 / items.length);
    return items.map((it, idx) => ({ ...it, probability: idx === 0 ? 100 - eq * (items.length - 1) : eq }));
  }
  const rawList = items.map(it => {
    const rawVal = ((it[weightKey] || 0) / total) * 100;
    const floored = Math.max(minFloor, Math.floor(rawVal));
    return { ...it, floored, remainder: rawVal - floored };
  });
  let allocated = rawList.reduce((sum, it) => sum + it.floored, 0);
  let diff = 100 - allocated;
  rawList.sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < diff; i++) {
    rawList[i % rawList.length].floored += 1;
  }
  return rawList.map(it => ({ ...it, probability: it.floored }));
}

// ============================================================================
// 国内線仕様機（JA819A）の本日残り便＆今夜ステイ先予測エンジン
// ============================================================================
function predictDomesticTodayRemainder(todayFlights, todayStr, odptData) {
  const dKey = todayStr.replace(/-/g, '');
  const dayFlights = odptData?.dates?.[dKey] || {};
  const lastFl = todayFlights.length > 0 ? todayFlights[todayFlights.length - 1] : null;

  if (!lastFl) {
    return {
      nightStayName: '東京(羽田) (予定)',
      nightStayCode: 'HND',
      isNightStayConfirmed: false,
      nightStayProbabilities: [{ airport: '東京(羽田)', code: 'HND', probability: 100 }],
      predictedRemainingToday: [],
      todayPlans: []
    };
  }

  const startAirport = lastFl.destCode;
  const startArrMin = parseTimeToMinutes(lastFl.arrTime) ?? 900;
  const alreadyFlownSet = new Set(todayFlights.map(f => f.flightNo));

  // DFS探索で残りの全有効パスを探索
  const completedPaths = [];

  function dfs(curAirport, curArrMin, curFn, pathFlights, pathWeight, depth) {
    if (depth >= 4 || curArrMin >= 1380) {
      completedPaths.push({
        remFlights: [...pathFlights],
        finalStayCode: curAirport,
        weight: pathWeight
      });
      return;
    }

    // 羽田着で18:00以降なら羽田ステイも評価
    if (curAirport === 'HND' && curArrMin >= 1080) {
      let hndFactor = curArrMin >= 1200 ? 2.5 : (curArrMin >= 1140 ? 1.0 : 0.45);
      completedPaths.push({
        remFlights: [...pathFlights],
        finalStayCode: 'HND',
        weight: pathWeight * hndFactor
      });
    }

    const minTurn = curAirport === 'HND' ? 35 : 30;
    const maxTurn = curAirport === 'HND' ? 240 : 180;

    let candidates = Object.values(dayFlights).filter(df => {
      if (df.origin !== curAirport || df.isCancelled) return false;
      if (alreadyFlownSet.has(df.flightNo)) return false;
      if (pathFlights.some(pf => pf.flightNo === df.flightNo)) return false;

      // B787系（78P / 788 / 789等）を対象
      const is78 = Boolean(df.model && (df.model.includes('78') || df.model === '78P' || df.model === '788'));
      if (!is78) return false;

      const depM = parseTimeToMinutes(df.actDepTime || df.depTime);
      return depM !== null && depM >= curArrMin + minTurn && depM <= curArrMin + maxTurn;
    });

    // 78P/788を最優先
    const p78 = candidates.filter(df => df.model === '78P' || df.model === '788' || df.model?.includes('788'));
    if (p78.length > 0) candidates = p78;

    if (candidates.length === 0) {
      completedPaths.push({
        remFlights: [...pathFlights],
        finalStayCode: curAirport,
        weight: pathWeight * 0.6
      });
      return;
    }

    for (const df of candidates.slice(0, 4)) {
      const depM = parseTimeToMinutes(df.depTime) ?? (curArrMin + 50);
      const arrM = parseTimeToMinutes(df.arrTime) ?? (depM + 90);
      const turn = depM - curArrMin;

      let edgeWeight = 1.0;
      if (turn >= 45 && turn <= 85) edgeWeight *= 1.8;
      else if (turn < 45) edgeWeight *= 0.9;
      else if (turn > 120) edgeWeight *= 0.35;

      if (curAirport === 'HND' && df.depGate) {
        edgeWeight *= evaluateHndSpotAffinity('53', df.depGate, turn); // 羽田ゲート親和
      }

      const origName = AIRPORT_NAMES[df.origin] || df.origin;
      const destName = AIRPORT_NAMES[df.dest] || df.dest;
      const nextFlightObj = {
        flightNo: df.flightNo,
        orig: df.origin,
        dest: df.dest,
        origCode: df.origin,
        destCode: df.dest,
        route: `${origName} ➔ ${destName}`,
        depTime: df.depTime,
        arrTime: df.arrTime,
        time: `${df.depTime}発 - ${df.arrTime}着`,
        model: df.model
      };

      dfs(df.dest, arrM, df.flightNo, [...pathFlights, nextFlightObj], pathWeight * edgeWeight, depth + 1);
    }
  }

  dfs(startAirport, startArrMin, lastFl.flightNo, [], 1.0, 0);

  if (completedPaths.length === 0) {
    const stayName = AIRPORT_NAMES[startAirport] || startAirport;
    return {
      nightStayName: `${stayName} (有力)`,
      nightStayCode: startAirport,
      isNightStayConfirmed: false,
      nightStayProbabilities: [{ airport: stayName, code: startAirport, probability: 100 }],
      predictedRemainingToday: [],
      todayPlans: []
    };
  }

  // 宿泊地集計
  const stayWeightMap = new Map();
  for (const p of completedPaths) {
    stayWeightMap.set(p.finalStayCode, (stayWeightMap.get(p.finalStayCode) || 0) + p.weight);
  }
  const rawStayItems = [...stayWeightMap.entries()]
    .map(([code, weight]) => ({
      code,
      airport: shortAirportName(code),
      weight
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);

  const nightStayProbabilities = normalizeTo100Percent(rawStayItems, 'weight', 5);
  const topStay = nightStayProbabilities[0];

  // パスマージ
  const pathMap = new Map();
  for (const p of completedPaths) {
    const key = `${p.remFlights.map(f => f.flightNo).join('>')}|${p.finalStayCode}`;
    if (!pathMap.has(key)) pathMap.set(key, { ...p });
    else pathMap.get(key).weight += p.weight;
  }
  const uniquePaths = [...pathMap.values()].sort((a, b) => b.weight - a.weight);

  const bestPath = uniquePaths[0];
  const predictedRemainingToday = (bestPath?.remFlights || []).map((rf, idx) => ({
    flightNo: rf.flightNo,
    origCode: rf.orig,
    destCode: rf.dest,
    route: rf.route,
    depTime: rf.depTime,
    arrTime: rf.arrTime,
    time: `${rf.depTime}発 - ${rf.arrTime}着 (予想)`,
    status: idx === bestPath.remFlights.length - 1 ? `本命予想 (${topStay.airport}泊候補)` : '折返し確定予想 (78P枠)',
    isPredicted: true
  }));

  // 本日プラン
  const top3 = uniquePaths.slice(0, 3);
  const normTop3 = normalizeTo100Percent(top3, 'weight', 10);
  const planLetters = ['プランA', 'プランB', 'プランC'];
  const rankLabels = ['本命 ◎', '有力 ◯', '対抗 ▲'];

  const todayPlans = normTop3.map((p, idx) => {
    const allF = [
      ...todayFlights.map(tf => ({
        flightNo: tf.flightNo,
        orig: tf.origCode,
        dest: tf.destCode,
        route: tf.route,
        time: `${tf.depTime}発 - ${tf.arrTime}着`,
        tag: tf.isLive ? '飛行中 🟢' : '運航完了'
      })),
      ...p.remFlights.map((rf, rIdx) => ({
        flightNo: rf.flightNo,
        orig: rf.orig,
        dest: rf.dest,
        route: rf.route,
        time: rf.time,
        tag: rIdx === p.remFlights.length - 1 ? `🌙${shortAirportName(p.finalStayCode)}泊候補` : '予想接続 (78P)'
      }))
    ].map((f, fIdx) => ({
      ...f,
      step: `第${fIdx + 1}便`
    }));

    const stops = [allF[0]?.orig || 'HND', ...allF.map(f => f.dest)].filter(Boolean);
    const routeSummary = stops.map(s => shortAirportName(s)).join(' ➔ ') + '(泊)';
    const stayLabel = shortAirportName(p.finalStayCode);

    return {
      planId: `today-plan-${idx + 1}`,
      planName: `${planLetters[idx]} (${stayLabel}泊)`,
      stayCode: p.finalStayCode,
      rank: rankLabels[idx],
      probability: p.probability,
      title: `【今夜${stayLabel}泊シナリオ】${routeSummary}`,
      routeSummary,
      flights: allF
    };
  });

  return {
    nightStayName: `${topStay.airport} (${topStay.probability}%)`,
    nightStayCode: topStay.code,
    isNightStayConfirmed: false,
    nightStayProbabilities,
    predictedRemainingToday,
    todayPlans
  };
}

// ============================================================================
// 国内線仕様機（JA819A）の翌日3大プラン予測エンジン
// ============================================================================
function predictTomorrowDomesticPlans(priorStays, targetDateStr, odptData) {
  const dKey = targetDateStr.replace(/-/g, '');
  const dayFlights = Object.values(odptData?.dates?.[dKey] || {}).filter(f => !f.isCancelled);

  // 78P / 788 便を抽出
  const b78Flights = dayFlights.filter(f => {
    return Boolean(f.model && (f.model === '788' || f.model === '78P' || f.model.includes('788')));
  });

  const plans = [];
  const planLetters = ['プランA', 'プランB', 'プランC'];
  const rankLabels = ['本命 ◎', '有力 ◯', '対抗 ▲'];

  for (let idx = 0; idx < Math.min(3, priorStays.length); idx++) {
    const stay = priorStays[idx];
    const startAirport = stay.code;

    // 朝一便（06:30〜09:30発）
    let morningCandidates = b78Flights.filter(df => {
      if (df.origin !== startAirport) return false;
      const depM = parseTimeToMinutes(df.depTime);
      return depM !== null && depM >= 390 && depM <= 570;
    });

    if (morningCandidates.length === 0) {
      morningCandidates = dayFlights.filter(df => {
        if (df.origin !== startAirport) return false;
        const depM = parseTimeToMinutes(df.depTime);
        return depM !== null && depM <= 600 && df.model?.includes('78');
      });
    }

    if (morningCandidates.length === 0) continue;

    // 最有力初便からデイリースジを構築
    const f1 = morningCandidates[0];
    const path = [f1];
    let curAirport = f1.dest;
    let curArr = parseTimeToMinutes(f1.arrTime) ?? 600;

    for (let step = 0; step < 4; step++) {
      const nextCands = b78Flights.filter(df => {
        if (df.origin !== curAirport) return false;
        if (path.some(p => p.flightNo === df.flightNo)) return false;
        const dep = parseTimeToMinutes(df.depTime);
        return dep !== null && dep >= curArr + 35 && dep <= curArr + 150;
      });

      if (nextCands.length === 0) break;
      const nextF = nextCands[0];
      path.push(nextF);
      curAirport = nextF.dest;
      curArr = parseTimeToMinutes(nextF.arrTime) ?? (curArr + 120);
      if (curArr >= 1260) break; // 21:00以降着
    }

    const allF = path.map((f, fIdx) => ({
      step: `第${fIdx + 1}便`,
      flightNo: f.flightNo,
      orig: f.origin,
      dest: f.dest,
      route: `${AIRPORT_NAMES[f.origin] || f.origin} ➔ ${AIRPORT_NAMES[f.dest] || f.dest}`,
      time: `${f.depTime}発 - ${f.arrTime}着`,
      tag: fIdx === path.length - 1 ? `🌙${shortAirportName(f.dest)}泊候補` : '予想接続 (78P)'
    }));

    const finalStay = path[path.length - 1].dest;
    const stayLabel = shortAirportName(finalStay);
    const stops = [path[0].origin, ...path.map(f => f.dest)];
    const routeSummary = stops.map(s => shortAirportName(s)).join(' ➔ ') + '(泊)';

    plans.push({
      planId: `tomorrow-plan-${idx + 1}`,
      planName: `${planLetters[idx]} (${shortAirportName(startAirport)}泊始発 ➔ ${stayLabel}泊)`,
      stayCode: finalStay,
      rank: rankLabels[idx],
      probability: stay.probability,
      title: `【${shortAirportName(startAirport)}始発】${routeSummary}`,
      routeSummary,
      flights: allF
    });
  }

  return plans;
}

// ============================================================================
// メイン実行エントリーポイント
// ============================================================================
export async function generatePokemonWeeklyPrediction() {
  console.log('⚡ === ANA ポケモンジェット全機 リアルタイム追跡＆週間予測エンジン ===');
  const now = new Date();
  const jstNow = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60 * 1000);
  const nowJa = `${jstNow.getFullYear()}年${jstNow.getMonth() + 1}月${jstNow.getDate()}日 ${String(jstNow.getHours()).padStart(2, '0')}:${String(jstNow.getMinutes()).padStart(2, '0')}`;
  const todayStr = getTodayJstDateStr();

  const odptData = loadOdptData();
  const rawJetsData = [];

  for (const jetMeta of POKEMON_JET_FLEET) {
    process.stdout.write(`📡 [${jetMeta.reg}] ${jetMeta.name} の最新フライトを取得中... `);
    const rawFls = fetchAircraftFlightsFR24(jetMeta.reg, 12);

    const todayFlights = [];
    const recentFlights = [];
    let curFl = null;
    let flightState = '駐機・待機中 🟡';
    let curLoc = '確認中';

    for (const f of rawFls) {
      const flightNo = f.identification?.number?.default || f.identification?.callsign || '';
      const orig = f.airport?.origin?.code?.iata || '';
      const dest = f.airport?.destination?.code?.iata || '';
      const isLive = Boolean(f.status?.live);
      const statusText = f.status?.text || '';

      const depTs = f.time?.real?.departure || f.time?.scheduled?.departure || f.time?.estimated?.departure;
      const arrTs = f.time?.real?.arrival || f.time?.scheduled?.arrival || f.time?.estimated?.arrival;

      const depStr = depTs ? new Date(depTs * 1000 + 9 * 3600 * 1000).toISOString().substr(11, 5) : '';
      const arrStr = arrTs ? new Date(arrTs * 1000 + 9 * 3600 * 1000).toISOString().substr(11, 5) : '';
      const dateStr = depTs ? new Date(depTs * 1000 + 9 * 3600 * 1000).toISOString().substr(0, 10) : '';

      const flObj = {
        flightNo,
        origin: orig,
        dest: dest,
        originName: formatAirport(orig),
        destinationName: formatAirport(dest),
        origCode: orig,
        destCode: dest,
        route: `${AIRPORT_NAMES[orig] || orig} ➔ ${AIRPORT_NAMES[dest] || dest}`,
        depTime: depStr,
        arrTime: arrStr,
        timeRange: `${depStr} - ${arrStr}`,
        dateJst: dateStr,
        status: statusText,
        isLive,
        isToday: dateStr === todayStr
      };

      if (flObj.isToday) todayFlights.push(flObj);
      recentFlights.push(flObj);

      if (isLive && !curFl) {
        curFl = flObj;
        flightState = '飛行中 🟢';
        curLoc = `${formatAirport(orig)} ➔ ${formatAirport(dest)}`;
      }
    }

    if (!curFl && todayFlights.length > 0) {
      const last = todayFlights[0];
      curLoc = formatAirport(last.dest);
      flightState = '着陸済・駐機中 🟡';
    }

    rawJetsData.push({
      ...jetMeta,
      flightState,
      currentLocation: curLoc,
      currentFlight: curFl,
      todayFlights: todayFlights.reverse(),
      recentFlights: recentFlights.slice(0, 6)
    });
    console.log(`✅ [${flightState}] ${curLoc}`);
  }

  // 国内線（JA819A ポケモン赤）の深層予測
  const redJet = rawJetsData.find(j => j.id === 'pokemon-red');
  let domesticPrediction = null;

  if (redJet) {
    const todayRemainder = predictDomesticTodayRemainder(redJet.todayFlights, todayStr, odptData);

    // 翌日（明日）の予測
    const tomorrowDate = new Date(jstNow.getTime() + 24 * 3600 * 1000);
    const tmrStr = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`;
    const tomorrowPlans = predictTomorrowDomesticPlans(todayRemainder.nightStayProbabilities, tmrStr, odptData);

    domesticPrediction = {
      ...todayRemainder,
      tomorrowDate: tmrStr,
      tomorrowPlans
    };
  }

  const result = {
    updatedAt: nowJa,
    updatedAtIso: new Date().toISOString(),
    totalJets: rawJetsData.length,
    jets: rawJetsData,
    domesticPrediction
  };

  fs.mkdirSync(path.dirname(OUTPUT_JSON_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON_FILE, JSON.stringify(result, null, 2), 'utf-8');
  if (fs.existsSync(SRC_DATA_DIR)) {
    fs.writeFileSync(SRC_OUTPUT_JSON_FILE, JSON.stringify(result, null, 2), 'utf-8');
  }

  // 旧 pokemon_jet_status.json との互換性維持
  const compatResult = {
    updatedAt: result.updatedAtIso,
    updatedAtJst: nowJa,
    totalJets: rawJetsData.length,
    jets: rawJetsData.map(j => ({
      ...j,
      domesticPrediction: j.id === 'pokemon-red' ? domesticPrediction : null
    }))
  };
  fs.writeFileSync(STATUS_JSON_FILE, JSON.stringify(compatResult, null, 2), 'utf-8');
  if (fs.existsSync(SRC_DATA_DIR)) {
    fs.writeFileSync(SRC_STATUS_JSON_FILE, JSON.stringify(compatResult, null, 2), 'utf-8');
  }

  console.log(`💾 ポケモン予測データを保存しました: ${OUTPUT_JSON_FILE}`);
  return result;
}

if (process.argv[1] && process.argv[1].endsWith('weekly_pokemon_predictor.mjs')) {
  generatePokemonWeeklyPrediction().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
  });
}
