import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { collectFleetData } from './collector_ana_fleet.mjs';
import { overnightPairs, overnightWeights, walkForward } from './chiikawa_overnight_model.mjs';
import { updateAnaFleetStatusFromODPT } from '../../../5_script/fetch_ana_odpt_fleet_status.mjs';
import { atomicWriteFileSync, backupFileDaily } from './file_safety.mjs';
import {
  resolveHndSpotFromOdptGate,
  evaluateHndSpotAffinityEnhanced,
  evaluateHndPierExclusiveLock,
  buildHndBipartiteMatching,
  getHndContentionFactor,
  analyzeOperatingAndMaintenanceProfile,
  getRegionalReturnHndBoost,
  updateWeeklyPredictionsArchive,
  evaluateWeeklyArchiveAccuracy,
  classifyEvaluationFailure,
  summarizeFailureBreakdown
} from './chiikawa_analytics_enhancements.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YOMILEE_ROOT = path.resolve(__dirname, '..');

const DATA_DIR = path.join(YOMILEE_ROOT, 'data');
const SRC_DATA_DIR = path.join(YOMILEE_ROOT, 'src', 'data');
const OUTPUT_JSON_FILE = path.join(DATA_DIR, 'chiikawa_weekly_prediction.json');
const SRC_OUTPUT_JSON_FILE = path.join(SRC_DATA_DIR, 'chiikawa_weekly_prediction.json');
const ANA_FLEET_STATUS_FILE = path.join(DATA_DIR, 'ana_fleet_status.json');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'daily_predictions_snapshot.json');
const FIRST_FLIGHT_HISTORY_FILE = path.join(DATA_DIR, 'chiikawa_first_flight_history.json');
const EVAL_LOG_FILE = path.join(DATA_DIR, 'evaluation_log.jsonl');
const WEEKLY_ARCHIVE_FILE = path.join(DATA_DIR, 'weekly_predictions_archive.jsonl');
const SPOT_STATUS_FILE = path.join(DATA_DIR, 'chiikawa_spot_status.json');
const SRC_SPOT_STATUS_FILE = path.join(SRC_DATA_DIR, 'chiikawa_spot_status.json');
const PREDICTION_BACKUP_DIR = path.resolve(YOMILEE_ROOT, '..', '..', 'private_data', 'flight_db', 'prediction_backups');

// スポット状態のロード＆セーブ
function loadCurrentSpotStatus() {
  if (fs.existsSync(SPOT_STATUS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SPOT_STATUS_FILE, 'utf-8'));
    } catch (e) {
      console.warn('⚠️ chiikawa_spot_status.json 読み込み失敗:', e.message);
    }
  }
  return null;
}

function saveCurrentSpotStatus(spotData) {
  try {
    fs.mkdirSync(path.dirname(SPOT_STATUS_FILE), { recursive: true });
    const content = JSON.stringify(spotData, null, 2);
    atomicWriteFileSync(SPOT_STATUS_FILE, content, 'utf-8');
    if (fs.existsSync(path.dirname(SRC_SPOT_STATUS_FILE))) {
      atomicWriteFileSync(SRC_SPOT_STATUS_FILE, content, 'utf-8');
    }
  } catch (e) {
    console.warn('⚠️ chiikawa_spot_status.json 保存失敗:', e.message);
  }
}

// 羽田スポット/ピア連動評価（同一番号・クイックターン同ピアを穏当に加点）
export function evaluateHndSpotAffinity(currentSpot, candidateDepGate, turnaroundMin = null) {
  return evaluateHndSpotAffinityEnhanced(currentSpot, candidateDepGate, turnaroundMin);
}

// ============================================================================
// 1. 全49国内空港マスター辞書 ＆ 逆引き・時刻ユーティリティ (M1 / M2 完全対応)
// ============================================================================
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
  YGJ: '米子',
  UBJ: '山口宇部',
  KCZ: '高知',
  HKD: '函館',
  KMI: '宮崎',
  AKJ: '旭川',
  MMB: '女満別',
  KMQ: '小松',
  TOY: '富山',
  OIT: '大分',
  TAK: '高松',
  TKS: '徳島',
  AOJ: '青森',
  AXT: '秋田',
  SDJ: '仙台',
  SYO: '庄内',
  ONJ: '大館能代',
  FSZ: '静岡',
  HAC: '八丈島',
  IWJ: '萩・石見',
  TTJ: '鳥取',
  OKJ: '岡山',
  HSG: '佐賀',
  TSJ: '対馬',
  FUJ: '福江',
  IKI: '壱岐',
  KKJ: '北九州',
  KUH: '釧路',
  OBO: '帯広',
  SHB: '中標津',
  WKJ: '稚内',
  MBE: '紋別',
  RIS: '利尻',
  NTQ: '能登',
  GAJ: '山形',
  FKS: '福島',
  MSJ: '三沢',
  HNA: '花巻',
  ASJ: '奄美',
  IZO: '出雲',
  OKI: '隠岐',
  TNE: '種子島',
  YAK: '屋久島'
};

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

function shortAirportName(codeOrName) {
  if (!codeOrName) return '';
  const name = AIRPORT_NAMES[codeOrName] || codeOrName;
  return name
    .replace('東京(羽田)', '羽田')
    .replace('東京(成田)', '成田')
    .replace('大阪(伊丹)', '伊丹')
    .replace('大阪(関空)', '関空')
    .replace('名古屋(中部)', '中部')
    .replace('札幌(新千歳)', '新千歳')
    .replace('沖縄(那覇)', '那覇');
}

function getAirportCodeFromName(name) {
  if (!name) return '';
  const trimmed = String(name).trim();
  if (AIRPORT_NAMES[trimmed]) return trimmed;
  for (const [code, full] of Object.entries(AIRPORT_NAMES)) {
    if (trimmed === full || trimmed.includes(full)) return code;
  }
  const aliasMap = [
    ['羽田', 'HND'], ['成田', 'NRT'], ['伊丹', 'ITM'], ['関空', 'KIX'], ['関西', 'KIX'],
    ['神戸', 'UKB'], ['中部', 'NGO'], ['名古屋', 'NGO'], ['セントレア', 'NGO'],
    ['新千歳', 'CTS'], ['千歳', 'CTS'], ['札幌', 'CTS'], ['福岡', 'FUK'],
    ['那覇', 'OKA'], ['沖縄', 'OKA'], ['石垣', 'ISG'], ['宮古', 'MMY'],
    ['松山', 'MYJ'], ['長崎', 'NGS'], ['熊本', 'KMJ'], ['鹿児島', 'KOJ'],
    ['広島', 'HIJ'], ['米子', 'YGJ'], ['宇部', 'UBJ'], ['高知', 'KCZ'],
    ['函館', 'HKD'], ['宮崎', 'KMI'], ['旭川', 'AKJ'], ['女満別', 'MMB'],
    ['小松', 'KMQ'], ['富山', 'TOY'], ['大分', 'OIT'], ['高松', 'TAK'],
    ['徳島', 'TKS'], ['青森', 'AOJ'], ['秋田', 'AXT'], ['仙台', 'SDJ'],
    ['庄内', 'SYO'], ['大館', 'ONJ'], ['静岡', 'FSZ'], ['八丈島', 'HAC'],
    ['石見', 'IWJ'], ['鳥取', 'TTJ'], ['岡山', 'OKJ'], ['佐賀', 'HSG'],
    ['対馬', 'TSJ'], ['福江', 'FUJ'], ['壱岐', 'IKI'], ['北九州', 'KKJ'],
    ['釧路', 'KUH'], ['帯広', 'OBO'], ['中標津', 'SHB'], ['稚内', 'WKJ'],
    ['紋別', 'MBE'], ['利尻', 'RIS'], ['能登', 'NTQ']
  ];
  for (const [kw, code] of aliasMap) {
    if (trimmed.includes(kw)) return code;
  }
  return '';
}

/**
 * 時刻文字列 ("08:30" や "08:30発 - 10:30着") から分 (0〜1439) を返す。
 * パース不能な場合は null を返す（00:00との混同を防止）。
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function parseDepArrMinutes(timeRangeStr) {
  if (!timeRangeStr || typeof timeRangeStr !== 'string') return { depMin: null, arrMin: null };
  const matches = [...timeRangeStr.matchAll(/(\d{1,2}):(\d{2})/g)];
  if (matches.length >= 2) {
    return {
      depMin: parseInt(matches[0][1], 10) * 60 + parseInt(matches[0][2], 10),
      arrMin: parseInt(matches[1][1], 10) * 60 + parseInt(matches[1][2], 10)
    };
  }
  if (matches.length === 1) {
    const m = parseInt(matches[0][1], 10) * 60 + parseInt(matches[0][2], 10);
    return { depMin: m, arrMin: null };
  }
  return { depMin: null, arrMin: null };
}

function normalizeFlightNo(raw) {
  if (!raw) return '';
  const num = String(raw).replace(/[^0-9]/g, '');
  if (!num) return String(raw).trim();
  return `NH${parseInt(num, 10)}`;
}

/**
 * ODPTの model 表記から、当該フライトにおける B767 (763/76P) のレギュラー（主担当）度を判定し、
 * 機材優先度係数を返す。
 *
 * 【優先度設計】
 * - 3.5: B767 単独確定枠 (model === '763' || model === '76P' || is767Strict)
 *        ➔ 広島、長崎、新千歳、伊丹など、ANA公式ダイヤでB767専任の中核枠。
 * - 1.8: B767 主力・中小型機併記枠 (model が '763/...' で始まるもの: 763/73H, 763/321)
 *        および 主要幹線（新千歳 CTS, 福岡 FUK, 伊丹 ITM, 那覇 OKA）への767充当枠
 *        ➔ 781/772/763 等の表記であっても、幹線でのB767運用は日常的かつ最重要ローテーション枠！
 * - 0.38: 地方ローカル線の他機種主力・代走枠 (model が '788/...', '772/...' 等で地方路線への突発代走)
 * - 0.1: 非767枠 (ODPTで767表記が一切ない枠)
 */
function getAircraftModelPriority(df, learnedModel = null) {
  if (!df) return 0.1;
  const model = String(df.model || '').trim();
  const fn = df.flightNo ? normalizeFlightNo(df.flightNo) : '';
  const histCount = learnedModel?.flightMeta?.[fn]?.count || 0;
  const activeDays = learnedModel?.flightActiveDays?.[fn] || 0;
  const totalObsDays = Math.max(1, learnedModel?.totalObservedDays || 1);
  const empiricalRate = activeDays / totalObsDays;
  const hasSufficientHistory = (learnedModel?.totalFlights || 0) >= 150 && totalObsDays >= 7;

  // 当日・翌日のANA公式リアルタイム確定機材（ANA運航状況）は絶対優先
  if (df.modelSource === 'ANA運航状況') {
    if (df.is767Strict || df.is76P || model === '76P' || model === '763') return 3.8;
    if (df.is767 || model.includes('76')) return 2.2;
    return 0.05;
  }

  // 767を含まない枠（ただし現行シーズンで76P実運航実績が豊富にある定番便は拾う）
  const has76Tag = Boolean(df.is767 || df.is76P || df.is767Strict || model.includes('763') || model.includes('76P'));
  if (!has76Tag) {
    if (hasSufficientHistory && empiricalRate >= 0.35) return 2.4;
    if (hasSufficientHistory && activeDays >= 3) return 1.2;
    return 0.08;
  }

  // Day 2以降（ODPT静的週間ダイヤ）: 実運航DBによる「実績76P充当率」を最重要視し、非76P共用ゴミ枠を徹底排除
  if (hasSufficientHistory) {
    if (activeDays === 0) {
      // 現行ダイヤで76Pが一度も飛んでいない便（米子・小松・関空・宮崎等の非76P枠）を大幅減衰
      return (df.is767Strict || model === '763' || model === '76P') ? 0.18 : 0.06;
    }
    if (empiricalRate >= 0.45 || activeDays >= 10) return 4.2; // 鉄板76Pレギュラー枠
    if (empiricalRate >= 0.25 || activeDays >= 5) return 3.4;  // 主力76P定期枠
    if (activeDays >= 2) return 2.1;                           // 準レギュラー76P枠
    return 0.75;                                               // 1回のみの単発代走実績
  }

  // コールドスタート時（履歴不足時）のフォールバック
  if (df.is767Strict || model === '763' || model === '76P') return 3.5;

  const parts = model.split('/');
  const primaryModel = parts[0]?.trim();
  const dest = df.destCode || df.dest;
  const orig = df.origCode || df.origin;
  const isMajorTrunk = (orig === 'HND' || dest === 'HND') &&
    ['CTS', 'FUK', 'ITM', 'OKA'].includes(orig === 'HND' ? dest : orig);

  if (primaryModel === '763' || primaryModel === '76P') return 1.8;
  if (primaryModel.startsWith('78') || primaryModel.startsWith('77')) {
    return (isMajorTrunk || histCount > 0) ? 1.8 : 0.38;
  }
  return (isMajorTrunk || histCount > 0) ? 1.5 : 0.6;
}

/**
 * 最大剰余法（Hamilton method）により、重み配列を合計100の整数パーセント配列に正規化する。
 */
function normalizeTo100Percent(items, weightKey = 'weight', minPct = 1) {
  if (!items || items.length === 0) return [];
  if (items.length === 1) return [{ ...items[0], probability: 100 }];

  const totalWeight = items.reduce((acc, it) => acc + Math.max(0, Number(it[weightKey]) || 0), 0);
  if (totalWeight <= 0) {
    const base = Math.floor(100 / items.length);
    const rem = 100 - base * items.length;
    return items.map((it, idx) => ({ ...it, probability: base + (idx < rem ? 1 : 0) }));
  }

  const exacts = items.map((it, idx) => {
    const rawPct = (Math.max(0, Number(it[weightKey]) || 0) / totalWeight) * 100;
    const floored = Math.max(minPct, Math.floor(rawPct));
    return {
      idx,
      item: it,
      rawPct,
      floored,
      remainder: rawPct - floored
    };
  });

  let currentSum = exacts.reduce((acc, e) => acc + e.floored, 0);

  if (currentSum < 100) {
    const sortedByRem = [...exacts].sort((a, b) => b.remainder - a.remainder);
    let diff = 100 - currentSum;
    for (let i = 0; i < diff; i++) {
      sortedByRem[i % sortedByRem.length].floored += 1;
    }
  } else if (currentSum > 100) {
    const sortedByVal = [...exacts].sort((a, b) => b.floored - a.floored);
    let diff = currentSum - 100;
    let i = 0;
    while (diff > 0 && i < sortedByVal.length * 10) {
      const target = sortedByVal[i % sortedByVal.length];
      if (target.floored > minPct) {
        target.floored -= 1;
        diff -= 1;
      }
      i++;
    }
  }

  return exacts
    .sort((a, b) => a.idx - b.idx)
    .map(e => ({ ...e.item, probability: e.floored }));
}

// JST日時計算ヘルパー
function getJSTNow() {
  const now = new Date();
  const jstOffset = 9 * 60;
  const localOffset = now.getTimezoneOffset();
  return new Date(now.getTime() + (jstOffset + localOffset) * 60 * 1000);
}

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatJaDate(d) {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = DAY_NAMES[d.getDay()];
  return `${m}月${day}日(${dow})`;
}

/**
 * 指定日のODPTダイヤを取得する。指定日のキーが存在しない場合（過去日バックテスト等）は、
 * 同じ曜日（日曜〜土曜）のODPT週間ダイヤにフォールバックする。
 */
function getDayFlightsWithDowFallback(targetDateStr, anaFleetData) {
  if (!anaFleetData?.dates) return {};
  const dKey = targetDateStr.replace(/-/g, '');
  if (anaFleetData.dates[dKey] && Object.keys(anaFleetData.dates[dKey]).length > 0) {
    return anaFleetData.dates[dKey];
  }
  const targetDow = new Date(`${targetDateStr}T00:00:00+09:00`).getDay();
  for (const [k, map] of Object.entries(anaFleetData.dates)) {
    if (k.length === 8 && Object.keys(map).length > 100) {
      const y = k.slice(0, 4);
      const m = k.slice(4, 6);
      const d = k.slice(6, 8);
      const dow = new Date(`${y}-${m}-${d}T00:00:00+09:00`).getDay();
      if (dow === targetDow) {
        return map;
      }
    }
  }
  return {};
}

function translateStatus(statusText) {
  if (!statusText) return '運航予定';
  if (/Cancelled|Canceled/i.test(statusText)) return '欠航';
  if (/Landed/i.test(statusText)) {
    const timeMatch = statusText.match(/\d{2}:\d{2}/);
    return timeMatch ? `着陸済 (${timeMatch[0]})` : '着陸済';
  }
  if (/Estimated/i.test(statusText)) {
    const timeMatch = statusText.match(/\d{2}:\d{2}/);
    const label = /Estimated dep/i.test(statusText) ? '出発予定' : '到着予定';
    return timeMatch ? `${label} (${timeMatch[0]})` : label;
  }
  if (/Delayed/i.test(statusText)) {
    const timeMatch = statusText.match(/\d{2}:\d{2}/);
    return timeMatch ? `遅延 (${timeMatch[0]}予定)` : '遅延';
  }
  if (/Active|Live|EnRoute|InAir/i.test(statusText)) return '飛行中 ✈️';
  if (/Scheduled/i.test(statusText)) return '定刻予定';
  return statusText;
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  const jst = new Date(d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60 * 1000);
  const hh = String(jst.getHours()).padStart(2, '0');
  const mm = String(jst.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ============================================================================
// 2. ODPT ＆ FR24 データ取得
// ============================================================================
async function loadAnaFleetStatus(options = {}) {
  try {
    return await updateAnaFleetStatusFromODPT(options);
  } catch (e) {
    console.warn('⚠️ ODPT API即時同期スキップ（キャッシュを使用します）:', e.message);
  }
  if (fs.existsSync(ANA_FLEET_STATUS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ANA_FLEET_STATUS_FILE, 'utf-8'));
    } catch (e) {
      console.warn('⚠️ ana_fleet_status.json の読み込みに失敗しました:', e.message);
    }
  }
  return { dates: {} };
}

function fetchChiikawaFlights() {
  const url = 'https://api.flightradar24.com/common/v1/flight/list.json?query=JA609A&fetchBy=reg&page=1&limit=25';
  console.log('📡 Flightradar24 API から JA609A の運航データを取得中...');
  try {
    const cmd = `curl.exe -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`;
    const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    const json = JSON.parse(stdout);
    return json.result?.response?.data || [];
  } catch (e) {
    console.warn('⚠️ curl.exe エラー:', e.message);
    return [];
  }
}

// ============================================================================
// 3. 学習済み知識ベースの動的構築 (Out-of-Sample & ダイヤ改正日フィルタ対応)
// ============================================================================
/**
 * 指定年・月(1-12)の最終日曜日を YYYY-MM-DD で返す（ANA夏/冬ダイヤ改正基準日）
 */
function getLastSundayOfMonth(year, month1Based) {
  const lastDay = new Date(Date.UTC(year, month1Based, 0));
  const dow = lastDay.getUTCDay();
  lastDay.setUTCDate(lastDay.getUTCDate() - dow);
  return lastDay.toISOString().slice(0, 10);
}

/**
 * 基準日 refDateStr が属する現行ANAダイヤシーズン開始日（3月最終日曜 or 10月最終日曜）を動的に算出する
 */
function getSeasonStartDateStr(refDateStr = null) {
  const ref = refDateStr || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const year = parseInt(ref.slice(0, 4), 10) || 2026;
  const candidates = [
    getLastSundayOfMonth(year - 1, 10),
    getLastSundayOfMonth(year, 3),
    getLastSundayOfMonth(year, 10),
  ].sort();
  let latest = candidates[0];
  for (const c of candidates) {
    if (c <= ref) latest = c;
  }
  return latest;
}

function getDowType(dateStr) {
  if (!dateStr) return 'weekday';
  const dow = new Date(`${dateStr}T00:00:00+09:00`).getUTCDay();
  return (dow === 0 || dow === 6) ? 'weekend' : 'weekday';
}

/**
 * fleetDb から、現行ダイヤシーズン開始日(seasonStartDateStr)以降かつ指定日(cutoffDateStr)未満の履歴のみを用いて
 * マルコフ遷移行列・ナイトステイ初便分布・路線頻度・同時到着シチュエーション別遷移を動的に集計する。
 */
export function buildLearnedModel(fleetDb, cutoffDateStr = null, seasonStartDateStr = null) {
  const transitions = {};
  const transitionsByDow = { weekday: {}, weekend: {} };
  const secondOrderTransitions = {}; // secondOrderTransitions['prevFn>curFn'][nextFn] = count
  const situationTransitions = {}; // situationTransitions[airport][inFn][coArrFn][outFn] = count
  const nightStays = {};
  const nightStaysByDow = { weekday: {}, weekend: {} };
  const nightStaysByExactDow = {}; // 0(日)..6(土) -> airport -> fn -> count
  const overnightArrivalTransitions = {}; // airport -> prevLastFn -> nextFirstFn -> count
  const prevDayStartTransitions = {};     // airport -> prevStartAirport(-2d泊) -> nextFirstFn -> count
  const prevDayFirstTransitions = {};     // airport -> prevFirstFn(-1d初便) -> nextFirstFn -> count
  const fullDaySequences = {}; // fullDaySequences[startAirport]['NH661>NH664>...'] = count
  const prefixSequences = {};  // prefixSequences[startAirport]['NH661>NH664>NH27'] = count
  const stayTransitions = {};  // stayTransitions[startAirport][endAirport] = count
  const stayTransitionsByDow = { weekday: {}, weekend: {} };
  const routeFreq = {};
  const flightMeta = {};
  const flightActiveDatesSet = {}; // fn -> Set(date)
  const observedDatesSet = new Set();
  const activeRegs = new Set();

  const effectiveSeasonStart = seasonStartDateStr || getSeasonStartDateStr(cutoffDateStr);

  const allFlights = Object.values(fleetDb?.flights || {}).filter(f => {
    if (!f || !f.flightNo || !f.flightNo.startsWith('NH')) return false;
    const fnNum = parseInt(f.flightNo.replace(/[^0-9]/g, ''), 10);
    if (!fnNum || fnNum >= 2000) return false;
    if (effectiveSeasonStart && f.date < effectiveSeasonStart) return false;
    if (cutoffDateStr && f.date >= cutoffDateStr) return false;
    return true;
  });

  // 機体ごとに日付・時刻順でソートして遷移とナイトステイを再構築
  const byReg = {};
  for (const f of allFlights) {
    const normFn = normalizeFlightNo(f.flightNo);
    const depMin = parseTimeToMinutes(f.depTime);
    const arrMin = parseTimeToMinutes(f.arrTime);
    if (depMin === null) continue;
    activeRegs.add(f.reg);
    observedDatesSet.add(f.date);
    if (!flightActiveDatesSet[normFn]) flightActiveDatesSet[normFn] = new Set();
    flightActiveDatesSet[normFn].add(f.date);

    const rKey = `${f.orig}-${f.dest}`;
    routeFreq[rKey] = (routeFreq[rKey] || 0) + 1;

    if (!flightMeta[normFn]) {
      flightMeta[normFn] = { flightNo: normFn, orig: f.orig, dest: f.dest, depTime: f.depTime, arrTime: f.arrTime, count: 0 };
    }
    flightMeta[normFn].count += 1;

    if (!byReg[f.reg]) byReg[f.reg] = [];
    byReg[f.reg].push({ ...f, normFn, depMin, arrMin: arrMin ?? (depMin + 90) });
  }

  const flightActiveDays = {};
  for (const [fn, dSet] of Object.entries(flightActiveDatesSet)) {
    flightActiveDays[fn] = dSet.size;
  }

  for (const reg of Object.keys(byReg)) {
    const list = byReg[reg];
    list.sort((a, b) => a.date.localeCompare(b.date) || a.depMin - b.depMin);

    // 日付ごとにグループ化
    const byDate = {};
    for (const f of list) {
      if (!byDate[f.date]) byDate[f.date] = [];
      // 同一日・同一便名の重複排除
      if (!byDate[f.date].some(x => x.normFn === f.normFn)) {
        byDate[f.date].push(f);
      }
    }

    const dates = Object.keys(byDate).sort();
    for (let dIdx = 0; dIdx < dates.length; dIdx++) {
      const d = dates[dIdx];
      const dayList = byDate[d];
      if (dayList.length === 0) continue;

      // 朝一初便をナイトステイ実績に記録（午前11:00以前出発の初便、または前日最終到着地と一致する初便）
      const firstF = dayList[0];
      const lastF = dayList[dayList.length - 1];
      const prevDate = dIdx > 0 ? dates[dIdx - 1] : null;
      const prevDayList = prevDate ? byDate[prevDate] : null;
      const prevLastDest = prevDayList && prevDayList.length > 0 ? prevDayList[prevDayList.length - 1].dest : null;

      const dowType = getDowType(d);
      const exactDow = new Date(`${d}T00:00:00+09:00`).getUTCDay();
      // 羽田泊の真の朝一初便は 09:30(570分)以前出発のみ（10:00 NH59や11:00 NH21は地方泊帰還機の折返し枠のため除外）
      const isValidMorningStart = firstF.orig === 'HND'
        ? (firstF.depMin >= 360 && firstF.depMin <= 570)
        : (firstF.depMin <= 660 || (prevLastDest && prevLastDest === firstF.orig));

      if (isValidMorningStart) {
        if (!nightStays[firstF.orig]) nightStays[firstF.orig] = {};
        nightStays[firstF.orig][firstF.normFn] = (nightStays[firstF.orig][firstF.normFn] || 0) + 1;
        if (!nightStaysByDow[dowType][firstF.orig]) nightStaysByDow[dowType][firstF.orig] = {};
        nightStaysByDow[dowType][firstF.orig][firstF.normFn] = (nightStaysByDow[dowType][firstF.orig][firstF.normFn] || 0) + 1;
        if (!nightStaysByExactDow[exactDow]) nightStaysByExactDow[exactDow] = {};
        if (!nightStaysByExactDow[exactDow][firstF.orig]) nightStaysByExactDow[exactDow][firstF.orig] = {};
        nightStaysByExactDow[exactDow][firstF.orig][firstF.normFn] = (nightStaysByExactDow[exactDow][firstF.orig][firstF.normFn] || 0) + 1;

        // 連続日の前夜最終到着便(-1d) および 前日始発空港(-2d泊) / 前日初便(-1d初便) -> 翌朝初便の相関を学習
        if (prevDate && prevDayList && prevDayList.length > 0) {
          const dayDiffMs = Date.parse(`${d}T00:00:00Z`) - Date.parse(`${prevDate}T00:00:00Z`);
          const prevLastF = prevDayList[prevDayList.length - 1];
          const prevFirstF = prevDayList[0];
          if (dayDiffMs === 86400000 && prevLastF.dest === firstF.orig && (prevLastF.arrMin ?? 0) >= 1020) {
            if (!overnightArrivalTransitions[firstF.orig]) overnightArrivalTransitions[firstF.orig] = {};
            if (!overnightArrivalTransitions[firstF.orig][prevLastF.normFn]) overnightArrivalTransitions[firstF.orig][prevLastF.normFn] = {};
            overnightArrivalTransitions[firstF.orig][prevLastF.normFn][firstF.normFn] =
              (overnightArrivalTransitions[firstF.orig][prevLastF.normFn][firstF.normFn] || 0) + 1;

            if (prevFirstF?.orig) {
              if (!prevDayStartTransitions[firstF.orig]) prevDayStartTransitions[firstF.orig] = {};
              if (!prevDayStartTransitions[firstF.orig][prevFirstF.orig]) prevDayStartTransitions[firstF.orig][prevFirstF.orig] = {};
              prevDayStartTransitions[firstF.orig][prevFirstF.orig][firstF.normFn] =
                (prevDayStartTransitions[firstF.orig][prevFirstF.orig][firstF.normFn] || 0) + 1;
            }
            if (prevFirstF?.normFn) {
              if (!prevDayFirstTransitions[firstF.orig]) prevDayFirstTransitions[firstF.orig] = {};
              if (!prevDayFirstTransitions[firstF.orig][prevFirstF.normFn]) prevDayFirstTransitions[firstF.orig][prevFirstF.normFn] = {};
              prevDayFirstTransitions[firstF.orig][prevFirstF.normFn][firstF.normFn] =
                (prevDayFirstTransitions[firstF.orig][prevFirstF.normFn][firstF.normFn] || 0) + 1;
            }
          }
        }

        // 3便以上の完結した1日スジから、完全1日スジ・プレフィックス・宿泊地遷移を学習
        if (dayList.length >= 3) {
          const startAp = firstF.orig;
          const endAp = lastF.dest;
          const seqStr = dayList.map(x => x.normFn).join('>');
          if (!fullDaySequences[startAp]) fullDaySequences[startAp] = {};
          fullDaySequences[startAp][seqStr] = (fullDaySequences[startAp][seqStr] || 0) + 1;

          const p3 = dayList.slice(0, 3).map(x => x.normFn).join('>');
          if (!prefixSequences[startAp]) prefixSequences[startAp] = {};
          prefixSequences[startAp][p3] = (prefixSequences[startAp][p3] || 0) + 1;

          if (!stayTransitions[startAp]) stayTransitions[startAp] = {};
          stayTransitions[startAp][endAp] = (stayTransitions[startAp][endAp] || 0) + 1;
          if (!stayTransitionsByDow[dowType][startAp]) stayTransitionsByDow[dowType][startAp] = {};
          stayTransitionsByDow[dowType][startAp][endAp] = (stayTransitionsByDow[dowType][startAp][endAp] || 0) + 1;
        }
      }

      // 同日内の1次・2次マルコフ遷移を記録
      for (let i = 0; i < dayList.length - 1; i++) {
        const curr = dayList[i];
        const next = dayList[i + 1];
        if (curr.dest === next.orig && next.depMin >= curr.arrMin) {
          if (!transitions[curr.normFn]) transitions[curr.normFn] = {};
          transitions[curr.normFn][next.normFn] = (transitions[curr.normFn][next.normFn] || 0) + 1;
          if (!transitionsByDow[dowType][curr.normFn]) transitionsByDow[dowType][curr.normFn] = {};
          transitionsByDow[dowType][curr.normFn][next.normFn] = (transitionsByDow[dowType][curr.normFn][next.normFn] || 0) + 1;

          if (i >= 1) {
            const prev = dayList[i - 1];
            if (prev.dest === curr.orig && curr.depMin >= prev.arrMin) {
              const pairKey = `${prev.normFn}>${curr.normFn}`;
              if (!secondOrderTransitions[pairKey]) secondOrderTransitions[pairKey] = {};
              secondOrderTransitions[pairKey][next.normFn] = (secondOrderTransitions[pairKey][next.normFn] || 0) + 1;
            }
          }
        }
      }
    }
  }

  // 同時刻帯・同機種到着シチュエーション別の遷移実績を動的に集計
  // situationTransitions[airport][inFn][coArrFn][outFn] = count
  const arrivalsByDateAirport = {};
  for (const reg of Object.keys(byReg)) {
    const list = byReg[reg];
    const byDate = {};
    for (const f of list) {
      if (!byDate[f.date]) byDate[f.date] = [];
      if (!byDate[f.date].some(x => x.normFn === f.normFn)) byDate[f.date].push(f);
    }
    for (const [d, dayList] of Object.entries(byDate)) {
      for (let i = 0; i < dayList.length - 1; i++) {
        const curr = dayList[i];
        const next = dayList[i + 1];
        if (curr.dest === next.orig && next.depMin >= curr.arrMin) {
          const daKey = `${d}_${curr.dest}`;
          if (!arrivalsByDateAirport[daKey]) arrivalsByDateAirport[daKey] = [];
          arrivalsByDateAirport[daKey].push({
            reg,
            airport: curr.dest,
            inFn: curr.normFn,
            arrMin: curr.arrMin,
            outFn: next.normFn
          });
        }
      }
    }
  }

  for (const events of Object.values(arrivalsByDateAirport)) {
    if (events.length < 2) continue;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      for (let j = 0; j < events.length; j++) {
        if (i === j) continue;
        const co = events[j];
        if (co.reg === ev.reg) continue;
        if (Math.abs(co.arrMin - ev.arrMin) <= 45) {
          if (!situationTransitions[ev.airport]) situationTransitions[ev.airport] = {};
          if (!situationTransitions[ev.airport][ev.inFn]) situationTransitions[ev.airport][ev.inFn] = {};
          if (!situationTransitions[ev.airport][ev.inFn][co.inFn]) situationTransitions[ev.airport][ev.inFn][co.inFn] = {};
          situationTransitions[ev.airport][ev.inFn][co.inFn][ev.outFn] =
            (situationTransitions[ev.airport][ev.inFn][co.inFn][ev.outFn] || 0) + 1;
        }
      }
    }
  }

  return {
    transitions,
    transitionsByDow,
    secondOrderTransitions,
    situationTransitions,
    nightStays,
    nightStaysByDow,
    nightStaysByExactDow,
    overnightArrivalTransitions,
    prevDayStartTransitions,
    prevDayFirstTransitions,
    fullDaySequences,
    prefixSequences,
    stayTransitions,
    stayTransitionsByDow,
    routeFreq,
    flightMeta,
    flightActiveDays,
    totalObservedDays: observedDatesSet.size,
    seasonStartDate: effectiveSeasonStart,
    totalFlights: allFlights.length,
    activeFleetCount: Math.max(activeRegs.size, 11),
    overnightPairs: overnightPairs(Object.fromEntries(allFlights.map((f, i) => [i, f])))
  };
}

// ============================================================================
// 4. 状態付きフリート割当・他機体消去法エンジン (P4: S5, S6, M3 対応)
// ============================================================================
function buildAssignedOtherRegFlights(fleetDb, todayStr, anaFleetData, learnedModel) {
  const assignedMap = new Map(); // flightNo -> reg
  const dKey = todayStr.replace(/-/g, '');
  const dayFlights = anaFleetData?.dates?.[dKey] || {};
  const transitions = learnedModel?.transitions || fleetDb?.flightTransitions || {};

  // 1. 欠航便を除外登録
  for (const df of Object.values(dayFlights)) {
    if (df.isCancelled) {
      assignedMap.set(df.flightNo, 'CANCELLED(欠航)');
    }
  }

  // 2. 本日 JA609A 以外の機体が実際に飛んだ便を登録
  const allDbFlights = Object.values(fleetDb?.flights || {}).filter(
    f => f.date === todayStr && f.reg && f.reg !== 'JA609A'
  );
  const byReg = {};
  for (const f of allDbFlights) {
    if (!f.flightNo || !f.flightNo.startsWith('NH')) continue;
    const fnNum = parseInt(f.flightNo.replace(/[^0-9]/g, ''), 10);
    if (!fnNum || fnNum >= 2000) continue;
    const normFn = `NH${fnNum}`;
    assignedMap.set(normFn, f.reg);
    if (!byReg[f.reg]) byReg[f.reg] = [];
    byReg[f.reg].push({ ...f, normFn });
  }

  // 3. 各他機体の最終到着地から、地方空港折り返し＆高確率マルコフ遷移スジを再帰的に追跡してロック
  for (const [reg, list] of Object.entries(byReg)) {
    list.sort((a, b) => (parseTimeToMinutes(a.depTime) ?? 0) - (parseTimeToMinutes(b.depTime) ?? 0));
    let curF = list[list.length - 1];
    let safetyDepth = 0;

    while (curF && safetyDepth < 4) {
      safetyDepth++;
      const curArrMins = parseTimeToMinutes(curF.arrTime);
      if (curArrMins === null) break;

      // 地方空港（HND以外）にいる場合、その地方空港からの折り返し76P便は100%その機体が担当する
      if (curF.dest && curF.dest !== 'HND') {
        const candidates = Object.values(dayFlights).filter(df => {
          if (!df.is767 || df.isCancelled || df.origin !== curF.dest) return false;
          if (assignedMap.has(df.flightNo)) return false;
          const depM = parseTimeToMinutes(df.depTime);
          return depM !== null && depM >= curArrMins + 30 && depM <= curArrMins + 150;
        });

        if (candidates.length > 0) {
          // マルコフ遷移実績がある便を最優先、なければ直近出発便
          candidates.sort((a, b) => {
            const trA = transitions[curF.normFn]?.[a.flightNo] || 0;
            const trB = transitions[curF.normFn]?.[b.flightNo] || 0;
            if (trB !== trA) return trB - trA;
            return (parseTimeToMinutes(a.depTime) ?? 0) - (parseTimeToMinutes(b.depTime) ?? 0);
          });
          const lockedNext = candidates[0];
          assignedMap.set(lockedNext.flightNo, `${reg}(地方折返し確定)`);
          curF = {
            normFn: lockedNext.flightNo,
            orig: lockedNext.origin,
            dest: lockedNext.dest,
            depTime: lockedNext.depTime,
            arrTime: lockedNext.arrTime
          };
          continue;
        }
      }
      break;
    }
  }

  return assignedMap;
}

/**
 * 羽田空港における同時刻帯の他767機材とのターンアラウンド競合＆ゲート近接度スコアを計算する
 */
function evaluateHndTurnaroundScore(arrMins, candidateDepFlight, dayFlights, currentSpot = null, learnedModel = null) {
  const depM = parseTimeToMinutes(candidateDepFlight.depTime);
  if (depM === null || arrMins === null) return 1.0;
  const turnaround = depM - arrMins;
  if (turnaround < 35) return 0.05;

  // 1. ターンアラウンド時間の自然さ（50〜85分が理想ゾーンだが、幹線等の90〜105分待機も自然な運用として過度に冷遇しない）
  let factor = 1.0;
  if (turnaround >= 50 && turnaround <= 85) {
    factor = 1.55; // 理想ゾーン
  } else if (turnaround >= 35 && turnaround < 50) {
    factor = 1.25;
  } else if (turnaround > 85 && turnaround <= 105) {
    factor = 1.28; // 幹線・遅延バッファ込みの自然な待機（95分ターン等）
  } else if (turnaround > 105 && turnaround <= 125) {
    factor = 0.65; // 2時間近い待機（他に自然な折り返し便があれば劣後）
  } else if (turnaround > 125 && turnaround <= 150) {
    factor = 0.30; // 2時間超待機（大きく劣後）
  } else if (turnaround > 150 && turnaround <= 180) {
    factor = 0.14; // 2時間半〜3時間待機（日中稼働機としては極めて不自然なため大幅減衰）
  } else {
    factor = 0.05; // 3時間超の駐機（夕方以降のステイ便待機を除き原則選外）
  }

  // 2. 機材モデル（レギュラー確定枠 vs 763主力枠 vs 他機種レギュラー代走枠）の優先度反映
  const modelPrio = getAircraftModelPriority(candidateDepFlight, learnedModel);
  if (modelPrio >= 3.0) {
    factor *= 1.35; // 763単独確定枠ボーナス
  } else if (modelPrio >= 1.5) {
    factor *= 1.15; // 763主力枠ボーナス
  } else if (modelPrio <= 0.4) {
    // 他機種（B787/B777等）レギュラーの代走・突発枠は通常減衰
    factor *= 0.45;
  } else {
    factor *= 0.7;
  }

  // 3. 同時刻帯に羽田へ到着する他767便との競合評価
  const allFlights = Object.values(dayFlights || {});
  const hndArrivals = allFlights.filter(f => f.dest === 'HND' && f.is767 && !f.isCancelled);
  const betterOtherArrivals = hndArrivals.filter(arr => {
    const otherArrM = parseTimeToMinutes(arr.actArrTime || arr.arrTime);
    if (otherArrM === null || Math.abs(otherArrM - arrMins) <= 8) return false;
    const otherTurn = depM - otherArrM;
    return otherTurn >= 48 && otherTurn <= 70;
  });

  if (betterOtherArrivals.length > 0 && (turnaround < 45 || turnaround > 85)) {
    factor *= Math.max(0.55, 1.0 - betterOtherArrivals.length * 0.18);
  }

  // 4. 【スポット連動判定】羽田駐機スポット ➔ 次便出発ゲート連動評価！
  if (currentSpot && candidateDepFlight.depGate) {
    const spotAffinity = evaluateHndSpotAffinity(currentSpot, candidateDepFlight.depGate, turnaround);
    factor *= spotAffinity;
  }

  return factor;
}

// ============================================================================
// 5. 当日残り便 ＆ 今夜の宿泊地ベイズ推定エンジン (P2: S1, S2 完全対応)
// ============================================================================
/**
 * 本日の確定済み最終便 lastToday から、当日ODPTダイヤ（未ロック76P便）＋マルコフ遷移行列を用いて
 * 1日の終着（地方ナイトステイまたは羽田帰還泊）までの全有効パスを深さ優先探索し、
 * ベイズ事後確率によって todayPlans, nightStayProbabilities, predictedRemainingToday を動的算出する。
 */
function predictTodayRemainderAndNightStay(todayFlights, todayStr, anaFleetData, learnedModel, assignedOtherMap) {
  const dKey = todayStr.replace(/-/g, '');
  const dayFlights = anaFleetData?.dates?.[dKey] || {};
  const transitions = learnedModel.transitions || {};
  const routeFreq = learnedModel.routeFreq || {};

  const jstNow = getJSTNow();
  const nowMin = (todayStr === formatDate(jstNow)) ? (jstNow.getHours() * 60 + jstNow.getMinutes()) : null;

  const alreadyFlownSet = new Set(todayFlights.map(f => normalizeFlightNo(f.flightNo)));
  const lastToday = todayFlights.length > 0 ? todayFlights[todayFlights.length - 1] : null;

  if (!lastToday) {
    // 当日1便も飛んでいない場合でも、20:30(1230分)以降で羽田発の残り767便が完全に0本なら整備・予備機ステイ確定と判定
    const remHnd767 = (nowMin !== null && nowMin >= 1230) ? Object.values(dayFlights).filter(df => {
      if (df.origin !== 'HND' || df.isCancelled) return false;
      if (assignedOtherMap.has(df.flightNo)) return false;
      if (/^(Departed|InAir|Arrived|Landed|TakeOff)$/i.test(String(df.status || '').trim())) return false;
      const is76 = Boolean(df.is767 || df.is76P || String(df.model || '').includes('76'));
      if (!is76) return false;
      const dm = parseTimeToMinutes(df.actDepTime || df.depTime);
      return dm !== null && dm + 40 >= nowMin;
    }) : [1];
    const confirmedIdle = (nowMin !== null && nowMin >= 1230 && remHnd767.length === 0);
    return {
      isNightStayConfirmed: confirmedIdle,
      nightStayCode: 'HND',
      nightStayName: confirmedIdle ? '東京(羽田) (確定)' : '東京(羽田) (予定)',
      nightStayProbabilities: [{ airport: '東京(羽田)', code: 'HND', probability: 100 }],
      predictedRemainingToday: [],
      todayPlans: [],
      pendingNightStayNote: confirmedIdle ? '本日の運航はなく羽田駐機でナイトステイ確定と判定されました。' : '本日の初便運航データ取得待ちです。',
      currentSpot: null,
      spotConfidenceNote: null
    };
  }

  const startFn = normalizeFlightNo(lastToday.flightNo);
  const startAirport = lastToday.destCode;
  const odptLast = dayFlights[startFn];
  const startSchedArrMin = parseTimeToMinutes(odptLast?.arrTime || lastToday.arrTime) ?? 950;
  const startActArrMin = parseTimeToMinutes(odptLast?.actArrTime || lastToday.arrTime || odptLast?.arrTime) ?? startSchedArrMin;

  // スポット情報の解決: CLI引数(--spot) > 保存済みステータス(chiikawa_spot_status.json) > ODPT到着ゲート/ピア(arrGate)
  let currentSpot = null;
  let spotConfidenceNote = null;
  const spotArg = process.argv.find(a => a.startsWith('--spot='));
  if (spotArg) {
    currentSpot = spotArg.split('=')[1]?.trim();
  } else {
    const spotIdx = process.argv.indexOf('--spot');
    if (spotIdx !== -1 && process.argv[spotIdx + 1]) {
      currentSpot = process.argv[spotIdx + 1].trim();
    }
  }
  if (currentSpot) {
    spotConfidenceNote = `羽田空港 ${currentSpot}番スポット（手動指定）連動判定`;
    saveCurrentSpotStatus({
      dateStr: todayStr,
      airport: startAirport,
      spot: currentSpot,
      flightNo: lastToday.flightNo,
      source: 'CLI',
      updatedAt: new Date().toISOString()
    });
  } else {
    const saved = loadCurrentSpotStatus();
    const savedTime = Date.parse(saved?.updatedAt || '');
    const isSameDaySpot = !saved?.dateStr || saved.dateStr === todayStr;
    if (saved && isSameDaySpot && saved.airport === startAirport && saved.spot &&
        normalizeFlightNo(saved.flightNo) === startFn &&
        Number.isFinite(savedTime) && Date.now() - savedTime >= 0 &&
        Date.now() - savedTime <= 6 * 60 * 60 * 1000 && (lastToday.isLanded || lastToday.isLive)) {
      currentSpot = String(saved.spot).trim();
      spotConfidenceNote = saved.note || `羽田空港 ${currentSpot} 連動判定適用中`;
    } else if (startAirport === 'HND' && odptLast?.arrGate) {
      const resolved = resolveHndSpotFromOdptGate(odptLast.arrGate, startAirport);
      if (resolved) {
        currentSpot = resolved.spot;
        spotConfidenceNote = resolved.note;
        saveCurrentSpotStatus({
          dateStr: todayStr,
          airport: startAirport,
          spot: resolved.spot,
          pier: resolved.pier,
          rawArrGate: odptLast.arrGate,
          flightNo: lastToday.flightNo,
          source: resolved.source,
          note: resolved.note,
          updatedAt: new Date().toISOString()
        });
      }
    }
  }

  // B767全機の羽田発着二部グラフ同時割当（他機体の本命便占有を考慮）
  const hndBipartiteToday = buildHndBipartiteMatching(dayFlights, learnedModel, assignedOtherMap);
  // 当日シップチェンジ検知: 本来76Pだった便が他機種へ離脱(demotedFrom76P)し、別便が新たに76Pへ昇格(promotedTo76P)した場合、
  // 既存76P枠は他機体が担当しているため、余剰となった76P機は「新たに76Pへ昇格した便」へ最優先で振り替えられる
  const hasDemoted76P = Object.values(dayFlights).some(f => f?.demotedFrom76P);
  const promoted76PFlights = new Set(
    Object.values(dayFlights).filter(f => f?.promotedTo76P && f?.is76P && !f?.isCancelled).map(f => normalizeFlightNo(f.flightNo))
  );
  if (promoted76PFlights.size > 0) {
    console.log(`🔄 [当日シップチェンジ連動] 他機種➔76P昇格便を検知: ${[...promoted76PFlights].join(', ')} (離脱76P有り: ${hasDemoted76P})`);
  }

  // 羽田到着ピア × 出発ゲートピアの排他判定（遅延による変更を避けるため「羽田到着後(isLanded)」にのみ判断）
  const pierExclusiveLock = (startAirport === 'HND' && lastToday.isLanded && currentSpot)
    ? evaluateHndPierExclusiveLock({
        curArrFn: startFn,
        curArrMin: startActArrMin,
        currentSpot,
        dayFlights,
        assignedOtherMap,
        alreadyFlownSet,
        nowMin
      })
    : { isPierLocked: false };
  if (pierExclusiveLock.isPierLocked) {
    console.log(`🔒 [到着位置連動・充当見込み] ${pierExclusiveLock.reason}`);
  }

  // すでに他機材で出発済み・飛行中・到着済み、または出発時刻から十分経過して未搭乗確定の便を判定
  const isFlightAlreadyGone = (df, isPairOrReturn = false) => {
    const statusStr = String(df.status || '').trim();
    if (/^(Departed|InAir|Arrived|Landed|TakeOff)$/i.test(statusStr)) return true;
    const effectiveDepM = parseTimeToMinutes(df.actDepTime || df.depTime);
    if (nowMin !== null && effectiveDepM !== null) {
      const graceMin = (isPairOrReturn || /Delayed/i.test(statusStr)) ? 75 : 35;
      if (nowMin > effectiveDepM + graceMin) return true;
    }
    return false;
  };

  // ✈️ 【新ロジック: 到着先空港から到着30分後以降に出発する76P便がないことによる早期ナイトステイ確定】
  // 到着先空港（startAirport）から物理的に出発可能な後続767便（未割当・未出発）を厳密に検索
  // 最短折り返し時間: 羽田35分、地方空港30分
  const minTurn = startAirport === 'HND' ? 35 : 30;
  const immediateNext767 = Object.values(dayFlights).filter(df => {
    if (df.origin !== startAirport || df.isCancelled) return false;
    if (alreadyFlownSet.has(df.flightNo)) return false;
    if (assignedOtherMap.has(df.flightNo)) return false;

    // ⚠️ 当日公式ダイヤで別機種確定（78Pや738等への変更）の便は即座に完全除外
    const is76 = Boolean(df.is767 || df.is76P || String(df.model || '').includes('76'));
    if (!is76) return false;

    const depM = parseTimeToMinutes(df.actDepTime || df.depTime);
    const isPairOrReturn = (lastToday.origCode && df.dest === lastToday.origCode) || ((transitions[startFn]?.[df.flightNo] || 0) > 0);
    if (isFlightAlreadyGone(df, isPairOrReturn)) return false;

    const schedTurn = (parseTimeToMinutes(df.depTime) ?? 0) - startSchedArrMin;
    // 到着予定時刻 + 30分（羽田は35分）以降に出発する便があるか
    if (depM !== null && depM >= startActArrMin + minTurn) return true;
    // 💡 玉突き遅延候補: 前便が遅延しても、ピストン折返しや強い遷移実績がある便は出発を遅延させて同一機材で運航する
    if (isPairOrReturn && schedTurn >= minTurn && schedTurn <= 120) return true;
    return false;
  });

  // ナイトステイ確定判定（早期確定対応）:
  // ① 地方空港（startAirport !== 'HND'）:
  //    夕方17:00以降着（または現在17:00以降）で、到着から30分後以降に出発する76P便が0便の場合、即座に確定！
  // ② 羽田空港（startAirport === 'HND'）:
  //    夕方17:30以降着（または現在18:00以降）で、後続の未出発76P便が0便の場合、羽田ステイ確定！
  // ③ 深夜23:00以降着（1380分以降）
  const isRegional = startAirport !== 'HND';
  const isEveningForAirport = isRegional
    ? (startActArrMin >= 1020 || (nowMin !== null && nowMin >= 1020)) // 地方空港は17:00以降
    : (startActArrMin >= 1050 || (nowMin !== null && nowMin >= 1080)); // 羽田は17:30/18:00以降

  if (startActArrMin >= 1380 || (isEveningForAirport && immediateNext767.length === 0)) {
    const stayName = AIRPORT_NAMES[startAirport] || startAirport;
    const confirmReason = isRegional
      ? `${stayName}到着後（+30分以降）に出発する当日の76P便が0便のためナイトステイ確定`
      : '羽田到着後、当日の後続76P便が存在しないため羽田ナイトステイ確定';
    console.log(`🌙 【早期ナイトステイ確定】${confirmReason} (${stayName})`);
    return {
      isNightStayConfirmed: true,
      nightStayCode: startAirport,
      nightStayName: `${stayName} (確定)`,
      nightStayProbabilities: [{ airport: stayName, code: startAirport, probability: 100 }],
      predictedRemainingToday: [],
      todayPlans: [],
      pendingNightStayNote: '',
      currentSpot,
      spotConfidenceNote: spotConfidenceNote || (currentSpot ? `羽田空港 ${currentSpot} 連動判定` : null)
    };
  }

  // DFSで残りの有効フライトパスを探索
  const completedPaths = []; // { remFlights: [...], finalStayCode, weight, reason }

  function dfs(curAirport, curArrMin, curSchedArrMin, curFn, pathFlights, pathWeight, depth) {
    // 終端判定: 深さ上限または深夜23:00以降の運用限界
    if (depth >= 5 || curArrMin >= 1380) {
      completedPaths.push({
        remFlights: [...pathFlights],
        finalStayCode: curAirport,
        weight: pathWeight
      });
      return;
    }

    // 羽田に夕方17:00以降に到着している場合、「このまま羽田で運航終了（羽田ナイトステイ）」という選択肢も評価
    if (curAirport === 'HND' && curArrMin >= 1020) {
      const outTrans = transitions[curFn] || {};
      const totalOutCount = Object.values(outTrans).reduce((a, b) => a + b, 0);
      let hndStopFactor = 0.35;
      if (curArrMin >= 1200) hndStopFactor = 2.4;       // 20:00以降羽田着なら羽田泊の公算大
      else if (curArrMin >= 1110) hndStopFactor = 0.65; // 18:30〜20:00羽田着
      else if (curArrMin >= 1020 && totalOutCount <= 4) hndStopFactor = 0.5; // 17:00〜18:30羽田着

      completedPaths.push({
        remFlights: [...pathFlights],
        finalStayCode: 'HND',
        weight: pathWeight * hndStopFactor
      });
    }

    // 次便候補を当日ODPTダイヤから検索（なるべく理想折り返しから探すが、機材繰りによる長め待機もソフトに許容）
    const minTurn = curAirport === 'HND' ? 35 : 30;
    const maxTurn = curAirport === 'HND' ? 240 : 180;

    let candidates = Object.values(dayFlights).filter(df => {
      if (df.origin !== curAirport || df.isCancelled) return false;
      if (alreadyFlownSet.has(df.flightNo)) return false;
      if (pathFlights.some(pf => pf.flightNo === df.flightNo)) return false;
      if (assignedOtherMap.has(df.flightNo)) return false;

      // ⚠️ 重大修正: 当日公式ダイヤで別機種確定（78P, 772, 738, 321等）の便は即座に完全除外！
      const is76 = Boolean(df.is767 || df.is76P || String(df.model || '').includes('76'));
      if (!is76) return false;

      const isPairOrReturn = (transitions[curFn]?.[df.flightNo] || 0) > 0;
      if (isFlightAlreadyGone(df, isPairOrReturn)) return false;

      const schedDepM = parseTimeToMinutes(df.depTime);
      const actDepM = parseTimeToMinutes(df.actDepTime || df.depTime);
      if (schedDepM === null) return false;

      // 実到着時刻ベースで間に合うか（羽田では実到着見込+35分以降に出発する便のみを厳密に許可し、定時出発済み・先行便を除外）
      const isActTurnValid = actDepM !== null && actDepM >= curArrMin + minTurn && actDepM <= curArrMin + maxTurn;
      const isSchedTurnValid = (curAirport !== 'HND') &&
        schedDepM >= curSchedArrMin + minTurn && schedDepM <= curSchedArrMin + maxTurn;

      return isActTurnValid || isSchedTurnValid;
    });

    // 76P確定便があれば76P便に絞る（ただしマルコフ遷移実績がある便は残す）
    const b767Cands = candidates.filter(df => df.is767 || df.is76P || String(df.model || '').includes('76'));
    if (b767Cands.length > 0) {
      candidates = b767Cands;
    } else {
      candidates = candidates.filter(df => df.dest === 'HND').slice(0, 2);
    }

    if (candidates.length === 0) {
      if (curAirport === 'HND' || curArrMin >= 1020) {
        completedPaths.push({
          remFlights: [...pathFlights],
          finalStayCode: curAirport,
          weight: pathWeight * 0.5
        });
      }
      return;
    }

    // 各候補便の遷移スコアを計算して上位3分岐を探索
    const scored = candidates.map(df => {
      const schedDepM = parseTimeToMinutes(df.depTime) ?? (curSchedArrMin + 55);
      const schedArrM = parseTimeToMinutes(df.arrTime) ?? (schedDepM + 95);
      const actDepM = parseTimeToMinutes(df.actDepTime || df.depTime) ?? schedDepM;
      const actArrM = parseTimeToMinutes(df.actArrTime || df.arrTime) ?? schedArrM;
      const flightDuration = Math.max(55, schedArrM - schedDepM);

      // 前便遅延に伴い出発が押し出される場合の実到着見込み時刻を計算
      const estDepM = Math.max(schedDepM, actDepM, curArrMin + minTurn);
      const estArrM = Math.max(schedArrM, actArrM, estDepM + flightDuration);

      const transCount = transitions[curFn]?.[df.flightNo] || 0;
      const rFreq = routeFreq[`${df.origin}-${df.dest}`] || 1;

      // マルコフ事前重み
      let edgeWeight = (transCount > 0 ? (1.8 + transCount * 1.15) : (0.35 + Math.min(0.8, rFreq * 0.04)));

      // ターンアラウンド実現度（前便の遅延見込み時刻 curArrMin に対する余裕度）
      if (curAirport === 'HND') {
        const spotForEval = (depth === 0) ? currentSpot : null;
        let turnScore = evaluateHndTurnaroundScore(curArrMin, df, dayFlights, spotForEval, learnedModel);
        // 💡 玉突き遅延（Inbound Delay）の適正評価:
        // 同一空港へのピストン折返し便や遷移実績がある便は、前便が遅延しても出発を遅らせて同一機材で運航する。
        // 実着時刻ベースで35分未満でも、定刻ダイヤ上で正常（45〜85分）であれば定刻ベースのスコアを評価する！
        const schedTurn = schedDepM - curSchedArrMin;
        const isPairOrReturn = (lastToday && df.dest === lastToday.origCode) || (transCount > 0);
        if (isPairOrReturn && schedTurn >= 45 && schedTurn <= 85 && turnScore < 1.0) {
          const schedTurnScore = evaluateHndTurnaroundScore(curSchedArrMin, df, dayFlights, spotForEval, learnedModel);
          turnScore = Math.max(turnScore, schedTurnScore * 0.9); // 玉突き遅延前提で高スコアを維持
        }
        if (isPairOrReturn && df.dest === lastToday?.origCode) {
          turnScore *= 1.1; // 💡 ピストン折返し運用ボーナス（過剰な偏りを防ぐため1.1倍に調整）
        }
        // B767全機二部マッチングによる羽田折返し競合解消
        const contentionFactor = getHndContentionFactor(hndBipartiteToday, curFn, df.flightNo);
        // 💡 当日シップチェンジ・スワップ優先補正:
        // 本来76Pだった便が他機種へ降格(hasDemoted76P)し、別便が新たに76Pへ昇格(promotedTo76P)した場合、
        // 既存の通常76P便は他機体の固定枠であるため、余剰76P機(JA609A)は新たに76P昇格した便へ最優先で振り替えられる。
        if (df.promotedTo76P && promoted76PFlights.has(normalizeFlightNo(df.flightNo))) {
          const swapTurnFloor = Math.max(turnScore, 1.45);
          const swapMultiplier = hasDemoted76P ? 18.0 : 4.0;
          edgeWeight = Math.max(edgeWeight, 3.0) * swapTurnFloor * swapMultiplier;
        } else if (depth === 0 && pierExclusiveLock.isPierLocked && normalizeFlightNo(df.flightNo) === pierExclusiveLock.lockedFlightNo) {
          // 🔒 羽田ピア排他確定（同ピアに他76P機なし＆同ピア発76Pが唯一の折返し枠）
          edgeWeight = Math.max(edgeWeight, 3.0) * Math.max(turnScore, 1.45) * 14.0;
        } else if (depth === 0 && pierExclusiveLock.isPierLocked && normalizeFlightNo(df.flightNo) !== pierExclusiveLock.lockedFlightNo) {
          edgeWeight *= turnScore * contentionFactor * 0.15;
        } else if (hasDemoted76P && promoted76PFlights.size > 0 && depth === 0) {
          // 1対1スワップ発生時、昇格便以外の既存76P枠は他機体担当の可能性が高いため控えめに評価
          edgeWeight *= turnScore * contentionFactor * 0.35;
        } else {
          edgeWeight *= turnScore * contentionFactor;
        }
      } else {
        const turn = actDepM - curArrMin;
        if (turn >= 30 && turn <= 85) edgeWeight *= 1.45;
        else if (schedDepM - curSchedArrMin >= 35 && schedDepM - curSchedArrMin <= 85) edgeWeight *= 1.35;
        if (df.promotedTo76P && promoted76PFlights.has(normalizeFlightNo(df.flightNo))) {
          edgeWeight *= 2.5;
        }
      }

      return {
        df,
        estArrM,
        schedArrM,
        edgeWeight
      };
    });

    scored.sort((a, b) => b.edgeWeight - a.edgeWeight);
    const topBranches = scored.slice(0, 3);

    for (const br of topBranches) {
      const { df, estArrM, schedArrM, edgeWeight } = br;
      const origName = AIRPORT_NAMES[df.origin] || df.origin;
      const destName = AIRPORT_NAMES[df.dest] || df.dest;
      const dispDep = df.actDepTime || df.depTime;
      const dispArr = df.actArrTime || df.arrTime;
      const nextFlightObj = {
        flightNo: df.flightNo,
        orig: df.origin,
        dest: df.dest,
        origCode: df.origin,
        destCode: df.dest,
        route: `${origName} ➔ ${destName}`,
        depTime: dispDep,
        arrTime: dispArr,
        actDepTime: dispDep,
        actArrTime: dispArr,
        time: `${dispDep}発 - ${dispArr}着`,
        model: df.model || '76P',
        is767Confirmed: Boolean(df.is767),
        is767Strict: Boolean(df.is767Strict),
        estArrM
      };

      dfs(df.dest, estArrM, schedArrM, df.flightNo, [...pathFlights, nextFlightObj], pathWeight * edgeWeight, depth + 1);
    }
  }

  dfs(startAirport, startActArrMin, startSchedArrMin, startFn, [], 1.0, 0);

  if (completedPaths.length === 0) {
    const stayName = AIRPORT_NAMES[startAirport] || startAirport;
    return {
      isNightStayConfirmed: false,
      nightStayCode: startAirport,
      nightStayName: `${stayName} (有力)`,
      nightStayProbabilities: [{ airport: stayName, code: startAirport, probability: 100 }],
      predictedRemainingToday: [],
      todayPlans: [],
      pendingNightStayNote: '本日の後続便候補を解析中です。',
      currentSpot,
      spotConfidenceNote: spotConfidenceNote || (currentSpot ? `羽田空港 ${currentSpot} 連動判定` : null)
    };
  }

  // 同一の便名列＋最終宿泊地を持つパスをマージ
  const pathMap = new Map();
  for (const p of completedPaths) {
    const key = `${p.remFlights.map(f => f.flightNo).join('>')}|${p.finalStayCode}`;
    if (!pathMap.has(key)) {
      pathMap.set(key, { ...p });
    } else {
      pathMap.get(key).weight += p.weight;
    }
  }

  const uniquePaths = [...pathMap.values()].sort((a, b) => b.weight - a.weight);

  // 宿泊地ごとの確率を集計し、Hamilton法で合計100%に正規化
  const stayWeightMap = new Map();
  for (const p of uniquePaths) {
    stayWeightMap.set(p.finalStayCode, (stayWeightMap.get(p.finalStayCode) || 0) + p.weight);
  }
  const rawStayItems = [...stayWeightMap.entries()]
    .map(([code, weight]) => ({
      code,
      airport: AIRPORT_NAMES[code] || code,
      weight
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);

  const nightStayProbabilities = normalizeTo100Percent(rawStayItems, 'weight', 5).map(it => ({
    airport: it.airport,
    code: it.code,
    probability: it.probability
  }));

  const topStay = nightStayProbabilities[0];
  const isNightStayConfirmed = nightStayProbabilities.length === 1 && topStay.probability === 100 && uniquePaths[0].remFlights.length === 0;

  let nightStayName = `${topStay.airport} (${topStay.probability}%)`;
  if (nightStayProbabilities.length >= 2) {
    nightStayName = `${topStay.airport}(${topStay.probability}%) / ${nightStayProbabilities[1].airport}(${nightStayProbabilities[1].probability}%)`;
  }

  // 最有力パスの残りフライトを「本日の予測後続便」として整形
  const bestPath = uniquePaths[0];
  const predictedRemainingToday = bestPath.remFlights.map((rf, idx) => {
    const isFinal = idx === bestPath.remFlights.length - 1;
    const stayLabel = bestPath.finalStayCode === 'HND' ? '羽田帰還' : `${shortAirportName(bestPath.finalStayCode)}ステイ`;
    const isPierLockedFlight = idx === 0 && pierExclusiveLock.isPierLocked && normalizeFlightNo(rf.flightNo) === pierExclusiveLock.lockedFlightNo;
    return {
      flightNo: rf.flightNo,
      origCode: rf.orig,
      destCode: rf.dest,
      route: rf.route,
      depTime: rf.depTime,
      arrTime: rf.arrTime,
      time: `${rf.depTime}発 - ${rf.arrTime}着 (予想)`,
      status: isPierLockedFlight
        ? `📍到着位置より充当見込み (${pierExclusiveLock.pierJa}${pierExclusiveLock.depGate ? `・${pierExclusiveLock.depGate}番ゲート` : ''})`
        : (isFinal ? `本命予想 (${topStay.probability}%・${stayLabel}候補)` : '後続便候補'),
      isPierLocked: isPierLockedFlight,
      pierLockReason: isPierLockedFlight ? pierExclusiveLock.reason : null,
      isLanded: false,
      isLive: false,
      isPredicted: true
    };
  });

  // 本日の全体プラン（確定分＋残り候補上位3パターン）を構築
  const top3Paths = uniquePaths.slice(0, 3);
  const normTop3 = normalizeTo100Percent(top3Paths, 'weight', 10);
  const planLetters = ['プランA', 'プランB', 'プランC'];
  const rankLabels = ['本命 ◎', '有力 ◯', '対抗 ▲'];
  const stepNums = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

  const todayPlans = normTop3.map((p, idx) => {
    const allF = [
      ...todayFlights.map(tf => ({
        flightNo: tf.flightNo,
        orig: tf.origCode,
        dest: tf.destCode,
        route: tf.route,
        time: `${tf.depTime}発 - ${tf.arrTime}着`,
        tag: tf.isLanded ? '運航完了' : (tf.isLive ? '飛行中' : '本日確定枠')
      })),
      ...p.remFlights.map((rf, rIdx) => ({
        flightNo: rf.flightNo,
        orig: rf.orig,
        dest: rf.dest,
        route: rf.route,
        time: rf.time,
        tag: rIdx === p.remFlights.length - 1
          ? `🌙${shortAirportName(p.finalStayCode)}泊候補`
          : '予想接続(76P)'
      }))
    ].map((f, fIdx) => ({
      ...f,
      step: `${stepNums[fIdx] || `#${fIdx + 1}`} 第${fIdx + 1}便`
    }));

    const stops = [allF[0]?.orig || 'HND', ...allF.map(f => f.dest)].filter(Boolean);
    const routeSummary = stops.map(s => shortAirportName(s)).join(' ➔ ') + '(泊)';
    const stayLabel = shortAirportName(p.finalStayCode);

    return {
      planId: `today-plan-${String.fromCharCode(97 + idx)}`,
      planName: `${planLetters[idx]} (${stayLabel}泊)`,
      stayCode: p.finalStayCode,
      rank: rankLabels[idx],
      probability: p.probability,
      title: `【今夜${stayLabel}泊シナリオ】${routeSummary}`,
      routeSummary,
      flights: allF
    };
  });

  const pendingNightStayNote = `現在 ${lastToday.flightNo} (${lastToday.route}) まで確定。ODPTリアルタイム76P枠とマルコフ遷移確率・実到着見込み時刻から、今夜の最終着陸地は ${nightStayProbabilities.map(p => `${p.airport} ${p.probability}%`).join(' / ')} と推定されます。`;

  return {
    isNightStayConfirmed,
    nightStayCode: topStay.code,
    nightStayName,
    nightStayProbabilities,
    predictedRemainingToday,
    todayPlans,
    pendingNightStayNote,
    currentSpot,
    spotConfidenceNote: spotConfidenceNote || (currentSpot ? `羽田空港 ${currentSpot} 連動判定適用中` : null)
  };
}

// ============================================================================
// 6. フリート全体最適化＆他B767機材スジパズル整合度ソルバー (New)
// ============================================================================
/**
 * 対象日の全B767枠（76P確定枠＋候補枠）に対して、他機体（全11〜13機）のスジが綺麗にパズルとして成立するか
 * フリート全体の一括ペアリングシミュレーションを行い、ちいかわジェット候補プランの全体整合度スコアを算出する。
 * 
 * @param {Array} candidateFlights - ちいかわジェットに割り当てを検討しているフライト配列
 * @param {Array} allDayFlights - 対象日の全フライト一覧 (ODPT)
 * @param {Object} learnedModel - 学習済みモデル (transitions, routeFreq 等)
 * @returns {Object} { fleetScore, strictCoverageRate, otherLinesCount, summary }
 */
function evaluateFleetWideConsistency(candidateFlights, allDayFlights, learnedModel) {
  const transitions = learnedModel?.transitions || {};
  const flightActiveDays = learnedModel?.flightActiveDays || {};
  const totalObsDays = Math.max(1, learnedModel?.totalObservedDays || 1);
  const hasSufficientHistory = (learnedModel?.totalFlights || 0) >= 150 && totalObsDays >= 7;
  const hasRealtime76P = (allDayFlights || []).some(f => f.modelSource === 'ANA運航状況' && f.is76P);
  const candFlightNos = new Set((candidateFlights || []).map(f => f.flightNo));

  // 1. 対象日の767対象フライト（確定枠優先）を抽出（ちいかわ割当分は除外）
  // Day 2〜6（ANA運航状況未確定日）は、現行シーズンで76P実運航実績のある便を優先してプールを構築
  const b767Pool = (allDayFlights || []).filter(f => {
    if (f.isCancelled) return false;
    if (candFlightNos.has(f.flightNo)) return false;
    if (hasRealtime76P) return f.is767 || f.is767Strict;
    if (hasSufficientHistory) {
      const actDays = flightActiveDays[f.flightNo] || 0;
      return actDays >= 2 || (f.is767Strict && actDays >= 1);
    }
    return f.is767 || f.is767Strict;
  });

  // Day 2〜6では、実運航率が高い定番76P枠を仮想確定枠としてパズル整合性を評価
  const strictPool = hasRealtime76P
    ? b767Pool.filter(f => f.is767Strict)
    : b767Pool.filter(f => {
        if (hasSufficientHistory) {
          const actDays = flightActiveDays[f.flightNo] || 0;
          return actDays >= Math.max(4, Math.round(totalObsDays * 0.35));
        }
        return f.is767Strict;
      });

  // 2. 朝の始発便（地方泊からの戻り便 + 羽田早朝発便）を機材起点として特定
  const morningRoots = b767Pool.filter(df => {
    const depM = parseTimeToMinutes(df.depTime);
    if (depM === null) return false;
    if (df.origin !== 'HND') {
      return depM <= 600; // 地方空港 10:00以前発
    }
    return depM <= 540; // 羽田 09:00以前発
  }).sort((a, b) => (parseTimeToMinutes(a.depTime) ?? 0) - (parseTimeToMinutes(b.depTime) ?? 0));

  // 3. 各始発便から他機体のスジを一筆書きでシミュレート（貪欲マッチング）
  const usedFlightNos = new Set();
  const simulatedFleetLines = [];

  for (const root of morningRoots) {
    if (usedFlightNos.has(root.flightNo)) continue;

    const line = [root];
    usedFlightNos.add(root.flightNo);

    let curF = root;
    let safety = 0;

    while (safety < 7) {
      safety++;
      const curArrM = parseTimeToMinutes(curF.arrTime);
      if (curArrM === null) break;

      const minTurn = curF.dest === 'HND' ? 35 : 30;
      const maxTurn = curF.dest === 'HND' ? 240 : 150;

      // 次便候補を検索
      const nextCands = b767Pool.filter(nxt => {
        if (nxt.origin !== curF.dest) return false;
        if (usedFlightNos.has(nxt.flightNo)) return false;
        const depM = parseTimeToMinutes(nxt.depTime);
        return depM !== null && depM >= curArrM + minTurn && depM <= curArrM + maxTurn;
      });

      if (nextCands.length === 0) {
        break; // このスジはここで完了
      }

      // 767単独確定枠（is767Strict）を最優先で回収して他機体スジを形成
      nextCands.sort((a, b) => {
        const trA = transitions[curF.flightNo]?.[a.flightNo] || 0;
        const trB = transitions[curF.flightNo]?.[b.flightNo] || 0;
        const strictWeightA = a.is767Strict ? 10.0 : 1.0;
        const strictWeightB = b.is767Strict ? 10.0 : 1.0;
        const scoreA = strictWeightA + trA * 0.5;
        const scoreB = strictWeightB + trB * 0.5;
        return scoreB - scoreA;
      });

      const bestNext = nextCands[0];
      line.push(bestNext);
      usedFlightNos.add(bestNext.flightNo);
      curF = bestNext;

      const arrM = parseTimeToMinutes(curF.arrTime) ?? 0;
      if (arrM >= 1350 || (curF.dest !== 'HND' && arrM >= 1110)) {
        const hasMore = b767Pool.some(f => f.origin === curF.dest && !usedFlightNos.has(f.flightNo) && (parseTimeToMinutes(f.depTime) ?? 0) >= arrM + 30);
        if (!hasMore) break;
      }
    }

    simulatedFleetLines.push(line);
  }

  // 4. 全体整合性＋他機体スジの定石一致度スコアリング
  const coveredStrict = strictPool.filter(f => usedFlightNos.has(f.flightNo)).length;
  const totalStrict = strictPool.length;
  const strictCoverageRate = totalStrict > 0 ? (coveredStrict / totalStrict) : 1.0;
  const completeLines = simulatedFleetLines.filter(line => line.length >= 2);

  // 他機体スジ全体の遷移実績スコア（ちいかわが他機の定石枠を奪っていないかの全体評価）
  let otherTransSum = 0;
  let otherEdgesCount = 0;
  for (const line of completeLines) {
    for (let i = 0; i < line.length - 1; i++) {
      const tr = transitions[line[i].flightNo]?.[line[i + 1].flightNo] || 0;
      otherTransSum += Math.min(tr, 8);
      otherEdgesCount++;
    }
  }
  const avgOtherTrans = otherEdgesCount > 0 ? (otherTransSum / otherEdgesCount) : 0;
  const fleetNormBonus = 1.0 + Math.min(avgOtherTrans * 0.25, 1.0);

  const is100Percent = strictCoverageRate >= 1.0;
  let fleetScore = 1.0;
  if (is100Percent) {
    fleetScore = 1.35 * fleetNormBonus; // 確定枠100%完全整合 ＋ 他機定石スジ一致ボーナス
  } else if (strictCoverageRate >= 0.85) {
    // 貪欲ソルバーの順序依存で本命の5〜6便スジ(NH661/NH245等)が過剰減衰しないよう連続ソフト重みに変更
    fleetScore = (0.75 + (strictCoverageRate - 0.85) * 3.0) * fleetNormBonus;
  } else {
    fleetScore = 0.35;
  }

  return {
    fleetScore,
    is100Percent,
    strictCoverageRate: Math.round(strictCoverageRate * 100),
    otherLinesCount: completeLines.length,
    summary: `他機体${completeLines.length}機スジ整合（76P確定枠カバー率${Math.round(strictCoverageRate * 100)}%）`
  };
}

// ============================================================================
// 7. マルコフ・ビームサーチ経路生成エンジン (P3: C3, S3, S4, S7, S8, M7 対応)
// ============================================================================
function getStepLabel(idx, total, depMin, arrMin, destCode) {
  const num = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'][idx] || `#${idx + 1}`;
  if (idx === 0) return `${num} 朝一便`;
  if (idx === total - 1) return `${num} 夜最終`;
  if (depMin !== null && depMin < 720) return `${num} 午前便`;
  if (depMin !== null && depMin < 930) return `${num} 午後便`;
  return `${num} 夕方便`;
}

/**
 * 前夜の宿泊地確率分布 priorStays = [{ code, probability }, ...] と対象日のODPTダイヤ・学習済みモデルから、
 * 1日完結の運航スジ（プランA / プランB / プランC）をビームサーチで動的生成する。
 * ハードコードされたテンプレートや架空便注入は一切行わない。
 */
export function generateDayPlansViaBeamSearch(priorStays, targetDateStr, anaFleetData, learnedModel, prevFirstFlightNo = null, prevVisitedDestSet = null, prevArrivalFlight = null, firstFlightOptions = {}) {
  const schedule = getDayFlightsWithDowFallback(targetDateStr, anaFleetData);
  const dayFlightsMap = Object.fromEntries(Object.entries(schedule).map(([key, flight]) => {
    if (flight.modelSource !== 'ANA運航状況') return [key, flight];
    const observed = Date.parse(flight.modelObservedAt || '');
    if (Number.isFinite(observed) && Date.now() >= observed && Date.now() - observed <= 2 * 60 * 60 * 1000) {
      return [key, flight];
    }
    const model = flight.scheduledModel || '';
    return [key, {
      ...flight, model, is767: /763|76P/.test(model),
      is76P: model === '76P', is767Strict: model === '763' || model === '76P',
      isCancelled: false, depGate: null, modelSource: null, modelObservedAt: null
    }];
  }));
  const dayFlights = Object.values(dayFlightsMap).filter(f =>
    !f.isCancelled && (f.modelSource !== 'ANA運航状況' || f.is767)
  );

  const dowType = getDowType(targetDateStr);
  const exactDow = new Date(`${targetDateStr}T00:00:00+09:00`).getUTCDay();
  const transitions = learnedModel.transitions || {};
  const dowTransitions = learnedModel.transitionsByDow?.[dowType] || {};
  const secondOrderTransitions = learnedModel.secondOrderTransitions || {};
  const nightStays = learnedModel.nightStays || {};
  const nightStaysDow = learnedModel.nightStaysByDow?.[dowType] || {};
  const nightStaysExactDow = learnedModel.nightStaysByExactDow?.[exactDow] || {};
  const overnightArrivalTransitions = learnedModel.overnightArrivalTransitions || {};
  const prevDayStartTransitions = learnedModel.prevDayStartTransitions || {};
  const prevDayFirstTransitions = learnedModel.prevDayFirstTransitions || {};
  const fullDaySequences = learnedModel.fullDaySequences || {};
  const prefixSequences = learnedModel.prefixSequences || {};
  const stayTransitions = learnedModel.stayTransitions || {};
  const stayTransitionsDow = learnedModel.stayTransitionsByDow?.[dowType] || {};
  const flightActiveDays = learnedModel.flightActiveDays || {};
  const totalObsDays = Math.max(1, learnedModel.totalObservedDays || 1);
  const hasSufficientHistory = (learnedModel.totalFlights || 0) >= 150 && totalObsDays >= 7;
  const hasRealtime76P = dayFlights.some(f => f.modelSource === 'ANA運航状況' && f.is76P);
  const routeFreq = learnedModel.routeFreq || {};
  const flightMeta = learnedModel.flightMeta || {};

  // もし対象日のODPTダイヤが空の場合（過去日のバックテスト等）、学習済み flightMeta から仮想ダイヤを構築
  let effectiveFlights = dayFlights.length > 0
    ? dayFlights
    : Object.values(flightMeta).map(fm => ({
        flightNo: fm.flightNo,
        origin: fm.orig,
        dest: fm.dest,
        depTime: fm.depTime,
        arrTime: fm.arrTime,
        model: '76P',
        is767: true,
        is767Strict: true
      }));

  // Day 2〜6（ANA運航状況の確定76P情報がない週間ダイヤ日）:
  // 実運航DBに1回以上76P実績がある便に絞り込み、非76P共用ゴミ便（米子・小松・関空・宮崎等）の混入を根本遮断
  if (!hasRealtime76P && hasSufficientHistory && effectiveFlights.length > 0) {
    const empirical76PFlights = effectiveFlights.filter(df => (flightActiveDays[df.flightNo] || 0) >= 1);
    if (empirical76PFlights.length >= 20) {
      effectiveFlights = empirical76PFlights;
    }
  }

  const validPriors = (Array.isArray(priorStays) && priorStays.length > 0)
    ? priorStays.filter(p => p.probability > 0)
    : [{ code: 'HND', probability: 100 }];

  const arrivalByAirportMap = firstFlightOptions.arrivalByAirport || {};
  const regionalStayStreak = Number.isFinite(firstFlightOptions.regionalStayStreak) ? firstFlightOptions.regionalStayStreak : 0;
  // B767全機の羽田発着二部グラフ同時割当を1回だけ構築（羽田到着後の第2便分岐の競合解消用）
  const hndBipartite = buildHndBipartiteMatching(effectiveFlights, learnedModel, firstFlightOptions.assignedOther || null);
  const candidateCompletePlans = [];

  for (const stay of validPriors) {
    const startAirport = stay.code;
    const stayPriorProb = (stay.probability || 50) / 100;
    const stayHistMap = nightStays[startAirport] || {};
    const stayDowHistMap = nightStaysDow[startAirport] || {};
    const stayPrevArrival = arrivalByAirportMap[startAirport]
      || (prevArrivalFlight && (!prevArrivalFlight.dest || prevArrivalFlight.dest === startAirport) ? prevArrivalFlight : null);

    // 1. 朝一初便候補の抽出
    let morningFlights = effectiveFlights.filter(df => {
      if (df.origin !== startAirport) return false;
      const depM = parseTimeToMinutes(df.depTime);
      if (depM === null) return false;

      // ⚠️ 重大修正: 当日ODPT公式ダイヤで別機種確定（321, 32P, 78P, 738等）の便は即座に完全除外！
      const is76 = Boolean(df.is767 || df.is76P || String(df.model || '').includes('76') || (!hasRealtime76P && (flightActiveDays[df.flightNo] || 0) >= 3));
      if (!is76) return false;

      // 地方空港泊は06:30〜10:30発、羽田泊は06:00〜09:30発に厳格限定（10:00 NH59や11:00 NH21の地方帰還折返し誤認を防止）
      if (startAirport !== 'HND') {
        return depM >= 390 && depM <= 630;
      }
      return depM >= 360 && depM <= 570;
    });

    // もし地方空港泊（startAirport !== 'HND'）で、朝一番の羽田帰還便（dest === 'HND'）が候補に含まれていない場合、
    // 機材変更による朝一羽田送り込み（例: NGO -> NH86 07:25発羽田行き等）も実運航で頻発するため候補に追加
    if (startAirport !== 'HND' && !morningFlights.some(df => df.dest === 'HND')) {
      const earlyHndReturns = effectiveFlights
        .filter(df => {
          if (df.origin !== startAirport || df.dest !== 'HND') return false;
          const is76 = Boolean(df.is767 || df.is76P || String(df.model || '').includes('76'));
          if (!is76) return false;
          return (parseTimeToMinutes(df.depTime) ?? 999) <= 570;
        })
        .sort((a, b) => (parseTimeToMinutes(a.depTime) ?? 999) - (parseTimeToMinutes(b.depTime) ?? 999));
      if (earlyHndReturns.length > 0) {
        morningFlights.push(earlyHndReturns[0]);
      }
    }

    // もしODPT上で該当空港発の767枠が見つからない場合、学習済みnightStaysにある便名または朝一番のHND行き便を補完
    if (morningFlights.length === 0) {
      const histFns = Object.keys(stayHistMap);
      for (const fn of histFns) {
        const df = dayFlightsMap[fn] || (flightMeta[fn] ? {
          flightNo: fn,
          origin: flightMeta[fn].orig,
          dest: flightMeta[fn].dest,
          depTime: flightMeta[fn].depTime,
          arrTime: flightMeta[fn].arrTime,
          model: '76P',
          is767: true,
          is767Strict: true
        } : null);
        if (df && df.origin === startAirport &&
            (df.modelSource !== 'ANA運航状況' || df.is767)) morningFlights.push(df);
      }
    }
    if (morningFlights.length === 0) {
      morningFlights = effectiveFlights
        .filter(df => df.origin === startAirport && (parseTimeToMinutes(df.depTime) ?? 999) <= 660)
        .slice(0, 3);
    }

    if (firstFlightOptions.currentDay) {
      // FR24の離陸反映ラグおよび出発遅延を考慮し、45分の猶予バッファを設ける（0分足切りによる本命便消失バグを防止）
      const FR24_DEPARTURE_GRACE_MIN = 45;
      morningFlights = morningFlights.filter(df => {
        const dep = parseTimeToMinutes(df.actDepTime || df.depTime);
        if (dep === null || dep + FR24_DEPARTURE_GRACE_MIN < firstFlightOptions.nowMin) return false;
        if (firstFlightOptions.assignedOther?.has(normalizeFlightNo(df.flightNo))) return false;
        const st = String(df.status || '');
        // 既に到着済み(Arrived/Landed)は確実に他機体。Departed/InAirは出発35分超経過してもFR24未反映なら他機体扱い
        if (/^(Arrived|Landed)$/i.test(st)) return false;
        if (/^(Departed|InAir|TakeOff)$/i.test(st) && dep + 35 < firstFlightOptions.nowMin) return false;
        return Boolean(df.is767 || df.is76P || String(df.model || '').includes('76'));
      });
    }
    const arrival = firstFlightOptions.arrival;
    if (arrival && arrival.airport === startAirport) {
      morningFlights = morningFlights.filter(df => {
        const dep = parseTimeToMinutes(df.depTime);
        return dep !== null && 1440 + dep - arrival.arrivalMin >= 35;
      });
    }

    // 初便のスコア計算
    // ※ちいかわジェット単体の過去傾向（運用期間が短いため）に過剰依存せず、
    //   ANAの全767-300ER（76P）公式ダイヤ・投入枠をフラットに評価して全路線を公平に網羅する
    const shadowWeights = arrival?.arrivalMin != null && arrival?.flightNo
      ? overnightWeights(learnedModel?.overnightPairs || [], {
          airport: startAirport, date: targetDateStr, arrivalFlight: arrival.flightNo,
          arrivalMin: arrival.arrivalMin
        }, morningFlights) : new Map();
    const scoredMorning = morningFlights.map(df => {
      const depM = parseTimeToMinutes(df.depTime) ?? 500;
      // レギュラー機材判定（確定枠 3.5 / 主力枠 1.8 / 代走枠 0.38）
      const modelPrio = getAircraftModelPriority(df, learnedModel);
      let score = modelPrio;

      // 💡 ナイトステイ空港からの初便過去実績ボーナス（全体・平日/土日・7曜日別の実績を正当評価）
      const stayHistCount = stayHistMap[df.flightNo] || 0;
      const stayDowCount = stayDowHistMap[df.flightNo] || 0;
      const stayExactDowMap = nightStaysExactDow[startAirport] || {};
      const stayExactDowCount = stayExactDowMap[df.flightNo] || 0;
      const stayExactDowTotal = Object.values(stayExactDowMap).reduce((a, b) => a + b, 0);
      if (stayHistCount > 0) {
        score *= (1.0 + Math.min(stayHistCount * 0.35 + stayDowCount * 0.20, 3.6));
      } else if (!hasRealtime76P && hasSufficientHistory) {
        // Day 2以降でその空港からの初便実績が一度もない便は抑制
        score *= 0.25;
      }

      // 💡 7曜日別（日〜土）の初便傾向ボーナス（例: 日曜のNH245優位、土曜のNH1077優位）
      if (startAirport === 'HND' && stayExactDowTotal >= 4) {
        const exactDowRate = (stayExactDowCount + 0.3) / (stayExactDowTotal + 1.5);
        score *= (0.75 + Math.min(exactDowRate * 1.8, 0.85));
      }

      // 💡 前夜最終到着便 -> 翌朝初便の直接相関（例: NH1078->NH1077 60%, NH266->NH245, NH630->NH661 等）
      if (stayPrevArrival && stayPrevArrival.flightNo) {
        const prevLastFnNorm = normalizeFlightNo(stayPrevArrival.flightNo);
        const arrTransMap = overnightArrivalTransitions[startAirport]?.[prevLastFnNorm];
        if (arrTransMap) {
          const arrTransTotal = Object.values(arrTransMap).reduce((a, b) => a + b, 0);
          if (arrTransTotal >= 3) {
            const pairCnt = arrTransMap[df.flightNo] || 0;
            const pairRate = (pairCnt + 0.35) / (arrTransTotal + 1.8);
            score *= (0.65 + Math.min(pairRate * 2.6, 1.55));
          }
        }
      }

      // 💡 -2d宿泊地(=前日始発空港) ＆ -1d初便名 -> 翌朝羽田初便のベイズ平滑化Lift補正
      // 実データ検証: -2d広島泊(-1d NH672始発)経由の羽田泊翌朝はNH661が極端に低く(8%)、NH619/NH245/NH583へシフトする等
      // (-3d以前はLOO正答率がベースラインを下回るノイズのため不採用)
      if (startAirport === 'HND') {
        const totalHndBase = Object.values(stayHistMap).reduce((a, b) => a + b, 0);
        const baseFnProb = totalHndBase >= 8
          ? ((stayHistMap[df.flightNo] || 0) + 0.5) / (totalHndBase + 4.0)
          : null;
        const resolvedPrevStartAp = firstFlightOptions.prevStartAirport
          || (prevFirstFlightNo ? flightMeta[normalizeFlightNo(prevFirstFlightNo)]?.orig : null);

        if (baseFnProb && resolvedPrevStartAp) {
          const startMap = prevDayStartTransitions['HND']?.[resolvedPrevStartAp];
          if (startMap) {
            const startTot = Object.values(startMap).reduce((a, b) => a + b, 0);
            if (startTot >= 5) {
              const condProb = ((startMap[df.flightNo] || 0) + 0.6) / (startTot + 4.0);
              const lift = condProb / baseFnProb;
              const dampened = 1.0 + 0.45 * (lift - 1.0);
              score *= Math.max(0.72, Math.min(1.38, dampened));
            }
          }
        }

        if (baseFnProb && prevFirstFlightNo) {
          const prevFirstNorm = normalizeFlightNo(prevFirstFlightNo);
          const pfMap = prevDayFirstTransitions['HND']?.[prevFirstNorm];
          if (pfMap) {
            const pfTot = Object.values(pfMap).reduce((a, b) => a + b, 0);
            if (pfTot >= 4) {
              const condProb = ((pfMap[df.flightNo] || 0) + 0.6) / (pfTot + 4.0);
              const lift = condProb / baseFnProb;
              const dampened = 1.0 + 0.35 * (lift - 1.0);
              score *= Math.max(0.78, Math.min(1.30, dampened));
            }
          }
        }
      }

      // 前夜到着便との往復ペアリング（単機ステイ地方空港では折返し率ほぼ100%だが、中部NGOなど複数機ステイ拠点は実測約63%のため過大倍率を抑制）
      if (startAirport !== 'HND' && stayPrevArrival && stayPrevArrival.orig) {
        const isMultiFlightRegionalHub = startAirport === 'NGO' || morningFlights.length >= 2;
        if (df.dest === stayPrevArrival.orig) {
          score *= isMultiFlightRegionalHub ? 1.45 : 3.8;
        } else {
          score *= isMultiFlightRegionalHub ? 0.85 : 0.55;
        }
      } else if (startAirport !== 'HND' && df.dest === 'HND' && depM <= 540) {
        score *= 1.35; // 地方泊からの朝一番羽田帰還便は高優先度
      } else if (modelPrio <= 0.4 && stayHistCount === 0) {
        score *= 0.35;
      }

      // 羽田泊の場合、地方ステイ機が羽田に戻る前（06:30〜08:55発）の早朝枠にボーナス
      if (startAirport === 'HND') {
        if (depM <= 535) score *= 1.3;
        else if (depM >= 780) score *= 0.55;
      }

      // 前日と同じ初便の連続投入はローテーション分散により減衰
      if (prevFirstFlightNo && df.flightNo === prevFirstFlightNo && startAirport === 'HND') {
        score *= 0.70;
      }
      // 前夜到着便・到着時刻・曜日・機体固有の相関（chiikawa_overnight_model）をソフト統合
      const sw = shadowWeights.get(normalizeFlightNo(df.flightNo));
      if (sw && Number.isFinite(sw)) {
        score *= (0.5 + 0.5 * sw);
      }
      // 夜をまたぐ駐機（ナイトステイ）では夜間のトーイング移動が入るため、前夜到着ゲートと翌朝出発ゲートの連動加点は行わない。

      return { df, score };
    }).sort((a, b) => b.score - a.score).slice(0, startAirport === 'HND' ? 12 : 4);

    const morningScoreSum = scoredMorning.reduce((s, x) => s + x.score, 0) || 1;
    if (firstFlightOptions.capture) {
      for (const { df, score } of scoredMorning) {
        firstFlightOptions.capture.push({
          flightNo: normalizeFlightNo(df.flightNo), orig: df.origin, dest: df.dest,
          route: `${AIRPORT_NAMES[df.origin] || df.origin} ➔ ${AIRPORT_NAMES[df.dest] || df.dest}`,
          depTime: df.depTime, arrTime: df.arrTime, depGate: df.depGate || null,
          model: df.model || null, modelSource: df.modelSource || null,
          modelObservedAt: df.modelObservedAt || null,
          score: stayPriorProb * score / morningScoreSum,
          shadowScore: stayPriorProb * score / morningScoreSum * (shadowWeights.get(normalizeFlightNo(df.flightNo)) || 1)
        });
      }
    }

    // 2. 各初便からビームサーチで1日の終着までスジを展開
    for (const mItem of scoredMorning) {
      const f1 = mItem.df;
      const f1Prob = mItem.score / morningScoreSum;
      const f1ArrMin = parseTimeToMinutes(f1.arrTime) ?? ((parseTimeToMinutes(f1.depTime) ?? 480) + 100);

      let beam = [{
        flights: [f1],
        curAirport: f1.dest,
        curArrMin: f1ArrMin,
        curFn: f1.flightNo,
        score: stayPriorProb * f1Prob
      }];

      const finishedForThisMorning = [];

      // 時間主導のビームサーチ（便数制限ではなく、夜の駐機・ステイ到着時刻に達するまで時間を進める）
      for (let step = 1; step < 8; step++) {
        const nextBeam = [];

        for (const state of beam) {
          const { curAirport, curArrMin, curFn, flights, score } = state;

          // 終端条件: 深夜帯（23:00以降着。空港門限・深夜運用限界）
          if (curArrMin >= 1380) {
            finishedForThisMorning.push(state);
            continue;
          }

          // 夕方〜夜の羽田着（17:00以降着）: 便数に関わらず「ここで羽田ステイ終了」の選択肢を分岐保存しつつ、
          // まだ夜の地方ステイ便（広島・鹿児島・福岡等）への後続便があるか必ず並行探索する
          if (curAirport === 'HND' && curArrMin >= 1020) {
            const outTrans = transitions[curFn] || {};
            const hasStrongEveningOut = Object.values(outTrans).reduce((a, b) => a + b, 0) >= 5;
            let hndEveningStopFactor = curArrMin >= 1200 ? 1.4 : (curArrMin >= 1110 ? 0.95 : 0.55);
            if (hasStrongEveningOut) hndEveningStopFactor *= 0.6;
            finishedForThisMorning.push({
              ...state,
              score: score * hndEveningStopFactor
            });
          }

          // ターンアラウンド時間のソフト制約（なるべく理想時間から探すが、機材繰りによる長め待機もソフトに残す）
          // 物理的最小限界（客の降機・清掃・給油・搭乗）：羽田35分、地方30分
          const minTurn = curAirport === 'HND' ? 35 : 30;
          // 上限はハード足切りを撤廃し、緩やかな上限（羽田270分/4.5時間、地方180分/3時間）
          const maxTurn = curAirport === 'HND' ? 270 : 180;

          let nextCands = effectiveFlights.filter(df => {
            if (df.origin !== curAirport) return false;
            if (flights.some(pf => pf.flightNo === df.flightNo)) return false;
            const depM = parseTimeToMinutes(df.depTime);
            const arrM = parseTimeToMinutes(df.arrTime);
            if (depM === null || arrM === null) return false;
            if (depM < curArrMin + minTurn || depM > curArrMin + maxTurn) return false;

            // もし昼間（18:30以前）に地方空港へ行く便なら、その地方空港から当日中に戻る便があるか確認（取り残され防止）
            if (df.dest !== 'HND' && arrM < 1110) {
              const hasReturnFromDest = effectiveFlights.some(ret => {
                if (ret.origin !== df.dest) return false;
                const rDep = parseTimeToMinutes(ret.depTime);
                return rDep !== null && rDep >= arrM + 30;
              });
              if (!hasReturnFromDest) return false;
            }
            return true;
          });

          // ⚠️ 重大修正: 当日ODPT公式ダイヤで別機種確定（321, 32P, 78P, 738等）の便は完全除外
          const b767Next = nextCands.filter(df => {
            return Boolean(df.is767 || df.is76P || String(df.model || '').includes('76'));
          });
          if (b767Next.length > 0) {
            nextCands = b767Next;
          }

          if (nextCands.length === 0) {
            // 後続便がない場合、夕方以降（17:00以降着）または2便以上飛んでいれば完了スジとして採用
            if (curArrMin >= 1020 || flights.length >= 2) {
              finishedForThisMorning.push(state);
            }
            continue;
          }

          const situationTransitions = learnedModel?.situationTransitions || {};
          // 同時刻帯（±45分）に同空港へ到着する他の同機種（B767）便を動的に抽出
          const coArrivals = effectiveFlights.filter(f => {
            if (f.dest !== curAirport || f.flightNo === curFn) return false;
            if (!(f.is767 || f.is76P || String(f.model || '').includes('76'))) return false;
            const oArrM = parseTimeToMinutes(f.arrTime);
            return oArrM !== null && Math.abs(oArrM - curArrMin) <= 45;
          });

          const prevFnInPath = flights.length >= 2 ? flights[flights.length - 2].flightNo : null;
          const pair2Key = prevFnInPath ? `${prevFnInPath}>${curFn}` : null;

          const scoredNext = nextCands.map(df => {
            const baseTransCount = transitions[curFn]?.[df.flightNo] || 0;
            const dowTransCount = dowTransitions[curFn]?.[df.flightNo] || 0;
            const secondOrderCount = pair2Key ? (secondOrderTransitions[pair2Key]?.[df.flightNo] || 0) : 0;
            const transCount = baseTransCount > 0 ? (baseTransCount * 0.7 + dowTransCount * 0.6) : 0;
            // レギュラー機材判定（確定枠 3.8 / 主力枠 3.4 / 代走枠 0.38 / 非767 0.08）
            let modelPrio = getAircraftModelPriority(df, learnedModel);

            // 💡 過去の同一機材遷移実績（実データ検証）がある便は、共用枠（788/763等）であっても
            // 実際にB767が充当される確立されたスジであるため優先度を正当に評価
            if (transCount > 0 && modelPrio < 1.0) {
              modelPrio = 1.25 + Math.min(transCount * 0.15, 0.6);
            }

            let edgeScore = modelPrio;

            // 過去遷移実績があれば実績回数に応じたブースト（回数差を素直に反映）
            if (transCount > 0) {
              edgeScore *= (1.0 + Math.min(transCount * 0.45, 2.5));
            }
            // 💡 2次マルコフ遷移ボーナス: (前便, 現便) -> 次便の実績があればスジの文脈を強く尊重
            if (secondOrderCount > 0) {
              edgeScore *= (1.0 + Math.min(secondOrderCount * 0.40, 2.2));
            }
            // ⚠️ 異常ループ抑制: 同一の地方空港へ1日3回以上向かう架空の反復ループ（例: CTSへ3往復）を強く減衰
            if (df.dest !== 'HND') {
              const sameDestVisits = flights.filter(pf => pf.dest === df.dest).length;
              if (sameDestVisits >= 2) {
                edgeScore *= 0.20;
              }
            }

            // 💡 同時刻帯・同機種到着シチュエーション評価（他到着機との枠の奪い合いを動的に判定）
            if (coArrivals.length > 0) {
              for (const co of coArrivals) {
                const sitMyCount = situationTransitions[curAirport]?.[curFn]?.[co.flightNo]?.[df.flightNo] || 0;
                const sitCoCount = situationTransitions[curAirport]?.[co.flightNo]?.[curFn]?.[df.flightNo] || 0;
                const coGeneralTrans = transitions[co.flightNo]?.[df.flightNo] || 0;

                if (sitMyCount > 0 && sitMyCount >= sitCoCount) {
                  edgeScore *= (1.0 + Math.min(sitMyCount * 0.25, 0.8));
                } else if (sitCoCount >= 2 && sitCoCount > sitMyCount * 2) {
                  // 同じ同時到着シチュエーションにおいて、他機(co)がこの次便を定石として奪っている場合は強く抑制
                  edgeScore *= Math.max(0.32, (sitMyCount + 0.5) / (sitCoCount + 0.5));
                } else if (coGeneralTrans >= 3 && coGeneralTrans > transCount * 2) {
                  // 直接の同時到着サンプルが少ない場合も、他機(co)の強い定石遷移であれば占有圧力を考慮
                  edgeScore *= Math.max(0.40, (transCount + 0.5) / (coGeneralTrans + 0.5));
                }
              }
            }

            // ⚠️ 非レギュラー（代走枠）の連続投入抑制：
            // もし前日（または当日すでに）訪問済みの地方空港への便で、かつ代走枠（modelPrio <= 0.4）の場合、
            // 2日連続で同じ代走枠へ入る確率は運用上極めて低いため大幅減衰
            if (prevVisitedDestSet && prevVisitedDestSet.has(df.dest) && modelPrio <= 0.4) {
              edgeScore *= 0.25;
            }

            const depM = parseTimeToMinutes(df.depTime) ?? (curArrMin + 50);
            const turn = depM - curArrMin;

            if (curAirport === 'HND') {
              // 羽田空港でのターンアラウンド評価（なるべく45〜85分から探すが、長め待機もソフトに評価）
              const curSpotForStep = (step === 1 && df.depGate)
                ? resolveHndSpotFromOdptGate(dayFlightsMap[curFn]?.arrGate, 'HND')?.spot || null
                : null;
              edgeScore *= evaluateHndTurnaroundScore(curArrMin, df, dayFlightsMap, curSpotForStep, learnedModel);
              // B767全機二部グラフ同時割当による羽田折返し競合解消
              edgeScore *= getHndContentionFactor(hndBipartite, curFn, df.flightNo);
              // 2晩連続で同一の地方空港にナイトステイする反復ループを適度に抑制（機材ローテーション分散）
              const arrM = parseTimeToMinutes(df.arrTime) ?? 0;
              if (startAirport !== 'HND' && df.dest === startAirport && arrM >= 1110) {
                edgeScore *= 0.48;
              }
            } else {
              // 地方空港のソフトターンアラウンド評価
              if (turn >= 35 && turn <= 65) edgeScore *= 1.45; // 地方の黄金ターン
              else if (turn >= 30 && turn < 35) edgeScore *= 0.9;
              else if (turn > 65 && turn <= 120) edgeScore *= 1.05;
              else edgeScore *= 0.65; // 長め待機

              if (modelPrio >= 3.0) edgeScore *= 1.35; // 確定枠ボーナス
              else if (modelPrio <= 0.4) edgeScore *= 0.4; // 地方での代走枠折り返しも抑制
            }

            return { df, edgeScore };
          }).sort((a, b) => b.edgeScore - a.edgeScore).slice(0, 8);

          // 分岐数バイアス（候補が多い羽田だけ極端にスコアが減衰し、候補1本の地方発が逆転する現象）を防ぐため最大エッジ基準で正規化
          const maxEdge = scoredNext[0]?.edgeScore || 1;
          for (const nx of scoredNext) {
            const arrM = parseTimeToMinutes(nx.df.arrTime) ?? ((parseTimeToMinutes(nx.df.depTime) ?? 600) + 95);
            const relScore = nx.edgeScore / maxEdge;
            nextBeam.push({
              flights: [...flights, nx.df],
              curAirport: nx.df.dest,
              curArrMin: arrM,
              curFn: nx.df.flightNo,
              score: score * (0.25 + 0.75 * relScore) * relScore
            });
          }
        }

        // ビーム幅を上位8件に絞る
        nextBeam.sort((a, b) => b.score - a.score);
        beam = nextBeam.slice(0, 8);
        if (beam.length === 0) break;
      }

      for (const rem of beam) {
        // 夕方以降（17:00以降着）または2便以上飛んでいるスジは完了候補として採用
        if (rem.curArrMin >= 1020 || rem.flights.length >= 2) {
          finishedForThisMorning.push(rem);
        }
      }

      finishedForThisMorning.sort((a, b) => b.score - a.score);
      // 単一初便時でも中盤ルート・最終宿泊地が多様なスジが選ばれるよう上位6スジを候補プールへ追加
      for (const best of finishedForThisMorning.slice(0, 6)) {
        candidateCompletePlans.push({
          startAirport,
          endAirport: best.curAirport,
          midAirport: best.flights[1]?.dest !== 'HND' ? best.flights[1]?.dest : (best.flights[2]?.dest || best.flights[1]?.dest),
          rawFlights: best.flights,
          weight: best.score
        });
      }
    }
  }

  if (candidateCompletePlans.length === 0) return [];

  // フリート全体最適化 ＋ 実在1日スジ（冬ダイヤ定石ローテーション）整合ボーナス
  for (const plan of candidateCompletePlans) {
    const consistency = evaluateFleetWideConsistency(plan.rawFlights, effectiveFlights, learnedModel);
    plan.fleetConsistency = consistency;
    plan.weight *= consistency.fleetScore;

    // 💡 実在1日スジ一致ボーナス（冬ダイヤ実運航で観測された完全便列・前半3便プレフィックスを正当評価）
    const sig = plan.rawFlights.map(f => f.flightNo).join('>');
    const p3 = plan.rawFlights.slice(0, 3).map(f => f.flightNo).join('>');
    const exactSeqCount = fullDaySequences[plan.startAirport]?.[sig] || 0;
    const prefix3Count = prefixSequences[plan.startAirport]?.[p3] || 0;
    if (exactSeqCount > 0) {
      plan.weight *= (1.5 + Math.min(exactSeqCount * 0.45, 3.5));
    } else if (prefix3Count > 0) {
      plan.weight *= (1.15 + Math.min(prefix3Count * 0.18, 1.4));
    }

    // 💡 実データ宿泊地遷移の妥当性補正（その始発空港から実運航で到達したことのないレア終着地を緩やかに抑制）
    const stayTransMap = stayTransitions[plan.startAirport];
    if (stayTransMap && hasSufficientHistory) {
      const totalStayFromStart = Object.values(stayTransMap).reduce((a, b) => a + b, 0);
      if (totalStayFromStart >= 5) {
        const endCnt = stayTransMap[plan.endAirport] || 0;
        const empiricalStayProb = (endCnt + 0.3) / (totalStayFromStart + 1.5);
        plan.weight *= (0.45 + 1.1 * Math.min(1.0, empiricalStayProb * 2.5));
      }
    }

    // 💡 連続地方泊からの羽田帰還圧力（3泊目以降は実データ帰還カーブに基づき羽田泊へ穏当なブースト）
    if (plan.startAirport !== 'HND' && plan.endAirport === 'HND' && regionalStayStreak >= 3) {
      plan.weight *= getRegionalReturnHndBoost(regionalStayStreak);
    }
  }

  // 💡 厳密ベイズ正規化（分岐数バイアス完全解消）:
  // 各始発空港 s の候補群をまず条件付き確率 P(Plan | Start = s) に正規化してから、
  // 事前宿泊確率 P(Start = s) を掛けることで「羽田泊(候補多)がレア地方泊(候補1)に負ける」バグを根絶！
  const priorProbMap = new Map(validPriors.map(p => [p.code, (p.probability || 50) / 100]));
  const plansByStart = new Map();
  for (const plan of candidateCompletePlans) {
    if (!plansByStart.has(plan.startAirport)) plansByStart.set(plan.startAirport, []);
    plansByStart.get(plan.startAirport).push(plan);
  }
  for (const [startAp, list] of plansByStart.entries()) {
    // 同一便列の重複を除いた上位12件の重み合計で条件付き確率を正規化
    const seen = new Set();
    const uniq = [];
    for (const item of [...list].sort((a, b) => b.weight - a.weight)) {
      const s = item.rawFlights.map(f => f.flightNo).join('>');
      if (!seen.has(s)) { seen.add(s); uniq.push(item); }
    }
    const normDenom = uniq.slice(0, 12).reduce((acc, p) => acc + p.weight, 0) || 1;
    const pStart = priorProbMap.get(startAp) ?? 0.1;
    for (const plan of list) {
      plan.weight = pStart * (plan.weight / normDenom);
    }
  }

  // ⚠️ フリート整合評価は上の連続ソフト重み(fleetScore)に一本化。
  // 従来のハード足切り(maxCovRate - 3%)は、4便の短いスジ(NH1077/NH1079)だけ貪欲カバー率100%になった日に
  // 羽田本命初便(NH661/NH245等)を丸ごと除外してしまう原因となっていたため撤廃。
  const eligiblePlans = candidateCompletePlans;

  // 💡 ユーザー指示: 「プランA・B・Cは異なる初便を選ぶは不要、確率に合わせて設定されれば良い」
  // 恣意的な初便縛り（異なる初便の強制）や宿泊空港代表枠を全廃。
  // ビームサーチとフリート整合性で計算された確率（weight）の降順に、素直に上位プランを選出する。
  eligiblePlans.sort((a, b) => b.weight - a.weight);

  const selectedRaw = [];
  const usedSignatures = new Set();
  const usedMidAndEnd = new Set();
  const prefix3Counts = new Map();

  // ① 確率（weight）が高い順に、前半スジや経由地・宿泊先が異なる代表シナリオを優先選出（同一前半の3枠独占を防止）
  for (const cand of eligiblePlans) {
    if (selectedRaw.length >= 3) break;
    const sig = cand.rawFlights.map(f => f.flightNo).join('>');
    if (usedSignatures.has(sig)) continue;

    const p3 = cand.rawFlights.slice(0, 3).map(f => f.flightNo).join('>');
    const p3Count = prefix3Counts.get(p3) || 0;
    const midEndKey = `${cand.midAirport}_${cand.endAirport}`;

    // 1位（selectedRaw.length === 0）は無条件採用。2枠目以降は同一前半プレフィックスを原則1つまでに制限して多様性を確保
    if (!usedMidAndEnd.has(midEndKey) && (selectedRaw.length === 0 || p3Count === 0)) {
      selectedRaw.push(cand);
      usedSignatures.add(sig);
      usedMidAndEnd.add(midEndKey);
      prefix3Counts.set(p3, p3Count + 1);
    }
  }

  // ② 3プランに満たない場合は、同一前半プレフィックスでも宿泊先が異なる次点候補を補充（最大2件まで）
  for (const cand of eligiblePlans) {
    if (selectedRaw.length >= 3) break;
    const sig = cand.rawFlights.map(f => f.flightNo).join('>');
    if (usedSignatures.has(sig)) continue;

    const p3 = cand.rawFlights.slice(0, 3).map(f => f.flightNo).join('>');
    const p3Count = prefix3Counts.get(p3) || 0;
    const midEndKey = `${cand.midAirport}_${cand.endAirport}`;
    if (!usedMidAndEnd.has(midEndKey) && p3Count < 2) {
      selectedRaw.push(cand);
      usedSignatures.add(sig);
      usedMidAndEnd.add(midEndKey);
      prefix3Counts.set(p3, p3Count + 1);
    }
  }

  // ③ それでも3プランに満たない場合は、純粋に確率（weight）順に未選出スジを補充
  for (const cand of eligiblePlans) {
    if (selectedRaw.length >= 3) break;
    const sig = cand.rawFlights.map(f => f.flightNo).join('>');
    if (usedSignatures.has(sig)) continue;
    selectedRaw.push(cand);
    usedSignatures.add(sig);
  }

  // 週間連鎖用: 候補プール全体（上位15件）から周辺宿泊確率分布を算出 ＋ 実データ宿泊地遷移行列とベイズ平滑化
  const stayWeightMap = new Map();
  const bestArrivalByAirport = {};
  const bestArrivalWeight = {};
  for (const cand of eligiblePlans.slice(0, 15)) {
    const endAp = cand.endAirport || 'HND';
    const w = cand.weight || 0;
    stayWeightMap.set(endAp, (stayWeightMap.get(endAp) || 0) + w);
    const lastFl = cand.rawFlights?.[cand.rawFlights.length - 1];
    if (lastFl && w > (bestArrivalWeight[endAp] || 0)) {
      bestArrivalWeight[endAp] = w;
      bestArrivalByAirport[endAp] = {
        orig: lastFl.origin || lastFl.orig,
        dest: lastFl.dest,
        flightNo: lastFl.flightNo
      };
    }
  }

  // 実データ宿泊地マルコフ遷移行列 P(Stay_{t+1} | Stay_t) による長期連鎖ドリフト防止ブレンド（Day 2〜6向け）
  const beamStayTotal = [...stayWeightMap.values()].reduce((a, b) => a + b, 0) || 1;
  const empiricalNextStay = new Map();
  if (hasSufficientHistory) {
    for (const stay of validPriors) {
      const pS = (stay.probability || 0) / 100;
      const tMap = stayTransitions[stay.code];
      const tDowMap = stayTransitionsDow[stay.code] || {};
      if (!tMap || pS <= 0) continue;
      const tTot = Object.values(tMap).reduce((a, b) => a + b, 0);
      if (tTot < 3) continue;
      for (const [endAp, cnt] of Object.entries(tMap)) {
        const dowCnt = tDowMap[endAp] || 0;
        const blendedCnt = cnt * 0.75 + dowCnt * 0.5;
        const blendedTot = tTot * 0.75 + Object.values(tDowMap).reduce((a, b) => a + b, 0) * 0.5;
        if (blendedTot > 0) {
          empiricalNextStay.set(endAp, (empiricalNextStay.get(endAp) || 0) + pS * (blendedCnt / blendedTot));
        }
      }
    }
  }
  const empStayTotal = [...empiricalNextStay.values()].reduce((a, b) => a + b, 0);
  const combinedStayMap = new Map();
  const allEndAps = new Set([...stayWeightMap.keys(), ...empiricalNextStay.keys()]);
  for (const ap of allEndAps) {
    const beamP = (stayWeightMap.get(ap) || 0) / beamStayTotal;
    const empP = empStayTotal > 0 ? (empiricalNextStay.get(ap) || 0) / empStayTotal : beamP;
    // Day 0〜1（リアルタイム76P確定日）はビームサーチを90%信頼、Day 2〜6は実データ遷移を25%ブレンドして長期ドリフトを抑制
    const alpha = hasRealtime76P ? 0.90 : 0.75;
    const finalP = empStayTotal > 0 ? (alpha * beamP + (1 - alpha) * empP) : beamP;
    // 3%未満の極小ノイズ宿泊地は枝刈り（minPct=5%による架空宿泊地増殖を完全防止）
    if (finalP >= 0.03) {
      combinedStayMap.set(ap, finalP);
    }
  }
  const stayItems = [...combinedStayMap.entries()]
    .map(([code, weight]) => ({ code, airport: AIRPORT_NAMES[code] || code, weight }))
    .filter(x => x.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
  const fullStayPriors = stayItems.length > 0
    ? normalizeTo100Percent(stayItems, 'weight', 1).map(it => ({ code: it.code, airport: it.airport, probability: it.probability }))
    : null;

  // スコア順にソートしてHamilton法で合計100%に正規化
  selectedRaw.sort((a, b) => b.weight - a.weight);
  const normalizedPlans = normalizeTo100Percent(selectedRaw, 'weight', 10);

  const planLetters = ['プランA', 'プランB', 'プランC', 'プランD'];
  const rankLabels = ['本命 ◎', '有力 ◯', '対抗 ▲', '注意 △'];

  const finalPlans = normalizedPlans.map((item, idx) => {
    const formattedFlights = item.rawFlights.map((df, fIdx) => {
      const origName = AIRPORT_NAMES[df.origin] || df.origin;
      const destName = AIRPORT_NAMES[df.dest] || df.dest;
      const depM = parseTimeToMinutes(df.depTime);
      const arrM = parseTimeToMinutes(df.arrTime);
      const stepLabel = getStepLabel(fIdx, item.rawFlights.length, depM, arrM, df.dest);
      const isLast = fIdx === item.rawFlights.length - 1;

      const modelPrio = getAircraftModelPriority(df, learnedModel);
      let tag = df.is767Strict
        ? '767機種予定'
        : (modelPrio >= 1.5 ? '763主力枠' : (df.is767 ? '763代走候補' : '機材変更候補'));
      if (fIdx === 0 && df.origin !== 'HND') {
        tag = `🔒${shortAirportName(df.origin)}始発・羽田帰還`;
      } else if (isLast) {
        tag = item.endAirport === 'HND'
          ? '🌙羽田帰還(泊)'
          : `🌙${shortAirportName(item.endAirport)}ナイトステイ(泊)`;
      }

      return {
        step: stepLabel,
        time: `${df.depTime}発 - ${df.arrTime}着`,
        depTime: df.depTime,
        arrTime: df.arrTime,
        flightNo: df.flightNo,
        orig: df.origin,
        dest: df.dest,
        route: `${origName} ➔ ${destName}`,
        model: df.model || '763',
        is767Confirmed: Boolean(df.is767),
        is767Strict: Boolean(df.is767Strict),
        tag
      };
    });

    const stops = [item.startAirport, ...item.rawFlights.map(f => f.dest)];
    const cleanStops = [];
    for (let i = 0; i < stops.length; i++) {
      if (i === 0 || stops[i] !== stops[i - 1]) {
        cleanStops.push(shortAirportName(stops[i]));
      }
    }
    const routeSummary = `${cleanStops.join(' ➔ ')}(泊)`;
    const startShort = shortAirportName(item.startAirport);
    const endShort = shortAirportName(item.endAirport);
    const firstFn = formattedFlights[0]?.flightNo || '';

    const fleetNote = item.fleetConsistency?.summary ? ` [フリート整合: ${item.fleetConsistency.summary}]` : '';
    const title = `【前夜${startShort}泊(${firstFn}始発)】${routeSummary}`;
    const description = `前夜${AIRPORT_NAMES[item.startAirport] || item.startAirport}駐機シナリオから連動。朝一${firstFn}(${formattedFlights[0]?.time})で始動し、ODPT公式ダイヤとマルコフ遷移実績に基づき全${formattedFlights.length}便を運航して夜に${endShort}泊となる予測スジ。${fleetNote}`;

    const uniqueAirports = [...new Set(stops.map(c => AIRPORT_NAMES[c] || c))];

    return {
      planId: `plan-${String.fromCharCode(97 + idx)}`,
      planName: `${planLetters[idx]} (${startShort}泊始発)`,
      stayCode: item.endAirport,
      startAirportCode: item.startAirport,
      rank: rankLabels[idx] || '候補',
      probability: item.probability,
      title,
      routeSummary,
      airports: uniqueAirports,
      description,
      fleetConsistency: item.fleetConsistency || null,
      flights: formattedFlights
    };
  });

  if (fullStayPriors && fullStayPriors.length > 0) {
    Object.defineProperty(finalPlans, '_fullStayPriors', {
      value: fullStayPriors,
      enumerable: false
    });
  }
  if (Object.keys(bestArrivalByAirport).length > 0) {
    Object.defineProperty(finalPlans, '_arrivalByAirport', {
      value: bestArrivalByAirport,
      enumerable: false
    });
  }
  return finalPlans;
}

/**
 * ある日のプラン群から、その日の夜の宿泊地周辺確率分布 P(Stay_d = S) を算出する（合計100%保証）
 */
function computeNextDayStayPriorsFromPlans(plans) {
  if (Array.isArray(plans) && Array.isArray(plans._fullStayPriors) && plans._fullStayPriors.length > 0) {
    return plans._fullStayPriors;
  }
  if (!Array.isArray(plans) || plans.length === 0) {
    return [{ code: 'HND', airport: '東京(羽田)', probability: 100 }];
  }
  const map = new Map();
  for (const p of plans) {
    const endCode = p.stayCode || p.flights?.[p.flights.length - 1]?.dest || 'HND';
    map.set(endCode, (map.get(endCode) || 0) + (p.probability || 33));
  }
  const items = [...map.entries()]
    .map(([code, weight]) => ({ code, airport: AIRPORT_NAMES[code] || code, weight }))
    .sort((a, b) => b.weight - a.weight);

  return normalizeTo100Percent(items, 'weight', 5).map(it => ({
    code: it.code,
    airport: it.airport,
    probability: it.probability
  }));
}

// ============================================================================
// 7. 実データ100%に基づく Out-of-Sample バックテスト ＆ 精度検証エンジン (P0 & P1: C1, C2 対応)
// ============================================================================
/**
 * fleetDb 内の JA609A の実運航履歴に対して、各日付 D より前のデータ（date < D）のみを用いた
 * Out-of-Sample 予測（または事後改ざんのないスナップショット）と実運航便を突合し、
 * 捏造ゼロの実測的中率と pastPredictions を計算・記録する。
 */
function computeRealAccuracyAndHistory(fleetDb, todayStr, anaFleetData, snapshots) {
  const ja609aFlights = Object.values(fleetDb?.flights || {}).filter(f => {
    if (f.reg !== 'JA609A' || !f.flightNo || !f.flightNo.startsWith('NH')) return false;
    const fnNum = parseInt(f.flightNo.replace(/[^0-9]/g, ''), 10);
    return fnNum > 0 && fnNum < 2000;
  });

  // 日付ごとに実運航便を整理
  const byDate = {};
  for (const f of ja609aFlights) {
    if (!byDate[f.date]) byDate[f.date] = [];
    const normFn = normalizeFlightNo(f.flightNo);
    const depMin = parseTimeToMinutes(f.depTime) ?? 0;
    if (!byDate[f.date].some(x => x.normFn === normFn)) {
      byDate[f.date].push({ ...f, normFn, depMin });
    }
  }

  for (const d of Object.keys(byDate)) {
    byDate[d].sort((a, b) => a.depMin - b.depMin);
  }

  // 完了済みの過去日リスト（todayStr 未満で、朝10:00以前の初便から記録があり4便以上運航記録がある完全日）
  const allDates = Object.keys(byDate).sort();
  const completedDates = allDates.filter(d => {
    if (d >= todayStr) return false;
    const list = byDate[d];
    if (!list || list.length < 4) return false;
    // 初便が午前10:00以前（depMin <= 600）から記録されている完全日のみを評価対象とする（途中から収集開始された初日の部分データを除外）
    return list[0].depMin <= 600;
  });

  let totalEvaluatedDays = 0;
  let firstFlightHitDays = 0;
  let perfectDays = 0;
  let totalFlightsEvaluated = 0;
  let totalFlightsHit = 0;
  const evalRecords = [];

  for (let i = 0; i < completedDates.length; i++) {
    const d = completedDates[i];
    const actualList = byDate[d];
    if (actualList.length === 0) continue;

    // 前日の最終到着地（前日のデータがあればその最終dest、なければ当日第1便のorig）
    const prevDate = i > 0 ? completedDates[i - 1] : null;
    const prevActual = prevDate ? byDate[prevDate] : null;
    const prevNightStayCode = (prevActual && prevActual.length > 0)
      ? prevActual[prevActual.length - 1].dest
      : actualList[0].orig;

    // Out-of-Sample モデル構築: 日付 d 当日以降の遷移は除外し、過去のパターン＋一般的なダイヤ構造で予測を生成
    // ※コールドスタート初期日でも路線構造が評価できるよう、JA609A以外の他機体（JA608A〜JA621A）のダイヤ構造は参照しつつ、
    //   評価対象日 d の JA609A 自身の運航データは完全に除外（Leave-One-Day-Out Cross Validation）してリークを防止
    const filteredDb = {
      flights: Object.fromEntries(
        Object.entries(fleetDb?.flights || {}).filter(([, fl]) => !(fl.reg === 'JA609A' && fl.date >= d))
      )
    };
    const oosModel = buildLearnedModel(filteredDb, null, getSeasonStartDateStr(d));

    const priorStays = [{ code: prevNightStayCode, probability: 100 }];
    const prevFirstFn = (prevActual && prevActual.length > 0) ? prevActual[0].normFn : null;
    const prevArrivalFlight = (prevActual && prevActual.length > 0) ? {
      orig: prevActual[prevActual.length - 1].orig || prevActual[prevActual.length - 1].origin,
      dest: prevActual[prevActual.length - 1].dest || prevActual[prevActual.length - 1].destination,
      flightNo: prevActual[prevActual.length - 1].flightNo
    } : null;
    // 前日までの連続地方泊数を算出（リークなし）
    let pastRegStreak = 0;
    for (let k = i - 1; k >= 0; k--) {
      const pList = byDate[completedDates[k]];
      if (!pList || pList.length === 0) break;
      const pStay = pList[pList.length - 1].dest;
      if (pStay === 'HND') break;
      pastRegStreak++;
    }
    const predictedPlans = generateDayPlansViaBeamSearch(
      priorStays,
      d,
      anaFleetData,
      oosModel,
      prevFirstFn,
      null,
      prevArrivalFlight,
      {
        regionalStayStreak: pastRegStreak,
        prevStartAirport: (prevActual && prevActual.length > 0) ? prevActual[0].orig : null
      }
    );

    // 予測された全プラン（プランA〜C）に含まれる便名セットと初便セット
    const predictedFirstFns = new Set(predictedPlans.map(p => normalizeFlightNo(p.flights?.[0]?.flightNo)).filter(Boolean));
    const predictedAllFns = new Set();
    for (const p of predictedPlans) {
      for (const pf of (p.flights || [])) {
        predictedAllFns.add(normalizeFlightNo(pf.flightNo));
      }
    }

    // どのプランが最も多く当日の実運航便と一致したかを特定
    let bestPlan = predictedPlans[0] || null;
    let bestPlanHits = -1;
    for (const p of predictedPlans) {
      const pSet = new Set((p.flights || []).map(pf => normalizeFlightNo(pf.flightNo)));
      const hits = actualList.filter(af => pSet.has(af.normFn)).length;
      if (hits > bestPlanHits) {
        bestPlanHits = hits;
        bestPlan = p;
      }
    }

    const isFirstHit = predictedFirstFns.has(actualList[0].normFn);
    let dayHitFlights = 0;

    const stepNums = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
    const evaluatedFlights = actualList.map((af, fIdx) => {
      const isHit = predictedAllFns.has(af.normFn);
      if (isHit) dayHitFlights++;
      const origShort = shortAirportName(af.orig);
      const destShort = shortAirportName(af.dest);
      return {
        step: `${stepNums[fIdx] || `#${fIdx + 1}`} ${fIdx === 0 ? '朝一初便' : (fIdx === actualList.length - 1 ? '夜最終便' : `第${fIdx + 1}便`)}`,
        flightNo: af.normFn,
        route: `${origShort} ➔ ${destShort}`,
        time: `${af.depTime}発 - ${af.arrTime}着`,
        isHit,
        hitLabel: isHit ? '🎯 的中' : '△ プラン外分岐'
      };
    });

    totalEvaluatedDays++;
    if (isFirstHit) firstFlightHitDays++;
    if (dayHitFlights === actualList.length) perfectDays++;
    totalFlightsEvaluated += actualList.length;
    totalFlightsHit += dayHitFlights;

    const dtObj = new Date(`${d}T00:00:00+09:00`);
    const dateJa = formatJaDate(dtObj);
    const actualStops = [actualList[0].orig, ...actualList.map(af => af.dest)].map(c => shortAirportName(c));
    const actualSummary = `実運航: ${actualStops.join(' ➔ ')}(泊)`;
    const predictedSummary = bestPlan
      ? `${bestPlan.planName.split(' ')[0]}: ${bestPlan.routeSummary}`
      : '予測データなし';

    const hitPct = Math.round((dayHitFlights / actualList.length) * 100);
    const planShortName = bestPlan ? bestPlan.planName.split(' ')[0] : '予想';
    const hitLabel = dayHitFlights === actualList.length
      ? `🎯 ${planShortName} 完全的中 (${dayHitFlights}/${actualList.length}便)`
      : `📊 ${actualList.length}便中${dayHitFlights}便的中 (${hitPct}%)`;

    const failureInfo = classifyEvaluationFailure({
      actualList,
      evaluatedFlights,
      prevNightStayCode,
      isFirstHit,
      dayHitFlights
    });

    evalRecords.push({
      dateStr: d,
      date: dateJa,
      type: `1日通しダイヤ (全${actualList.length}便)`,
      hitLabel,
      hitRate: `${hitPct}%`,
      predicted: predictedSummary,
      actual: actualSummary,
      flights: evaluatedFlights,
      dayHitFlights,
      dayTotalFlights: actualList.length,
      isPerfect: dayHitFlights === actualList.length,
      isFirstHit,
      failureCategory: failureInfo.failureCategory,
      failureCategoryLabel: failureInfo.failureCategoryLabel,
      failureDetail: failureInfo.failureDetail,
      reason: dayHitFlights === actualList.length
        ? `前夜${shortAirportName(prevNightStayCode)}泊からの初便(${actualList[0].normFn})および後続の全${actualList.length}便が予測シナリオと完全一致`
        : `${failureInfo.failureCategoryLabel}: ${failureInfo.failureDetail}（${dayHitFlights}/${actualList.length}便的中）`
    });
  }

  // 連続的中日数（直近から遡って初便＆主要スジが的中した連続日数）
  let streakHits = 0;
  for (let i = evalRecords.length - 1; i >= 0; i--) {
    if (evalRecords[i].dayHitFlights >= Math.ceil(evalRecords[i].dayTotalFlights * 0.75)) {
      streakHits++;
    } else {
      break;
    }
  }

  const dailyFullHitRate = totalFlightsEvaluated > 0
    ? Number(((totalFlightsHit / totalFlightsEvaluated) * 100).toFixed(1))
    : 0;
  const firstFlightHitRate = totalEvaluatedDays > 0
    ? Number(((firstFlightHitDays / totalEvaluatedDays) * 100).toFixed(1))
    : 0;
  const failureBreakdown = summarizeFailureBreakdown(evalRecords);

  const accuracyStats = {
    dailyFullHitRate,
    firstFlightHitRate,
    totalEvaluatedDays,
    perfectDays,
    totalFlightsEvaluated,
    totalFlightsHit,
    streakHits,
    failureBreakdown,
    evaluationPeriod: completedDates.length > 0
      ? `${completedDates[0]} 〜 ${completedDates[completedDates.length - 1]} (実データ検証)`
      : '実データ検証中'
  };

  // 監査ログ (evaluation_log.jsonl) の原子保存（外れ要因自動分類タグ付き）
  try {
    const lines = evalRecords.map(r => JSON.stringify({
      evaluatedAt: new Date().toISOString(),
      date: r.dateStr,
      firstFlightHit: r.isFirstHit,
      hitFlights: r.dayHitFlights,
      totalFlights: r.dayTotalFlights,
      hitRate: r.hitRate,
      failureCategory: r.failureCategory,
      failureCategoryLabel: r.failureCategoryLabel,
      failureDetail: r.failureDetail,
      actual: r.actual,
      predicted: r.predicted
    }));
    atomicWriteFileSync(EVAL_LOG_FILE, lines.join('\n') + '\n', 'utf-8');
  } catch (e) {
    console.warn('⚠️ evaluation_log.jsonl 書き込み警告:', e.message);
  }

  // 新しい順に並べて返す
  const pastPredictions = [...evalRecords].reverse();
  return { accuracyStats, pastPredictions, byDate };
}

// ============================================================================
// 8. 週間路線確率（Day 2〜Day 6 サマリー用）＆ 空港遭遇確率レーダーの動的集計
// ============================================================================
function buildDynamicRouteSummaryForDay(dayPlans, dayScheduleFlights, learnedModel, isWeekend) {
  // その日の連鎖プランA/B/Cに含まれる路線とODPTの767設定便から上位5路線を抽出
  const routeScores = new Map();
  const routeFlights = new Map();

  for (const plan of (dayPlans || [])) {
    const pWeight = plan.probability || 25;
    for (const f of (plan.flights || [])) {
      const orig = f.orig || getAirportCodeFromName(f.route?.split('➔')[0]);
      const dest = f.dest || getAirportCodeFromName(f.route?.split('➔')[1]);
      if (!orig || !dest) continue;
      const isInterCity = orig !== 'HND' && dest !== 'HND';
      const pairKey = isInterCity
        ? [orig, dest].sort().join('-')
        : `HND-${orig === 'HND' ? dest : orig}`;

      routeScores.set(pairKey, (routeScores.get(pairKey) || 0) + pWeight * 0.45);
      if (!routeFlights.has(pairKey)) routeFlights.set(pairKey, new Set());
      routeFlights.get(pairKey).add(f.flightNo);
    }
  }

  // ODPTのその曜日の767設定枠も加味
  for (const sf of dayScheduleFlights) {
    if (!sf.is767) continue;
    const isInterCity = sf.origin !== 'HND' && sf.dest !== 'HND';
    const pairKey = isInterCity
      ? [sf.origin, sf.dest].sort().join('-')
      : `HND-${sf.origin === 'HND' ? sf.dest : sf.origin}`;

    const addScore = sf.is767Strict ? 8 : 3;
    routeScores.set(pairKey, (routeScores.get(pairKey) || 0) + addScore);
    if (!routeFlights.has(pairKey)) routeFlights.set(pairKey, new Set());
    if (routeFlights.get(pairKey).size < 4) {
      routeFlights.get(pairKey).add(sf.flightNo);
    }
  }

  const rawItems = [...routeScores.entries()]
    .map(([pairKey, weight]) => {
      const [a, b] = pairKey.split('-');
      const isInterCity = a !== 'HND' && b !== 'HND';
      const routeLabel = `${AIRPORT_NAMES[a] || a} ⇔ ${AIRPORT_NAMES[b] || b}`;
      const fns = [...(routeFlights.get(pairKey) || [])].slice(0, 4).join(' / ');
      return {
        pairKey,
        route: routeLabel,
        destCode: a === 'HND' ? b : a,
        isInterCity,
        weight,
        candidateFlights: fns || 'ANA B767定期便'
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const normalized = normalizeTo100Percent(rawItems, 'weight', 8);
  const planLetters = ['プランA', 'プランB', 'プランC', 'プランD', 'プランE'];

  return normalized.map((item, idx) => {
    let rank = '可能性あり △';
    let star = '★★☆☆☆';
    if (item.isInterCity) {
      rank = '地方直行 ✈️';
      star = '★★★★☆';
    } else if (item.probability >= 25) {
      rank = '本命 ◎';
      star = '★★★★★';
    } else if (item.probability >= 18) {
      rank = '有力 ◯';
      star = '★★★★☆';
    } else if (item.probability >= 12) {
      rank = '注目 ▲';
      star = '★★★☆☆';
    }
    return {
      route: item.route,
      destCode: item.destCode,
      isInterCity: item.isInterCity,
      probability: item.probability,
      candidateFlights: item.candidateFlights,
      note: item.isInterCity ? '地方間直行B767スジ' : '羽田発着B767幹線スジ',
      star,
      rank,
      planName: planLetters[idx] || `プラン${idx + 1}`
    };
  });
}

function buildDynamicAirportRadar(learnedModel) {
  const routeFreq = learnedModel.routeFreq || {};
  const airportCounts = {};
  for (const [rKey, cnt] of Object.entries(routeFreq)) {
    const [o, d] = rKey.split('-');
    if (o) airportCounts[o] = (airportCounts[o] || 0) + cnt;
    if (d) airportCounts[d] = (airportCounts[d] || 0) + cnt;
  }
  const maxNonHnd = Math.max(1, ...Object.entries(airportCounts).filter(([k]) => k !== 'HND').map(([, v]) => v));

  const targetAirports = [
    { code: 'HND', name: '東京(羽田)', note: 'B767国内線の全国ハブ拠点。ほぼ毎日発着。' },
    { code: 'NGS', name: '長崎空港', note: '朝一便（NH661/NH664）および夜間ステイ便（NH669/NH662）で高頻度投入。' },
    { code: 'HIJ', name: '広島空港', note: '昼往復便（NH679/NH680）および夜間ステイ便（NH685/NH672）の主要拠点。' },
    { code: 'ITM', name: '大阪(伊丹)', note: '羽田シャトル便（NH18/NH21/NH23/NH39等）と新千歳直行便が乗り入れ。' },
    { code: 'KIX', name: '大阪(関空)', note: '羽田-関空線（NH93/NH96等）でB767充当実績あり。関西の重要拠点。' },
    { code: 'CTS', name: '新千歳空港', note: '羽田・伊丹・中部・神戸を結ぶ北の基幹ネットワーク。' },
    { code: 'FUK', name: '福岡空港', note: '羽田幹線（NH245/NH250/NH265/NH270等）で連日高頻度運航。' },
    { code: 'KOJ', name: '鹿児島空港', note: '早朝羽田発（NH619/NH622）や夕方往復（NH627/NH630）の定番路線。' },
    { code: 'MYJ', name: '松山空港', note: '午後便（NH593/NH596）や夕方便での投入実績多数。' },
    { code: 'NGO', name: '名古屋(中部)', note: '新千歳便（NH703/NH712等）や羽田便の夜間ステイ拠点。' },
    { code: 'UKB', name: '神戸空港', note: '新千歳-神戸-羽田を結ぶ三角運航（NH578/NH416）で投入。' },
    { code: 'OKA', name: '沖縄(那覇)', note: '羽田・伊丹・中部から飛来する大型幹線。' },
    { code: 'KMJ', name: '熊本空港', note: '羽田-熊本線（NH641/NH644等）でB767定期枠あり。' },
    { code: 'HKD', name: '函館空港', note: '羽田-函館線（NH553/NH554等）でB767投入実績あり。' },
    { code: 'TOY', name: '富山空港', note: '羽田-富山線（NH319/NH322）でB767投入実績あり。' },
    { code: 'KMQ', name: '小松空港', note: '羽田-小松線（NH751/NH754等）でB767投入実績あり。' },
    { code: 'KCZ', name: '高知空港', note: '羽田-高知線（NH561/NH564等）でB767投入実績あり。' },
    { code: 'KMI', name: '宮崎空港', note: '羽田-宮崎線（NH601/NH608等）でB767投入実績あり。' },
    { code: 'AKJ', name: '旭川空港', note: '羽田-旭川線（NH4783/NH783等）で季節・曜日により投入。' },
    { code: 'OIT', name: '大分空港', note: '羽田-大分線（NH791/NH794等）でB767運航枠あり。' }
  ];

  return targetAirports.map(ap => {
    if (ap.code === 'HND') {
      return { ...ap, prob: 98, level: 'S (毎日運航)' };
    }
    const cnt = airportCounts[ap.code] || 1;
    const rawProb = Math.round(12 + (cnt / maxNonHnd) * 62);
    const prob = Math.max(10, Math.min(78, rawProb));
    let level = 'C (注目)';
    if (prob >= 55) level = 'A (高確率)';
    else if (prob >= 35) level = 'B (中確率)';
    else if (prob < 20) level = 'D (機会あり)';
    return { ...ap, prob, level };
  }).sort((a, b) => b.prob - a.prob);
}

// ============================================================================
// 9. メイン予測パイプライン
// ============================================================================
export async function generateWeeklyPrediction() {
  const jstNow = getJSTNow();
  const todayStr = formatDate(jstNow);
  const hh = String(jstNow.getHours()).padStart(2, '0');
  const min = String(jstNow.getMinutes()).padStart(2, '0');
  const nowJa = `${jstNow.getFullYear()}年${jstNow.getMonth() + 1}月${jstNow.getDate()}日 ${hh}:${min}`;

  const isFull = process.argv.includes('--full');
  const isQuick = !isFull || process.argv.includes('--quick');

  console.log('========================================================');
  console.log(`✈️  === ANAちいかわジェット (JA609A) 運行予測エンジン (${isQuick ? '軽量モード: 予定機材JA609Aのみ' : 'フル更新モード'}) ===`);
  console.log(`📅 実行時刻: ${nowJa} (JST)`);
  console.log('========================================================\n');

  // 1. 同型機フライト履歴の収集＆学習モデル構築（予定機材JA609Aのみ更新してサーバー負荷を徹底抑制）
  const fleetDb = await collectFleetData({ targetRegOnly: isQuick, targetReg: 'JA609A' });
  const learnedModel = buildLearnedModel(fleetDb, null, getSeasonStartDateStr(todayStr));
  console.log(`📚 学習済みDB構築完了: 全 ${learnedModel.totalFlights} 便 (ダイヤ基準日: ${learnedModel.seasonStartDate}以降) / 稼働76P機体数: ${learnedModel.activeFleetCount} 機`);

  // 2. ANA公式運航状況（ODPT確定機種＆週間ダイヤデータ）のロード（キャッシュがあれば外部APIをスキップ）
  const anaFleetData = await loadAnaFleetStatus({ force: isFull });
  const anaDateKeys = Object.keys(anaFleetData.dates || {});
  console.log(`✈️ ANA公式運航状況ロード完了: 対象日 [${anaDateKeys.join(', ')}]`);

  // 3. 状態付き他機体消去法エンジン（他機体担当便＆地方折返し＆欠航便の除外）
  const assignedOtherMap = buildAssignedOtherRegFlights(fleetDb, todayStr, anaFleetData, learnedModel);
  console.log(`🔍 他機体消去法＆欠航除外エンジン: 本日除外対象 ${assignedOtherMap.size} 便をロック`);

  // 4. JA609A の当日の実運航状況を取得（FR24 ＋ 既存DB統合）
  const rawFlights = fetchChiikawaFlights();
  const parsedFlights = [];
  for (const f of rawFlights) {
    const flightNo = f.identification?.number?.default;
    const origCode = f.airport?.origin?.code?.iata;
    const destCode = f.airport?.destination?.code?.iata;
    if (!flightNo || !origCode || !destCode) continue;
    const normFn = normalizeFlightNo(flightNo);
    const fnNum = parseInt(normFn.replace(/[^0-9]/g, ''), 10);
    if (!fnNum || fnNum >= 2000) continue;

    const origName = AIRPORT_NAMES[origCode] || origCode;
    const destName = AIRPORT_NAMES[destCode] || destCode;
    const statusText = f.status?.text || '';

    const depSched = f.time?.scheduled?.departure;
    const depReal = f.time?.real?.departure;
    const arrSched = f.time?.scheduled?.arrival;
    const arrReal = f.time?.real?.arrival;
    const isLanded = Boolean(arrReal) || /Landed/i.test(statusText);
    const isLive = !isLanded && (Boolean(depReal) || /Active|Live|EnRoute|InAir/i.test(statusText));
    const depTs = depSched || depReal || 0;
    const arrTs = arrSched || arrReal || 0;
    if (!depTs) continue;

    const depDate = new Date(depTs * 1000);
    const depJst = new Date(depDate.getTime() + (9 * 60 + depDate.getTimezoneOffset()) * 60 * 1000);
    const flightDateStr = formatDate(depJst);

    parsedFlights.push({
      flightNo: normFn,
      origCode,
      destCode,
      origName,
      destName,
      route: `${origName} ➔ ${destName}`,
      dateStr: flightDateStr,
      depTime: formatTime(depTs),
      arrTime: formatTime(arrTs),
      depTs,
      arrTs,
      statusRaw: statusText,
      statusJa: translateStatus(statusText),
      isLanded,
      isLive,
      actualDepTime: depReal ? formatTime(depReal) : null,
      actualArrTime: arrReal ? formatTime(arrReal) : null
    });
  }

  // マスターDBに保存済みの本日のJA609A便もマージ（FR24一時取得失敗時の耐障害性）
  const dbTodayJa609a = Object.values(fleetDb?.flights || {}).filter(
    f => f.reg === 'JA609A' && f.date === todayStr && f.flightNo && f.flightNo.startsWith('NH')
  );
  for (const dbf of dbTodayJa609a) {
    const normFn = normalizeFlightNo(dbf.flightNo);
    if (!parsedFlights.some(pf => pf.dateStr === todayStr && pf.flightNo === normFn)) {
      const origName = AIRPORT_NAMES[dbf.orig] || dbf.orig;
      const destName = AIRPORT_NAMES[dbf.dest] || dbf.dest;
      parsedFlights.push({
        flightNo: normFn,
        origCode: dbf.orig,
        destCode: dbf.dest,
        origName,
        destName,
        route: `${origName} ➔ ${destName}`,
        dateStr: todayStr,
        depTime: dbf.depTime,
        arrTime: dbf.arrTime,
        depTs: parseTimeToMinutes(dbf.depTime) ?? 0,
        arrTs: parseTimeToMinutes(dbf.arrTime) ?? 0,
        statusRaw: dbf.status || 'Scheduled',
        statusJa: translateStatus(dbf.status || 'Scheduled'),
        isLanded: Boolean(dbf.realArrival) || /Landed/i.test(dbf.status || ''),
        isLive: !dbf.realArrival && !/Landed/i.test(dbf.status || '') &&
          (Boolean(dbf.realDeparture) || /EnRoute|InAir|Active|Live/i.test(dbf.status || '')),
        actualDepTime: dbf.realDeparture ? formatTime(dbf.realDeparture) : null,
        actualArrTime: dbf.realArrival ? formatTime(dbf.realArrival) : null
      });
    }
  }

  parsedFlights.sort((a, b) => (parseTimeToMinutes(a.depTime) ?? 0) - (parseTimeToMinutes(b.depTime) ?? 0));
  const todayFlights = parsedFlights.filter(f => f.dateStr === todayStr);

  // 5. 現在地特定
  let currentAirport = '東京(羽田)';
  let currentAirportCode = 'HND';
  let isAirborne = false;

  const liveFlight = todayFlights.find(f => f.isLive);
  const landedToday = todayFlights.filter(f => f.isLanded);
  if (liveFlight) {
    currentAirport = `飛行中 (${liveFlight.origName} ➔ ${liveFlight.destName})`;
    currentAirportCode = liveFlight.destCode;
    isAirborne = true;
  } else if (landedToday.length > 0) {
    const lastLanded = landedToday[landedToday.length - 1];
    currentAirport = lastLanded.destName;
    currentAirportCode = lastLanded.destCode;
  } else if (todayFlights.length > 0) {
    currentAirport = todayFlights[0].origName;
    currentAirportCode = todayFlights[0].origCode;
  }

  // 6. 当日残り便＆今夜の宿泊地ベイズ推定
  const remainderPred = predictTodayRemainderAndNightStay(
    todayFlights,
    todayStr,
    anaFleetData,
    learnedModel,
    assignedOtherMap
  );

  const {
    isNightStayConfirmed,
    nightStayCode,
    nightStayName,
    nightStayProbabilities,
    predictedRemainingToday,
    todayPlans,
    pendingNightStayNote
  } = remainderPred;

  // 7. スナップショット管理（Immutable Snapshot: 当日が始まった後の事後改ざんを完全禁止）
  let snapshots = {};
  if (fs.existsSync(SNAPSHOT_FILE)) {
    try {
      snapshots = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
    } catch (e) {
      snapshots = {};
    }
  }

  // 実データ精度検証＆過去日履歴を構築
  const { accuracyStats, pastPredictions, byDate: actualByDate } = computeRealAccuracyAndHistory(
    fleetDb,
    todayStr,
    anaFleetData,
    snapshots
  );

  // 連続稼働日数・連続地方泊・整備（運休/羽田帰還）リスク分析
  const maintenanceProfile = analyzeOperatingAndMaintenanceProfile(fleetDb, todayStr, nightStayCode);
  console.log(`🔧 稼働・整備分析: 連続稼働 ${maintenanceProfile.ja609aConsecutiveOperatingDays}日 / 連続地方泊見込 ${maintenanceProfile.projectedRegionalStayStreak}泊 / 帰還圧力: ${maintenanceProfile.hndReturnPressure} / 整備リスク: ${maintenanceProfile.maintenanceRiskLevel}`);

  // 8. 向こう7日間（Day 0 〜 Day 6）の連鎖スケジュール構築
  const weeklyDays = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(jstNow.getTime() + i * 24 * 60 * 60 * 1000);
    const dStr = formatDate(dt);
    const dJa = formatJaDate(dt);
    const dow = DAY_NAMES[dt.getDay()];
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
    weeklyDays.push({
      dayIndex: i,
      dateStr: dStr,
      dateJa: dJa,
      dow,
      isWeekend
    });
  }

  // 明日（Day 1）のプラン生成：今夜の宿泊地確率分布 nightStayProbabilities を事前分布としてビームサーチ
  const tomorrowDateStr = weeklyDays[1].dateStr;
  const todayFirstFn = todayFlights.length > 0 ? normalizeFlightNo(todayFlights[0].flightNo) : null;
  const todayVisitedDests = new Set(todayFlights.map(f => f.destCode || f.dest).filter(Boolean));
  const lastTodayFlight = todayFlights.length > 0 ? todayFlights[todayFlights.length - 1] : null;
  const tomorrowArrivalFlight = lastTodayFlight ? {
    orig: lastTodayFlight.origCode || lastTodayFlight.origin,
    dest: lastTodayFlight.destCode || lastTodayFlight.dest,
    flightNo: lastTodayFlight.flightNo
  } : null;
  const currentArrivalGate = String(
    anaFleetData?.dates?.[todayStr.replace(/-/g, '')]?.[lastTodayFlight?.flightNo]?.arrGate || ''
  ).trim().toUpperCase();
  const tomorrowArrival = isNightStayConfirmed && lastTodayFlight?.isLanded &&
    lastTodayFlight.actualArrTime && lastTodayFlight.destCode === nightStayCode ? {
      airport: nightStayCode,
      arrivalMin: parseTimeToMinutes(lastTodayFlight.actualArrTime),
      gate: /^(?:[5-9]\d)[A-Z]?$/.test(currentArrivalGate) ? currentArrivalGate : null,
      flightNo: lastTodayFlight.flightNo,
      time: lastTodayFlight.actualArrTime
    } : null;
  const tomorrowFirstRaw = [];
  const tomorrowPlans = generateDayPlansViaBeamSearch(
    nightStayProbabilities,
    tomorrowDateStr,
    anaFleetData,
    learnedModel,
    todayFirstFn,
    todayVisitedDests,
    tomorrowArrivalFlight,
    {
      capture: tomorrowFirstRaw,
      arrival: tomorrowArrival,
      regionalStayStreak: maintenanceProfile.projectedRegionalStayStreak,
      prevStartAirport: todayFlights.length > 0 ? (todayFlights[0].origCode || todayFlights[0].orig) : null
    }
  );

  const previousDateStr = formatDate(new Date(jstNow.getTime() - 24 * 60 * 60 * 1000));
  const previousLanded = parsedFlights
    .filter(f => f.dateStr === previousDateStr && f.isLanded && f.actualArrTime)
    .sort((a, b) => (parseTimeToMinutes(a.depTime) ?? 0) - (parseTimeToMinutes(b.depTime) ?? 0))
    .at(-1);
  const previousGateRaw = previousLanded
    ? anaFleetData?.dates?.[previousDateStr.replace(/-/g, '')]?.[previousLanded.flightNo]?.arrGate
    : null;
  const gateText = String(previousGateRaw || '').trim().toUpperCase();
  const previousGate = /^(?:[5-9]\d)[A-Z]?$/.test(gateText) ? gateText : null;
  const arrivalContext = previousLanded ? {
    airport: previousLanded.destCode,
    arrivalMin: parseTimeToMinutes(previousLanded.actualArrTime),
    gate: previousGate,
    flightNo: previousLanded.flightNo,
    time: previousLanded.actualArrTime
  } : null;

  function rankFirstCandidates(raw, scoreField = 'score') {
    const byFlight = new Map();
    for (const flight of raw) {
      const key = `${flight.orig}:${flight.flightNo}`;
      const existing = byFlight.get(key);
      if (existing) existing.rankScore += flight[scoreField];
      else byFlight.set(key, { ...flight, rankScore: flight[scoreField] });
    }
    return [...byFlight.values()].sort((a, b) => b.rankScore - a.rankScore).slice(0, 5)
      .map(({ score, shadowScore, rankScore, ...flight }) => flight);
  }

  const tomorrowFirstFlights = rankFirstCandidates(tomorrowFirstRaw);
  const morningFirstRaw = [];
  const firstObserved = todayFlights.find(f => f.isLive || f.isLanded);
  const fleetUpdatedAt = Date.parse(anaFleetData?.updatedAt || '');
  const freshFleetData = Number.isFinite(fleetUpdatedAt) &&
    Date.now() - fleetUpdatedAt >= 0 && Date.now() - fleetUpdatedAt <= 2 * 60 * 60 * 1000;
  const previousDayFlights = parsedFlights
    .filter(f => f.dateStr === previousDateStr)
    .sort((a, b) => (parseTimeToMinutes(a.depTime) ?? 0) - (parseTimeToMinutes(b.depTime) ?? 0));
  const previousDayFirst = previousDayFlights[0] || null;
  if (!firstObserved && arrivalContext && arrivalContext.arrivalMin !== null &&
      freshFleetData && jstNow.getHours() >= 5 && jstNow.getHours() < 17) {
    generateDayPlansViaBeamSearch(
      [{ code: arrivalContext.airport, probability: 100 }], todayStr, anaFleetData,
      learnedModel, previousDayFirst ? normalizeFlightNo(previousDayFirst.flightNo) : null, null, previousLanded,
      { capture: morningFirstRaw, currentDay: true, nowMin: jstNow.getHours() * 60 + jstNow.getMinutes(),
        assignedOther: assignedOtherMap, arrival: arrivalContext,
        prevStartAirport: previousDayFirst?.origCode || null }
    );
  }
  const morningFirstFlightsRaw = rankFirstCandidates(morningFirstRaw);
  let firstFlightHistory = {};
  if (fs.existsSync(FIRST_FLIGHT_HISTORY_FILE)) {
    try {
      firstFlightHistory = JSON.parse(fs.readFileSync(FIRST_FLIGHT_HISTORY_FILE, 'utf-8'));
    } catch (error) {
      console.warn('⚠️ 初便予想履歴を読み込めません。履歴の更新を見送ります:', error.message);
      firstFlightHistory = null;
    }
  }
  const nowMinutesJst = jstNow.getHours() * 60 + jstNow.getMinutes();
  if (firstFlightHistory) {
    if (tomorrowFirstFlights.length && jstNow.getHours() >= 17) {
      firstFlightHistory[tomorrowDateStr] ||= {};
      firstFlightHistory[tomorrowDateStr].previousNight = {
        updatedAtIso: new Date().toISOString(), candidates: tomorrowFirstFlights,
        trialCandidates: rankFirstCandidates(tomorrowFirstRaw, 'shadowScore'),
        trialApplicable: Boolean(tomorrowArrival)
      };
    }
    if (morningFirstFlightsRaw.length) {
      firstFlightHistory[todayStr] ||= {};
      const existingMorning = firstFlightHistory[todayStr].morning;
      // 💡 当朝初便スナップショット不変保護（上書き汚染防止）:
      // 既に朝スナップショットが保存済みで、その1位候補の出発15分前以降（または朝07:45以降）に達している場合、
      // FR24離陸検知遅延による本命便脱落で当朝予想を上書き破壊するのを厳禁とする。
      let canWriteMorning = !existingMorning || !(existingMorning.candidates?.length);
      if (!canWriteMorning) {
        const existingTopDepMin = parseTimeToMinutes(existingMorning.candidates[0]?.depTime);
        const lockCutoffMin = existingTopDepMin !== null ? Math.min(465, existingTopDepMin - 15) : 450; // 最大07:45または出発15分前
        if (nowMinutesJst < lockCutoffMin) {
          canWriteMorning = true;
        }
      }
      if (canWriteMorning) {
        firstFlightHistory[todayStr].morning = {
          updatedAtIso: new Date().toISOString(), arrival: arrivalContext, candidates: morningFirstFlightsRaw,
          trialCandidates: rankFirstCandidates(morningFirstRaw, 'shadowScore'), trialApplicable: true
        };
      }
    }
    if (firstObserved && firstFlightHistory[todayStr]) {
      firstFlightHistory[todayStr].actual = {
        flightNo: firstObserved.flightNo, route: firstObserved.route
      };
    }
    atomicWriteFileSync(FIRST_FLIGHT_HISTORY_FILE, JSON.stringify(firstFlightHistory, null, 2), 'utf-8');
  }
  const morningFirstFlights = morningFirstFlightsRaw.length > 0
    ? morningFirstFlightsRaw
    : (firstFlightHistory?.[todayStr]?.morning?.candidates || []);
  const firstFlightStats = {};
  for (const phase of ['previousNight', 'morning']) {
    const entries = Object.values(firstFlightHistory || {}).filter(
      entry => entry.actual?.flightNo && entry[phase]?.candidates?.length
    );
    firstFlightStats[phase] = {
      total: entries.length,
      firstHits: entries.filter(entry => entry[phase].candidates[0].flightNo === entry.actual.flightNo).length,
      candidateHits: entries.filter(entry => entry[phase].candidates.some(
        candidate => candidate.flightNo === entry.actual.flightNo
      )).length
    };
  }
  // Compare both revisions on identical days only; do not count an absent morning forecast as a miss.
  const pairedEntries = Object.values(firstFlightHistory || {}).filter(entry =>
    entry.actual?.flightNo && entry.previousNight?.candidates?.length && entry.morning?.candidates?.length);
  const pairedFirstFlightStats = {
    total: pairedEntries.length,
    previousNightHits: pairedEntries.filter(e => e.previousNight.candidates[0].flightNo === e.actual.flightNo).length,
    morningHits: pairedEntries.filter(e => e.morning.candidates[0].flightNo === e.actual.flightNo).length
  };
  const trialEntries = Object.values(firstFlightHistory || {}).flatMap(entry =>
    ['previousNight', 'morning'].map(phase => ({ actual: entry.actual, prediction: entry[phase] })))
    .filter(e => e.actual?.flightNo && e.prediction?.trialApplicable && e.prediction?.trialCandidates?.length);
  const overnightTrialStats = {
    samplePairs: learnedModel.overnightPairs.length,
    chiikawaPairs: learnedModel.overnightPairs.filter(p => p.reg === 'JA609A').length,
    screening: walkForward(learnedModel.overnightPairs),
    savedComparisons: trialEntries.length,
    baselineHits: trialEntries.filter(e => e.prediction.candidates[0].flightNo === e.actual.flightNo).length,
    trialHits: trialEntries.filter(e => e.prediction.trialCandidates[0].flightNo === e.actual.flightNo).length
  };

  // 明日の最新予測を明日のスナップショットとして原子保存（明日になった後は上書きされない）
  if (tomorrowPlans && tomorrowPlans.length > 0) {
    snapshots[tomorrowDateStr] = tomorrowPlans;
  }

  try {
    atomicWriteFileSync(SNAPSHOT_FILE, JSON.stringify(snapshots, null, 2), 'utf-8');
  } catch (e) {
    console.warn('⚠️ daily_predictions_snapshot.json 保存警告:', e.message);
  }

  const weeklySchedule = [];
  let runningPriors = computeNextDayStayPriorsFromPlans(tomorrowPlans);
  let runningArrivalByAirport = tomorrowPlans?._arrivalByAirport || {};
  let prevDayFirstFn = tomorrowPlans[0]?.flights?.[0]?.flightNo || null;
  let runningRegionalStreak = (tomorrowPlans[0]?.stayCode && tomorrowPlans[0].stayCode !== 'HND')
    ? (maintenanceProfile.projectedRegionalStayStreak + 1)
    : 0;

  for (const day of weeklyDays) {
    if (day.dayIndex === 0) {
      // Day 0: 本日（昨晩時点の予想 vs 実際 比較テーブル ＆ 本日残り予測）
      const todayKey = todayStr.replace(/-/g, '');
      const todayAnaMap = anaFleetData?.dates?.[todayKey] || {};
      const combinedTodayFlights = [
        ...todayFlights.map(f => ({
          flightNo: f.flightNo,
          route: f.route,
          time: `${f.depTime}発 - ${f.arrTime}着`,
          depGate: todayAnaMap[normalizeFlightNo(f.flightNo)]?.depGate || null,
          arrGate: todayAnaMap[normalizeFlightNo(f.flightNo)]?.arrGate || null,
          status: f.statusJa,
          isLanded: f.isLanded,
          isLive: f.isLive,
          isPredicted: false
        })),
        ...predictedRemainingToday.map(pf => ({
          ...pf,
          depGate: pf.depGate || todayAnaMap[normalizeFlightNo(pf.flightNo)]?.depGate || null,
          arrGate: pf.arrGate || todayAnaMap[normalizeFlightNo(pf.flightNo)]?.arrGate || null
        }))
      ];

      const lastNightPlans = snapshots[day.dateStr] || [];
      const [planA, planB, planC] = lastNightPlans;
      const maxSlots = Math.max(todayFlights.length, ...lastNightPlans.map(plan => plan.flights.length));
      const reportedFlights = anaFleetData?.dates?.[todayStr.replace(/-/g, '')] || {};
      function compareFlight(flight) {
        if (!flight) return null;
        const reported = reportedFlights[normalizeFlightNo(flight.flightNo)];
        // status は当日運航情報にのみ付く。週間ダイヤの機種一覧は変更判定に使わない。
        let update = null;
        if (reported?.isCancelled) update = '当日情報：欠航';
        else if (reported?.status && reported.model && !reported.is767 && !reported.model.includes('76')) {
          update = `当日機種：${reported.model}（767対象外）`;
        }
        return { flightNo: flight.flightNo, route: flight.route, time: flight.time, update };
      }

      const todayComparison = [];
      for (let i = 0; i < maxSlots; i++) {
        const fa = planA?.flights?.[i] || null;
        const fb = planB?.flights?.[i] || null;
        const fc = planC?.flights?.[i] || null;
        const act = todayFlights[i] || null;

        todayComparison.push({
          step: `#${i + 1}`,
          planA: compareFlight(fa),
          planB: compareFlight(fb),
          planC: compareFlight(fc),
          actual: act && (act.isLanded || act.isLive) ? {
            flightNo: act.flightNo,
            route: act.route,
            time: [act.actualDepTime && `${act.actualDepTime}離陸`, act.actualArrTime && `${act.actualArrTime}着陸`].filter(Boolean).join(' / '),
            status: act.isLanded ? '着陸済' : '飛行中',
            isLanded: act.isLanded,
            isLive: act.isLive
          } : null
        });
      }

      const todayPlanHeaders = lastNightPlans.map(plan => ({
        name: plan.planName.split(' ')[0],
        prob: plan.probability
      }));

      weeklySchedule.push({
        ...day,
        statusType: 'today',
        statusLabel: '本日（リアルタイム＋夕方以降ベイズ予測）',
        firstFlightCandidates: morningFirstFlights,
        firstFlightArrival: arrivalContext,
        firstFlightHistory: firstFlightHistory?.[todayStr] || null,
        currentAirport,
        nightStay: nightStayName,
        isNightStayConfirmed,
        pendingNightStayNote,
        todayOutlook: pendingNightStayNote,
        nightStayProbabilities,
        plans: todayPlans.length > 0 ? todayPlans : lastNightPlans,
        todayPlanHeaders,
        todayComparison,
        flights: combinedTodayFlights
      });
    } else if (day.dayIndex === 1) {
      // Day 1: 明日
      const topTomorrow = tomorrowPlans[0] || null;
      const firstF = topTomorrow?.flights?.[0] || null;
      const tomorrowFlights = (topTomorrow?.flights || []).map((f, idx) => ({
        flightNo: f.flightNo,
        route: f.route,
        time: f.time,
        confidence: `${topTomorrow.probability}%`,
        reason: idx === 0 ? `今夜の最有力駐機先(${shortAirportName(topTomorrow.startAirportCode)})からの朝一始発便` : `マルコフ遷移・ODPTダイヤ連動便`
      }));

      weeklySchedule.push({
        ...day,
        statusType: 'tomorrow',
        firstFlightCandidates: tomorrowFirstFlights,
        statusLabel: isNightStayConfirmed
          ? '明日（ナイトステイ確定・マルコフ連鎖予測）'
          : '明日（今夜の宿泊地確率に連動した3大シナリオ予測）',
        expectedStart: firstF
          ? `${shortAirportName(topTomorrow.startAirportCode)}発 (${firstF.flightNo})`
          : '今夜の最終便（19〜21時頃）で確定',
        isNightStayConfirmed,
        pendingNightStayNote,
        isRegionalNightStay: isNightStayConfirmed && nightStayCode !== 'HND',
        confirmedFirstFlight: (isNightStayConfirmed && nightStayCode !== 'HND' && firstF) ? {
          flightNo: firstF.flightNo,
          route: firstF.route,
          time: firstF.time,
          confidence: `${topTomorrow.probability}%`,
          reason: `${AIRPORT_NAMES[nightStayCode] || nightStayCode}ナイトステイ機材の朝一復帰便`
        } : null,
        plans: tomorrowPlans,
        flights: tomorrowFlights
      });
    } else {
      // Day 2 〜 Day 6: 前日のプラン群から算出した宿泊地周辺確率分布 runningPriors を入力として同じビームサーチで完全連鎖
      const dKey = day.dateStr.replace(/-/g, '');
      const dayScheduleFlights = Object.values(anaFleetData?.dates?.[dKey] || {});

      const prevPlanForDay = (day.dayIndex === 2) ? tomorrowPlans[0] : weeklySchedule[weeklySchedule.length - 1]?.plans?.[0];
      const prevVisitedDests = prevPlanForDay
        ? new Set(prevPlanForDay.flights.map(f => f.dest).filter(Boolean))
        : null;

      const prevPlanLastFlight = prevPlanForDay?.flights?.[prevPlanForDay.flights.length - 1];
      const rollingArrivalFlight = prevPlanLastFlight ? {
        orig: prevPlanLastFlight.orig || prevPlanLastFlight.origin,
        dest: prevPlanLastFlight.dest || prevPlanLastFlight.destination,
        flightNo: prevPlanLastFlight.flightNo
      } : null;

      const dayPlans = generateDayPlansViaBeamSearch(
        runningPriors,
        day.dateStr,
        anaFleetData,
        learnedModel,
        prevDayFirstFn,
        prevVisitedDests,
        rollingArrivalFlight,
        {
          arrivalByAirport: runningArrivalByAirport,
          regionalStayStreak: runningRegionalStreak,
          prevStartAirport: prevPlanForDay?.startAirportCode || prevPlanForDay?.flights?.[0]?.orig || null
        }
      );

      if (dayPlans.length > 0) {
        runningPriors = computeNextDayStayPriorsFromPlans(dayPlans);
        runningArrivalByAirport = dayPlans._arrivalByAirport || {};
        prevDayFirstFn = dayPlans[0]?.flights?.[0]?.flightNo || null;
        runningRegionalStreak = (dayPlans[0]?.stayCode && dayPlans[0].stayCode !== 'HND')
          ? (runningRegionalStreak + 1)
          : 0;
      }

      const top5Routes = buildDynamicRouteSummaryForDay(dayPlans, dayScheduleFlights, learnedModel, day.isWeekend);
      const topPlan = dayPlans[0] || null;

      weeklySchedule.push({
        ...day,
        statusType: 'forecast',
        statusLabel: '週間ルート＆タイムテーブル予測（前日宿泊地確率連鎖・ビームサーチ）',
        topRoute: topPlan ? (topPlan.title || topPlan.routeSummary) : (top5Routes[0]?.route || ''),
        topProbability: topPlan ? topPlan.probability : (top5Routes[0]?.probability || 35),
        routes: top5Routes,
        plans: dayPlans,
        flights: topPlan?.flights || []
      });
    }
  }

  // 9. 動的計算による空港遭遇確率レーダー ＆ 週間予測(D+1〜D+6)リードタイム別アーカイブ更新・自動検証
  const airportRadar = buildDynamicAirportRadar(learnedModel);
  const weeklyArchiveRecords = updateWeeklyPredictionsArchive(
    WEEKLY_ARCHIVE_FILE,
    todayStr,
    weeklySchedule,
    isNightStayConfirmed
  );
  const weeklyArchiveAccuracy = evaluateWeeklyArchiveAccuracy(
    weeklyArchiveRecords,
    actualByDate,
    todayStr
  );

  // 重要スナップショット・履歴ファイルの日次バックアップ（非公開ディレクトリ・14日ローテーション）
  backupFileDaily(SNAPSHOT_FILE, PREDICTION_BACKUP_DIR, todayStr, 14);
  backupFileDaily(FIRST_FLIGHT_HISTORY_FILE, PREDICTION_BACKUP_DIR, todayStr, 14);
  backupFileDaily(WEEKLY_ARCHIVE_FILE, PREDICTION_BACKUP_DIR, todayStr, 14);

  const resultData = {
    updatedAt: nowJa,
    updatedAtIso: new Date().toISOString(),
    aircraft: {
      model: 'ボーイング 767-300ER',
      reg: 'JA609A',
      nickname: 'ANA ちいかわジェット',
      currentLocation: currentAirport,
      currentLocationCode: currentAirportCode,
      currentSpot: remainderPred.currentSpot || null,
      spotConfidenceNote: remainderPred.spotConfidenceNote || null,
      isAirborne,
      nightStay: nightStayName,
      nightStayCode,
      isNightStayConfirmed,
      nightStayProbabilities
    },
    accuracyStats,
    weeklyArchiveAccuracy,
    maintenanceProfile,
    firstFlightStats,
    pairedFirstFlightStats,
    overnightTrialStats,
    pastPredictions,
    weeklySchedule,
    airportRadar,
    dbStats: {
      totalFleetFlights: learnedModel.totalFlights,
      fleetCount: learnedModel.activeFleetCount
    }
  };

  if (!fs.existsSync(SRC_DATA_DIR)) fs.mkdirSync(SRC_DATA_DIR, { recursive: true });
  const serializedResult = JSON.stringify(resultData, null, 2);
  atomicWriteFileSync(OUTPUT_JSON_FILE, serializedResult, 'utf-8');
  atomicWriteFileSync(SRC_OUTPUT_JSON_FILE, serializedResult, 'utf-8');
  console.log(`💾 週間予測JSONデータを原子保存しました: ${OUTPUT_JSON_FILE}`);
  console.log(`💾 src/dataにも原子保存しました: ${SRC_OUTPUT_JSON_FILE}`);
  console.log(`📦 週間アーカイブ(D+1〜D+6)累計: ${weeklyArchiveAccuracy.totalArchivedRecords} 件（検証済: ${weeklyArchiveAccuracy.totalEvaluatedRecords} 件）`);
  return resultData;
}

if (process.argv[1] && process.argv[1].endsWith('weekly_chiikawa_predictor.mjs')) {
  generateWeeklyPrediction().catch(e => console.error(e));
}
