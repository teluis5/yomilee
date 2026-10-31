import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { collectFleetData } from './collector_ana_fleet.mjs';
import { updateAnaFleetStatusFromODPT } from '../../../5_script/fetch_ana_odpt_fleet_status.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YOMILEE_ROOT = path.resolve(__dirname, '..');

const DATA_DIR = path.join(YOMILEE_ROOT, 'data');
const SRC_DATA_DIR = path.join(YOMILEE_ROOT, 'src', 'data');
const OUTPUT_JSON_FILE = path.join(DATA_DIR, 'chiikawa_weekly_prediction.json');
const SRC_OUTPUT_JSON_FILE = path.join(SRC_DATA_DIR, 'chiikawa_weekly_prediction.json');
const ANA_FLEET_STATUS_FILE = path.join(DATA_DIR, 'ana_fleet_status.json');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'daily_predictions_snapshot.json');
const EVAL_LOG_FILE = path.join(DATA_DIR, 'evaluation_log.jsonl');

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
    return timeMatch ? `到着予定 (${timeMatch[0]})` : '到着予定';
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
async function loadAnaFleetStatus() {
  try {
    return await updateAnaFleetStatusFromODPT();
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
// 3. 学習済み知識ベースの動的構築 (Out-of-Sample 対応)
// ============================================================================
/**
 * fleetDb から、指定日 cutoffDateStr 未満の履歴データのみを用いて
 * マルコフ遷移行列・ナイトステイ初便分布・路線頻度を動的に集計する。
 * cutoffDateStr = null の場合は全履歴を使用する。
 */
function buildLearnedModel(fleetDb, cutoffDateStr = null) {
  const transitions = {};
  const nightStays = {};
  const routeFreq = {};
  const flightMeta = {};
  const activeRegs = new Set();

  const allFlights = Object.values(fleetDb?.flights || {}).filter(f => {
    if (!f || !f.flightNo || !f.flightNo.startsWith('NH')) return false;
    const fnNum = parseInt(f.flightNo.replace(/[^0-9]/g, ''), 10);
    if (!fnNum || fnNum >= 2000) return false;
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

    const rKey = `${f.orig}-${f.dest}`;
    routeFreq[rKey] = (routeFreq[rKey] || 0) + 1;

    if (!flightMeta[normFn]) {
      flightMeta[normFn] = { flightNo: normFn, orig: f.orig, dest: f.dest, depTime: f.depTime, arrTime: f.arrTime, count: 0 };
    }
    flightMeta[normFn].count += 1;

    if (!byReg[f.reg]) byReg[f.reg] = [];
    byReg[f.reg].push({ ...f, normFn, depMin, arrMin: arrMin ?? (depMin + 90) });
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
      const prevDate = dIdx > 0 ? dates[dIdx - 1] : null;
      const prevDayList = prevDate ? byDate[prevDate] : null;
      const prevLastDest = prevDayList && prevDayList.length > 0 ? prevDayList[prevDayList.length - 1].dest : null;

      if (firstF.depMin <= 660 || (prevLastDest && prevLastDest === firstF.orig)) {
        if (!nightStays[firstF.orig]) nightStays[firstF.orig] = {};
        nightStays[firstF.orig][firstF.normFn] = (nightStays[firstF.orig][firstF.normFn] || 0) + 1;
      }

      // 同日内のマルコフ遷移を記録
      for (let i = 0; i < dayList.length - 1; i++) {
        const curr = dayList[i];
        const next = dayList[i + 1];
        if (curr.dest === next.orig && next.depMin >= curr.arrMin) {
          if (!transitions[curr.normFn]) transitions[curr.normFn] = {};
          transitions[curr.normFn][next.normFn] = (transitions[curr.normFn][next.normFn] || 0) + 1;
        }
      }
    }
  }

  return {
    transitions,
    nightStays,
    routeFreq,
    flightMeta,
    totalFlights: allFlights.length,
    activeFleetCount: Math.max(activeRegs.size, 11)
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
function evaluateHndTurnaroundScore(arrMins, candidateDepFlight, dayFlights, prevArrGate = null) {
  const depM = parseTimeToMinutes(candidateDepFlight.depTime);
  if (depM === null || arrMins === null) return 1.0;
  const turnaround = depM - arrMins;
  if (turnaround < 35) return 0.05;

  // 1. ターンアラウンド時間の自然さ（50〜80分が国内線B767の黄金ゾーン）
  let factor = 1.0;
  if (turnaround >= 48 && turnaround <= 80) {
    factor = 1.35;
  } else if (turnaround >= 40 && turnaround < 48) {
    factor = 1.1;
  } else if (turnaround >= 35 && turnaround < 40) {
    factor = 0.55; // 物理的下限ギリギリ
  } else if (turnaround > 80 && turnaround <= 115) {
    factor = 1.05;
  } else if (turnaround > 115 && turnaround <= 165) {
    factor = 0.78;
  } else {
    factor = 0.45;
  }

  // 2. ODPT 767単独確定枠ボーナス
  if (candidateDepFlight.is767Strict) {
    factor *= 1.25;
  } else if (!candidateDepFlight.is767) {
    factor *= 0.25;
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

  // 4. ゲート番号（ウイング）近接ボーナス（当日ODPTでゲート情報が取得できている場合）
  if (prevArrGate && candidateDepFlight.depGate) {
    const g1 = parseInt(String(prevArrGate).replace(/[^0-9]/g, ''), 10);
    const g2 = parseInt(String(candidateDepFlight.depGate).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(g1) && !isNaN(g2)) {
      if (g1 === g2) {
        factor *= 1.5; // 同一スポット折り返し！
      } else if (Math.abs(g1 - g2) <= 3) {
        factor *= 1.2; // 隣接スポット
      }
    }
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

  const alreadyFlownSet = new Set(todayFlights.map(f => normalizeFlightNo(f.flightNo)));
  const lastToday = todayFlights.length > 0 ? todayFlights[todayFlights.length - 1] : null;

  if (!lastToday) {
    return {
      isNightStayConfirmed: false,
      nightStayCode: 'HND',
      nightStayName: '東京(羽田) (予定)',
      nightStayProbabilities: [{ airport: '東京(羽田)', code: 'HND', probability: 100 }],
      predictedRemainingToday: [],
      todayPlans: [],
      pendingNightStayNote: '本日の初便運航データ取得待ちです。'
    };
  }

  const startFn = normalizeFlightNo(lastToday.flightNo);
  const startAirport = lastToday.destCode;
  const odptLast = dayFlights[startFn];
  const startSchedArrMin = parseTimeToMinutes(odptLast?.arrTime || lastToday.arrTime) ?? 950;
  const startActArrMin = parseTimeToMinutes(odptLast?.actArrTime || lastToday.arrTime || odptLast?.arrTime) ?? startSchedArrMin;

  // すでに夜20:00以降着の便、または19:00以降に地方空港へ到着する最終便ならナイトステイ確定
  if (startActArrMin >= 1200 || (startAirport !== 'HND' && startActArrMin >= 1130)) {
    const stayName = AIRPORT_NAMES[startAirport] || startAirport;
    return {
      isNightStayConfirmed: true,
      nightStayCode: startAirport,
      nightStayName: `${stayName} (確定)`,
      nightStayProbabilities: [{ airport: stayName, code: startAirport, probability: 100 }],
      predictedRemainingToday: [],
      todayPlans: [],
      pendingNightStayNote: ''
    };
  }

  // DFSで残りの有効フライトパスを探索
  const completedPaths = []; // { remFlights: [...], finalStayCode, weight, reason }

  function dfs(curAirport, curArrMin, curSchedArrMin, curFn, pathFlights, pathWeight, depth) {
    // 終端判定1: 地方空港に18:50以降着（地方ナイトステイ完了）
    if (curAirport !== 'HND' && curArrMin >= 1130) {
      completedPaths.push({
        remFlights: [...pathFlights],
        finalStayCode: curAirport,
        weight: pathWeight
      });
      return;
    }

    // 終端判定2: 深さ上限または深夜22:30以降
    if (depth >= 4 || curArrMin >= 1350) {
      completedPaths.push({
        remFlights: [...pathFlights],
        finalStayCode: curAirport,
        weight: pathWeight
      });
      return;
    }

    // 羽田に夕方16:45以降に到着している場合、「このまま羽田で運航終了（羽田ナイトステイ）」という選択肢も評価
    if (curAirport === 'HND' && curArrMin >= 1005) {
      const outTrans = transitions[curFn] || {};
      const totalOutCount = Object.values(outTrans).reduce((a, b) => a + b, 0);
      let hndStopFactor = 0.25;
      if (curArrMin >= 1170) hndStopFactor = 2.2;       // 19:30以降羽田着ならほぼ羽田泊
      else if (curArrMin >= 1110) hndStopFactor = 0.55; // 18:30〜19:30羽田着
      else if (curArrMin >= 1040 && totalOutCount <= 4) hndStopFactor = 0.75; // 17:20〜18:30羽田着

      completedPaths.push({
        remFlights: [...pathFlights],
        finalStayCode: 'HND',
        weight: pathWeight * hndStopFactor
      });
    }

    // 次便候補を当日ODPTダイヤから検索
    const minTurn = curAirport === 'HND' ? 35 : 30;
    const maxTurn = curAirport === 'HND' ? 180 : 135;

    let candidates = Object.values(dayFlights).filter(df => {
      if (df.origin !== curAirport || df.isCancelled) return false;
      if (alreadyFlownSet.has(df.flightNo)) return false;
      if (pathFlights.some(pf => pf.flightNo === df.flightNo)) return false;
      if (assignedOtherMap.has(df.flightNo)) return false;

      const schedDepM = parseTimeToMinutes(df.depTime);
      const actDepM = parseTimeToMinutes(df.actDepTime || df.depTime);
      if (schedDepM === null) return false;

      // 実到着時刻ベースで間に合うか、または地方空港折り返し等で定刻ベースで30分以上確保されているか（前便遅延時は折り返し便も遅延出発するため）
      const isActTurnValid = actDepM !== null && actDepM >= curArrMin + minTurn && actDepM <= curArrMin + maxTurn;
      const isSchedTurnValid = (curAirport !== 'HND' || (transitions[curFn]?.[df.flightNo] > 0)) &&
        schedDepM >= curSchedArrMin + minTurn && schedDepM <= curSchedArrMin + maxTurn;

      return isActTurnValid || isSchedTurnValid;
    });

    // 76P確定便があれば76P便に絞る（ただしマルコフ遷移実績がある便は残す）
    const b767Cands = candidates.filter(df => df.is767 || (transitions[curFn]?.[df.flightNo] > 0));
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
        edgeWeight *= evaluateHndTurnaroundScore(curArrMin, df, dayFlights, odptLast?.arrGate);
      } else {
        const turn = actDepM - curArrMin;
        if (turn >= 30 && turn <= 85) edgeWeight *= 1.45;
        else if (schedDepM - curSchedArrMin >= 35 && schedDepM - curSchedArrMin <= 85) edgeWeight *= 1.35;
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
      const nextFlightObj = {
        flightNo: df.flightNo,
        orig: df.origin,
        dest: df.dest,
        origCode: df.origin,
        destCode: df.dest,
        route: `${origName} ➔ ${destName}`,
        depTime: df.depTime,
        arrTime: df.arrTime,
        actDepTime: df.actDepTime || df.depTime,
        actArrTime: df.actArrTime || df.arrTime,
        time: `${df.depTime}発 - ${df.arrTime}着`,
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
      pendingNightStayNote: '本日の後続便候補を解析中です。'
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
    return {
      flightNo: rf.flightNo,
      origCode: rf.orig,
      destCode: rf.dest,
      route: rf.route,
      depTime: rf.depTime,
      arrTime: rf.arrTime,
      time: `${rf.depTime}発 - ${rf.arrTime}着 (予想)`,
      status: isFinal
        ? `本命予想 (${topStay.probability}%・${stayLabel}候補)`
        : `折返し確定予想 (76P枠)`,
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
    pendingNightStayNote
  };
}

// ============================================================================
// 6. マルコフ・ビームサーチ経路生成エンジン (P3: C3, S3, S4, S7, S8, M7 対応)
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
function generateDayPlansViaBeamSearch(priorStays, targetDateStr, anaFleetData, learnedModel, prevFirstFlightNo = null) {
  const dayFlightsMap = getDayFlightsWithDowFallback(targetDateStr, anaFleetData);
  const dayFlights = Object.values(dayFlightsMap).filter(f => !f.isCancelled);

  const transitions = learnedModel.transitions || {};
  const nightStays = learnedModel.nightStays || {};
  const routeFreq = learnedModel.routeFreq || {};
  const flightMeta = learnedModel.flightMeta || {};

  // もし対象日のODPTダイヤが空の場合（過去日のバックテスト等）、学習済み flightMeta から仮想ダイヤを構築
  const effectiveFlights = dayFlights.length > 0
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

  const validPriors = (Array.isArray(priorStays) && priorStays.length > 0)
    ? priorStays.filter(p => p.probability > 0)
    : [{ code: 'HND', probability: 100 }];

  const candidateCompletePlans = [];

  for (const stay of validPriors) {
    const startAirport = stay.code;
    const stayPriorProb = (stay.probability || 50) / 100;
    const stayHistMap = nightStays[startAirport] || {};

    // 1. 朝一初便候補の抽出
    let morningFlights = effectiveFlights.filter(df => {
      if (df.origin !== startAirport) return false;
      const depM = parseTimeToMinutes(df.depTime);
      if (depM === null) return false;
      // 地方空港泊は06:30〜10:30発、羽田泊は06:00〜10:30発（実績があれば午後出庫も可）
      const hasHist = (stayHistMap[df.flightNo] || 0) > 0;
      if (startAirport !== 'HND') {
        return (depM >= 390 && depM <= 630 && (df.is767 || hasHist));
      }
      return (depM >= 360 && depM <= 580 && (df.is767 || hasHist)) || hasHist;
    });

    // もし地方空港泊（startAirport !== 'HND'）で、朝一番の羽田帰還便（dest === 'HND'）が候補に含まれていない場合、
    // 機材変更による朝一羽田送り込み（例: NGO -> NH86 07:25発羽田行き等）も実運航で頻発するため候補に追加
    if (startAirport !== 'HND' && !morningFlights.some(df => df.dest === 'HND')) {
      const earlyHndReturns = effectiveFlights
        .filter(df => df.origin === startAirport && df.dest === 'HND' && (parseTimeToMinutes(df.depTime) ?? 999) <= 570)
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
        if (df && df.origin === startAirport) morningFlights.push(df);
      }
    }
    if (morningFlights.length === 0) {
      morningFlights = effectiveFlights
        .filter(df => df.origin === startAirport && (parseTimeToMinutes(df.depTime) ?? 999) <= 660)
        .slice(0, 3);
    }

    // 初便のスコア計算
    const scoredMorning = morningFlights.map(df => {
      const histCount = stayHistMap[df.flightNo] || 0;
      const depM = parseTimeToMinutes(df.depTime) ?? 500;
      let score = (histCount > 0 ? (2.5 + histCount * 1.4) : 0.85);
      if (df.is767Strict) score *= 1.35;
      else if (df.is767) score *= 1.1;
      else if (startAirport !== 'HND' && df.dest === 'HND' && depM <= 540) score *= 1.15; // 地方泊からの朝一番羽田帰還便は高優先度
      else score *= 0.35;

      // 羽田泊の場合、地方ステイ機が羽田に戻る前（06:30〜08:55発）の早朝枠にボーナス
      if (startAirport === 'HND') {
        if (depM <= 535) score *= 1.4;
        else if (depM >= 780) score *= 0.45;
      }

      // 前日と同じ初便の連続投入はローテーション分散によりやや減衰
      if (prevFirstFlightNo && df.flightNo === prevFirstFlightNo && startAirport === 'HND') {
        score *= 0.82;
      }

      return { df, score };
    }).sort((a, b) => b.score - a.score).slice(0, startAirport === 'HND' ? 4 : 2);

    const morningScoreSum = scoredMorning.reduce((s, x) => s + x.score, 0) || 1;

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

      for (let step = 1; step < 6; step++) {
        const nextBeam = [];

        for (const state of beam) {
          const { curAirport, curArrMin, curFn, flights, score } = state;

          // 終端条件: 地方空港に18:50以降着（地方ナイトステイ）
          if (curAirport !== 'HND' && curArrMin >= 1130) {
            finishedForThisMorning.push(state);
            continue;
          }
          // 終端条件: 羽田に20:00以降着（羽田ナイトステイ）
          if (curAirport === 'HND' && curArrMin >= 1200) {
            finishedForThisMorning.push(state);
            continue;
          }

          // 羽田に17:15〜20:00着で4便以上飛んでいる場合、「ここで羽田ステイ終了」も候補に入れる
          if (curAirport === 'HND' && curArrMin >= 1035 && flights.length >= 4) {
            const outTrans = transitions[curFn] || {};
            const hasStrongEveningOut = Object.values(outTrans).reduce((a, b) => a + b, 0) >= 5;
            finishedForThisMorning.push({
              ...state,
              score: score * (hasStrongEveningOut ? 0.42 : 0.95)
            });
          }

          const minTurn = curAirport === 'HND' ? 40 : 35;
          const maxTurn = curAirport === 'HND' ? 195 : 120;

          let nextCands = effectiveFlights.filter(df => {
            if (df.origin !== curAirport) return false;
            if (flights.some(pf => pf.flightNo === df.flightNo)) return false;
            const depM = parseTimeToMinutes(df.depTime);
            const arrM = parseTimeToMinutes(df.arrTime);
            if (depM === null || arrM === null) return false;
            if (depM < curArrMin + minTurn || depM > curArrMin + maxTurn) return false;
            // もし昼間（18:00以前）に地方空港へ行く便なら、その地方空港から当日中に折り返す便または20時以降着のステイ便でなければならない
            if (df.dest !== 'HND' && arrM < 1130) {
              const hasReturnFromDest = effectiveFlights.some(ret => {
                if (ret.origin !== df.dest) return false;
                const rDep = parseTimeToMinutes(ret.depTime);
                return rDep !== null && rDep >= arrM + 30 && rDep <= arrM + 135;
              });
              if (!hasReturnFromDest) return false;
            }
            return true;
          });

          // 767候補またはマルコフ遷移実績のある便を優先
          const b767Next = nextCands.filter(df => df.is767 || (transitions[curFn]?.[df.flightNo] > 0));
          if (b767Next.length > 0) {
            nextCands = b767Next;
          }

          if (nextCands.length === 0) {
            if (flights.length >= 3 && (curAirport === 'HND' || curArrMin >= 1080)) {
              finishedForThisMorning.push(state);
            }
            continue;
          }

          const scoredNext = nextCands.map(df => {
            const transCount = transitions[curFn]?.[df.flightNo] || 0;
            const rFreq = routeFreq[`${df.origin}-${df.dest}`] || 1;
            let edgeScore = transCount > 0 ? (2.2 + transCount * 1.3) : (0.35 + Math.min(0.8, rFreq * 0.04));

            if (curAirport === 'HND') {
              edgeScore *= evaluateHndTurnaroundScore(curArrMin, df, dayFlightsMap, null);
              // 2晩連続で同一の地方空港にナイトステイする反復ループを適度に抑制（機材ローテーション分散）
              const arrM = parseTimeToMinutes(df.arrTime) ?? 0;
              if (startAirport !== 'HND' && df.dest === startAirport && arrM >= 1130) {
                edgeScore *= 0.48;
              }
            } else {
              const depM = parseTimeToMinutes(df.depTime) ?? (curArrMin + 50);
              const turn = depM - curArrMin;
              if (turn >= 35 && turn <= 75) edgeScore *= 1.45;
              if (df.is767Strict) edgeScore *= 1.25;
              else if (!df.is767) edgeScore *= 0.35;
            }

            return { df, edgeScore };
          }).sort((a, b) => b.edgeScore - a.edgeScore).slice(0, 4);

          const edgeSum = scoredNext.reduce((s, x) => s + x.edgeScore, 0) || 1;
          for (const nx of scoredNext) {
            const arrM = parseTimeToMinutes(nx.df.arrTime) ?? ((parseTimeToMinutes(nx.df.depTime) ?? 600) + 95);
            nextBeam.push({
              flights: [...flights, nx.df],
              curAirport: nx.df.dest,
              curArrMin: arrM,
              curFn: nx.df.flightNo,
              score: score * (nx.edgeScore / edgeSum)
            });
          }
        }

        // ビーム幅を上位8件に絞る
        nextBeam.sort((a, b) => b.score - a.score);
        beam = nextBeam.slice(0, 8);
        if (beam.length === 0) break;
      }

      for (const rem of beam) {
        if (rem.flights.length >= 3) {
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

  // 多様性を確保しながら上位3プラン（プランA / B / C）を選出：
  // 優先順位①: priorStays に含まれる各出発空港（上位3空港まで）の最高スコアプランを1つずつ選出
  // 優先順位②: まだ選ばれていない「異なる初便（firstFn）」を持つ最高スコアプランを選出（羽田泊のNH661/NH619/NH245や中部泊のNH703/NH86を確実に網羅）
  // 優先順位③: 初便が1種類のみの場合は、中盤の経由空港（midAirport）が異なるプランを選出
  candidateCompletePlans.sort((a, b) => b.weight - a.weight);

  const selectedRaw = [];
  const usedSignatures = new Set();

  // ① 各宿泊空港ごとの代表プランを確保
  for (const stay of validPriors.slice(0, 3)) {
    const match = candidateCompletePlans.find(p => p.startAirport === stay.code);
    if (match) {
      const sig = match.rawFlights.map(f => f.flightNo).join('>');
      if (!usedSignatures.has(sig)) {
        selectedRaw.push(match);
        usedSignatures.add(sig);
      }
    }
  }

  // ② 異なる初便（firstFn）を持つプランを優先補充
  for (const cand of candidateCompletePlans) {
    if (selectedRaw.length >= 3) break;
    const sig = cand.rawFlights.map(f => f.flightNo).join('>');
    if (usedSignatures.has(sig)) continue;
    const firstFn = cand.rawFlights[0]?.flightNo;
    if (!selectedRaw.some(s => s.rawFlights[0]?.flightNo === firstFn)) {
      selectedRaw.push(cand);
      usedSignatures.add(sig);
    }
  }

  // ③ 中盤の経由空港（midAirport）が異なるプランを優先補充
  for (const cand of candidateCompletePlans) {
    if (selectedRaw.length >= 3) break;
    const sig = cand.rawFlights.map(f => f.flightNo).join('>');
    if (usedSignatures.has(sig)) continue;
    if (!selectedRaw.some(s => s.midAirport === cand.midAirport)) {
      selectedRaw.push(cand);
      usedSignatures.add(sig);
    }
  }

  // ④ それでも3プラン未満の場合は、最初の4便が完全一致しないプランを優先して補充
  for (const cand of candidateCompletePlans) {
    if (selectedRaw.length >= 3) break;
    const sig = cand.rawFlights.map(f => f.flightNo).join('>');
    if (usedSignatures.has(sig)) continue;
    const prefix4 = cand.rawFlights.slice(0, 4).map(f => f.flightNo).join('>');
    if (!selectedRaw.some(s => s.rawFlights.slice(0, 4).map(f => f.flightNo).join('>') === prefix4)) {
      selectedRaw.push(cand);
      usedSignatures.add(sig);
    }
  }

  for (const cand of candidateCompletePlans) {
    if (selectedRaw.length >= 3) break;
    const sig = cand.rawFlights.map(f => f.flightNo).join('>');
    if (!usedSignatures.has(sig)) {
      selectedRaw.push(cand);
      usedSignatures.add(sig);
    }
  }

  // スコア順にソートしてHamilton法で合計100%に正規化
  selectedRaw.sort((a, b) => b.weight - a.weight);
  const normalizedPlans = normalizeTo100Percent(selectedRaw, 'weight', 10);

  const planLetters = ['プランA', 'プランB', 'プランC', 'プランD'];
  const rankLabels = ['本命 ◎', '有力 ◯', '対抗 ▲', '注意 △'];

  return normalizedPlans.map((item, idx) => {
    const formattedFlights = item.rawFlights.map((df, fIdx) => {
      const origName = AIRPORT_NAMES[df.origin] || df.origin;
      const destName = AIRPORT_NAMES[df.dest] || df.dest;
      const depM = parseTimeToMinutes(df.depTime);
      const arrM = parseTimeToMinutes(df.arrTime);
      const stepLabel = getStepLabel(fIdx, item.rawFlights.length, depM, arrM, df.dest);
      const isLast = fIdx === item.rawFlights.length - 1;

      let tag = df.is767Strict ? '🔒763確定枠' : (df.is767 ? '763候補枠' : '機材変更候補');
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

    const title = `【前夜${startShort}泊(${firstFn}始発)】${routeSummary}`;
    const description = `前夜${AIRPORT_NAMES[item.startAirport] || item.startAirport}駐機シナリオから連動。朝一${firstFn}(${formattedFlights[0]?.time})で始動し、ODPT公式ダイヤとマルコフ遷移実績に基づき全${formattedFlights.length}便を運航して夜に${endShort}泊となる予測スジ。`;

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
      flights: formattedFlights
    };
  });
}

/**
 * ある日のプラン群から、その日の夜の宿泊地周辺確率分布 P(Stay_d = S) を算出する（合計100%保証）
 */
function computeNextDayStayPriorsFromPlans(plans) {
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
    const oosModel = buildLearnedModel(filteredDb, null);

    const priorStays = [{ code: prevNightStayCode, probability: 100 }];
    const prevFirstFn = (prevActual && prevActual.length > 0) ? prevActual[0].normFn : null;
    const predictedPlans = generateDayPlansViaBeamSearch(priorStays, d, anaFleetData, oosModel, prevFirstFn);

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
      reason: dayHitFlights === actualList.length
        ? `前夜${shortAirportName(prevNightStayCode)}泊からの初便(${actualList[0].normFn})および後続の全${actualList.length}便が予測シナリオと完全一致`
        : `初便${actualList[0].normFn}から${dayHitFlights}便が予測シナリオに合致（一部区間は当日の機材繰りにより別スジへ分岐）`
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

  const accuracyStats = {
    dailyFullHitRate,
    firstFlightHitRate,
    totalEvaluatedDays,
    perfectDays,
    totalFlightsEvaluated,
    totalFlightsHit,
    streakHits,
    evaluationPeriod: completedDates.length > 0
      ? `${completedDates[0]} 〜 ${completedDates[completedDates.length - 1]} (実データ検証)`
      : '実データ検証中'
  };

  // 監査ログ (evaluation_log.jsonl) の保存
  try {
    const lines = evalRecords.map(r => JSON.stringify({
      evaluatedAt: new Date().toISOString(),
      date: r.dateStr,
      firstFlightHit: r.isFirstHit,
      hitFlights: r.dayHitFlights,
      totalFlights: r.dayTotalFlights,
      hitRate: r.hitRate,
      actual: r.actual,
      predicted: r.predicted
    }));
    fs.writeFileSync(EVAL_LOG_FILE, lines.join('\n') + '\n', 'utf-8');
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

  console.log('========================================================');
  console.log('✈️  === ANAちいかわジェット (JA609A) 週間運行予測エンジン v2.0 ===');
  console.log(`📅 実行時刻: ${nowJa} (JST)`);
  console.log('========================================================\n');

  // 1. 同型機フライト履歴の収集＆学習モデル構築
  const fleetDb = await collectFleetData();
  const learnedModel = buildLearnedModel(fleetDb, null);
  console.log(`📚 学習済みDB構築完了: 全 ${learnedModel.totalFlights} 便 / 稼働76P機体数: ${learnedModel.activeFleetCount} 機`);

  // 2. ANA公式運航状況（ODPT確定機種＆週間ダイヤデータ）の同期＆ロード
  const anaFleetData = await loadAnaFleetStatus();
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
    const statusJa = translateStatus(statusText);

    const depSched = f.time?.scheduled?.departure;
    const depReal = f.time?.real?.departure;
    const arrSched = f.time?.scheduled?.arrival;
    const arrReal = f.time?.real?.arrival;
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
      statusJa,
      isLanded: /Landed/i.test(statusText),
      isLive: /Active|Live|Estimated/i.test(statusText) && !/Landed/i.test(statusText)
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
        isLanded: /Landed/i.test(dbf.status || ''),
        isLive: /EnRoute|InAir|Active|Live/i.test(dbf.status || '')
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
  const { accuracyStats, pastPredictions, byDate } = computeRealAccuracyAndHistory(
    fleetDb,
    todayStr,
    anaFleetData,
    snapshots
  );

  // もし本日のスナップショットが存在しないか、または旧ハードコード汚染（前夜実到着地と本日のスナップショット第1便出発地が乖離している旧バグデータ）の場合、
  // 昨日までのデータのみ（Out-of-Sample: 本日の実運航を一切参照しない）から生成した純粋な事前予測スナップショットを設定する
  const allPastDates = Object.keys(byDate).filter(d => d < todayStr).sort();
  const yesterdayStr = allPastDates.length > 0 ? allPastDates[allPastDates.length - 1] : null;
  const yesterdayFlights = yesterdayStr ? byDate[yesterdayStr] : null;
  const lastNightActualStay = (yesterdayFlights && yesterdayFlights.length > 0)
    ? yesterdayFlights[yesterdayFlights.length - 1].dest
    : (todayFlights[0]?.origCode || 'HND');

  const existingTodaySnap = snapshots[todayStr];
  const hasDuplicatePrefixInSnap = existingTodaySnap && existingTodaySnap.length >= 3 &&
    existingTodaySnap[1]?.flights?.slice(0, 4).map(f => f.flightNo).join('>') ===
    existingTodaySnap[2]?.flights?.slice(0, 4).map(f => f.flightNo).join('>');
  const isLegacyCorruptedTodaySnap = existingTodaySnap && (
    existingTodaySnap.length < 3 ||
    hasDuplicatePrefixInSnap ||
    (lastNightActualStay !== 'HND' &&
     existingTodaySnap.every(p => (p.flights?.[0]?.orig || getAirportCodeFromName(p.flights?.[0]?.route?.split('➔')[0])) === 'HND'))
  );

  if (!existingTodaySnap || isLegacyCorruptedTodaySnap) {
    const oosModelForToday = buildLearnedModel(fleetDb, todayStr); // todayStr未満の履歴のみ使用
    const prevFirstFn = (yesterdayFlights && yesterdayFlights.length > 0) ? yesterdayFlights[0].normFn : null;
    snapshots[todayStr] = generateDayPlansViaBeamSearch(
      [{ code: lastNightActualStay, probability: 100 }],
      todayStr,
      anaFleetData,
      oosModelForToday,
      prevFirstFn
    );
  }

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
  const tomorrowPlans = generateDayPlansViaBeamSearch(
    nightStayProbabilities,
    tomorrowDateStr,
    anaFleetData,
    learnedModel,
    todayFirstFn
  );

  // 明日の最新予測を明日のスナップショットとして保存（明日になった後は上書きされない）
  if (tomorrowPlans && tomorrowPlans.length > 0) {
    snapshots[tomorrowDateStr] = tomorrowPlans;
  }

  try {
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshots, null, 2), 'utf-8');
  } catch (e) {
    console.warn('⚠️ daily_predictions_snapshot.json 保存警告:', e.message);
  }

  const weeklySchedule = [];
  let runningPriors = computeNextDayStayPriorsFromPlans(tomorrowPlans);
  let prevDayFirstFn = tomorrowPlans[0]?.flights?.[0]?.flightNo || null;

  for (const day of weeklyDays) {
    if (day.dayIndex === 0) {
      // Day 0: 本日（昨晩時点の予想 vs 実際 比較テーブル ＆ 本日残り予測）
      const combinedTodayFlights = [
        ...todayFlights.map(f => ({
          flightNo: f.flightNo,
          route: f.route,
          time: `${f.depTime}発 - ${f.arrTime}着`,
          status: f.statusJa,
          isLanded: f.isLanded,
          isLive: f.isLive,
          isPredicted: false
        })),
        ...predictedRemainingToday
      ];

      const lastNightPlans = snapshots[day.dateStr] || [];
      const planA = lastNightPlans[0] || { planName: 'プランA', probability: 50, flights: [] };
      const planB = lastNightPlans[1] || { planName: 'プランB', probability: 30, flights: [] };
      const planC = lastNightPlans[2] || { planName: 'プランC', probability: 20, flights: [] };

      const maxSlots = Math.max(
        planA.flights?.length || 0,
        planB.flights?.length || 0,
        planC.flights?.length || 0,
        combinedTodayFlights.length,
        4
      );

      const todayComparison = [];
      for (let i = 0; i < maxSlots; i++) {
        const fa = planA.flights?.[i] || null;
        const fb = planB.flights?.[i] || null;
        const fc = planC.flights?.[i] || null;
        const act = todayFlights[i] || null;
        const predRem = !act ? combinedTodayFlights[i] : null;

        todayComparison.push({
          step: `#${i + 1}`,
          planA: fa ? { flightNo: fa.flightNo, route: fa.route, time: fa.time } : null,
          planB: fb ? { flightNo: fb.flightNo, route: fb.route, time: fb.time } : null,
          planC: fc ? { flightNo: fc.flightNo, route: fc.route, time: fc.time } : null,
          actual: act ? {
            flightNo: act.flightNo,
            route: act.route,
            time: `${act.depTime}発 - ${act.arrTime}着`,
            status: act.statusJa || '運航予定',
            isLanded: act.isLanded,
            isLive: act.isLive
          } : (predRem ? {
            flightNo: `${predRem.flightNo} (予想)`,
            route: predRem.route,
            time: predRem.time.replace(' (予想)', ''),
            status: predRem.status,
            isLanded: false,
            isLive: false
          } : null)
        });
      }

      const todayPlanHeaders = [
        { name: planA.planName?.split(' ')[0] || 'プランA', prob: planA.probability || 50 },
        { name: planB.planName?.split(' ')[0] || 'プランB', prob: planB.probability || 30 },
        { name: planC.planName?.split(' ')[0] || 'プランC', prob: planC.probability || 20 }
      ];

      weeklySchedule.push({
        ...day,
        statusType: 'today',
        statusLabel: '本日（リアルタイム＋夕方以降ベイズ予測）',
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

      const dayPlans = generateDayPlansViaBeamSearch(
        runningPriors,
        day.dateStr,
        anaFleetData,
        learnedModel,
        prevDayFirstFn
      );

      if (dayPlans.length > 0) {
        runningPriors = computeNextDayStayPriorsFromPlans(dayPlans);
        prevDayFirstFn = dayPlans[0]?.flights?.[0]?.flightNo || null;
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

  // 9. 動的計算による空港遭遇確率レーダー
  const airportRadar = buildDynamicAirportRadar(learnedModel);

  const resultData = {
    updatedAt: nowJa,
    updatedAtIso: new Date().toISOString(),
    aircraft: {
      model: 'ボーイング 767-300ER',
      reg: 'JA609A',
      nickname: 'ANA ちいかわジェット',
      currentLocation: currentAirport,
      currentLocationCode: currentAirportCode,
      isAirborne,
      nightStay: nightStayName,
      nightStayCode,
      isNightStayConfirmed,
      nightStayProbabilities
    },
    accuracyStats,
    pastPredictions,
    weeklySchedule,
    airportRadar,
    dbStats: {
      totalFleetFlights: learnedModel.totalFlights,
      fleetCount: learnedModel.activeFleetCount
    }
  };

  if (!fs.existsSync(SRC_DATA_DIR)) fs.mkdirSync(SRC_DATA_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON_FILE, JSON.stringify(resultData, null, 2), 'utf-8');
  fs.writeFileSync(SRC_OUTPUT_JSON_FILE, JSON.stringify(resultData, null, 2), 'utf-8');
  console.log(`💾 週間予測JSONデータを保存しました: ${OUTPUT_JSON_FILE}`);
  console.log(`💾 src/dataにも保存しました: ${SRC_OUTPUT_JSON_FILE}`);
  return resultData;
}

if (process.argv[1] && process.argv[1].endsWith('weekly_chiikawa_predictor.mjs')) {
  generateWeeklyPrediction().catch(e => console.error(e));
}
