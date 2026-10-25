import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TELUIS_ROOT = path.resolve(__dirname, '..');

// データ保存先ディレクトリ
const DATA_DIR = path.join(TELUIS_ROOT, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'ana_b767_flight_history.json');

// ANA B767-300ER 国内線仕様主要機材リスト
const ANA_B767_FLEET = [
  'JA604A', 'JA605A', 'JA606A', 'JA607A', 'JA608A',
  'JA609A', // ちいかわジェット
  'JA610A', 'JA611A', 'JA612A', 'JA613A', 'JA614A',
  'JA615A', 'JA616A', 'JA617A', 'JA618A'
];

function loadHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch {
      return { flights: {}, nightStays: {}, rotations: {} };
    }
  }
  return { flights: {}, nightStays: {}, rotations: {} };
}

function saveHistory(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// curl.exe で特定の機体のフライトデータを取得
function fetchAircraftFlights(reg, limit = 20) {
  const url = `https://api.flightradar24.com/common/v1/flight/list.json?query=${reg}&fetchBy=reg&page=1&limit=${limit}`;
  try {
    const cmd = `curl.exe -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`;
    const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    const json = JSON.parse(stdout);
    return json.result?.response?.data || [];
  } catch (e) {
    console.warn(`⚠️ ${reg} の取得エラー:`, e.message);
    return [];
  }
}

// JST変換
function toJSTDateStr(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const jst = new Date(d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60 * 1000);
  const yyyy = jst.getFullYear();
  const mm = String(jst.getMonth() + 1).padStart(2, '0');
  const dd = String(jst.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toJSTTimeStr(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const jst = new Date(d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60 * 1000);
  const hh = String(jst.getHours()).padStart(2, '0');
  const min = String(jst.getMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

export async function collectFleetData() {
  console.log('✈️  === ANA B767-300ER 機材群 フライトデータ収集開始 ===');
  const db = loadHistory();
  let totalNewFlights = 0;

  for (const reg of ANA_B767_FLEET) {
    console.log(`📡 ${reg} のデータを取得中...`);
    const rawList = fetchAircraftFlights(reg, 20);

    for (const f of rawList) {
      const flightId = f.identification?.id || `${reg}-${f.time?.scheduled?.departure}`;
      const flightNo = f.identification?.number?.default;
      const orig = f.airport?.origin?.code?.iata;
      const dest = f.airport?.destination?.code?.iata;
      const depTs = f.time?.scheduled?.departure || f.time?.real?.departure;
      const arrTs = f.time?.scheduled?.arrival || f.time?.real?.arrival;
      const status = f.status?.text;

      if (!flightNo || !orig || !dest || !depTs) continue;

      const dateStr = toJSTDateStr(depTs);
      const depTime = toJSTTimeStr(depTs);
      const arrTime = toJSTTimeStr(arrTs);

      if (!db.flights[flightId]) {
        db.flights[flightId] = {
          id: flightId,
          reg,
          flightNo,
          orig,
          dest,
          date: dateStr,
          depTime,
          arrTime,
          depTs,
          arrTs,
          status
        };
        totalNewFlights++;
      }
    }
  }

  // ナイトステイと翌朝初便のパターンの学習
  const allFlights = Object.values(db.flights).sort((a, b) => a.depTs - b.depTs);
  // 機体ごとの時系列
  const byReg = {};
  for (const f of allFlights) {
    if (!byReg[f.reg]) byReg[f.reg] = [];
    byReg[f.reg].push(f);
  }

  // 各ナイトステイ空港からの翌朝初便の出現頻度を集計
  const nightStayPatterns = {}; // { [airport]: { [flightNo]: count } }
  const turnaroundPatterns = {}; // { [route]: { [nextFlightNo]: count } }

  for (const reg in byReg) {
    const list = byReg[reg];
    for (let i = 0; i < list.length - 1; i++) {
      const curr = list[i];
      const next = list[i + 1];

      // 同じ機体で、到着空港と次の出発空港が一致している場合
      if (curr.dest === next.orig) {
        const gapHours = (next.depTs - (curr.arrTs || curr.depTs)) / 3600;

        // 6時間以上空いている場合は「ナイトステイ（夜間駐機）」とみなす
        if (gapHours >= 5 && gapHours <= 20) {
          const stayAirport = curr.dest;
          if (!nightStayPatterns[stayAirport]) nightStayPatterns[stayAirport] = {};
          nightStayPatterns[stayAirport][next.flightNo] = (nightStayPatterns[stayAirport][next.flightNo] || 0) + 1;
        }

        // 3時間以内の場合は「同日ターンアラウンド（折り返し）」とみなす
        if (gapHours >= 0.5 && gapHours <= 3) {
          const key = `${curr.orig}->${curr.dest}`;
          if (!turnaroundPatterns[key]) turnaroundPatterns[key] = {};
          turnaroundPatterns[key][next.flightNo] = (turnaroundPatterns[key][next.flightNo] || 0) + 1;
        }
      }
    }
  }

  db.nightStays = nightStayPatterns;
  db.turnarounds = turnaroundPatterns;
  db.lastUpdated = new Date().toISOString();

  saveHistory(db);

  console.log(`✅ 収集完了: 新規フライト ${totalNewFlights} 件 (蓄積総数: ${Object.keys(db.flights).length} 件)`);
  console.log('📊 ナイトステイ別 翌朝初便パターン学習数:', Object.keys(nightStayPatterns).length, '空港');
  return db;
}

// 直接実行時
if (process.argv[1] && process.argv[1].endsWith('collector_ana_fleet.mjs')) {
  collectFleetData().catch(e => console.error(e));
}
