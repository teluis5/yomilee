import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(__dirname, '../../../');

// 完全非公開のローカルDB（Git管理外・Googleドライブ同期エリア）
const PRIVATE_DB_DIR = path.join(WORKSPACE_ROOT, 'private_data', 'flight_db');
const PRIVATE_SNAPSHOTS_DIR = path.join(PRIVATE_DB_DIR, 'daily_snapshots');
const MASTER_HISTORY_FILE = path.join(PRIVATE_DB_DIR, 'ana_b767_master_history.json');
const MASTER_CSV_FILE = path.join(PRIVATE_DB_DIR, 'ana_b767_flights_archive.csv');

// 各プロジェクト内のキャッシュ（.gitignoreで非公開化）
const LOCAL_DATA_DIR = path.join(PROJECT_ROOT, 'data');
const LOCAL_HISTORY_FILE = path.join(LOCAL_DATA_DIR, 'ana_b767_flight_history.json');

// ANA B767-300ER 国内線仕様主要機材リスト（全15機）
const ANA_B767_FLEET = [
  'JA604A', 'JA605A', 'JA606A', 'JA607A', 'JA608A',
  'JA609A', // ちいかわジェット
  'JA610A', 'JA611A', 'JA612A', 'JA613A', 'JA614A',
  'JA615A', 'JA616A', 'JA617A', 'JA618A'
];

function loadHistory() {
  // 1. 最優先: プライベートマスターDB（非公開ストレージ）からロード
  if (fs.existsSync(MASTER_HISTORY_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(MASTER_HISTORY_FILE, 'utf-8'));
      if (data && data.flights) return data;
    } catch (e) {
      console.warn('⚠️ プライベートDBの読み込みエラー:', e.message);
    }
  }

  // 2. フォールバック: ローカルファイルからロード
  if (fs.existsSync(LOCAL_HISTORY_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LOCAL_HISTORY_FILE, 'utf-8'));
      if (data && data.flights) return data;
    } catch {}
  }

  return { flights: {}, nightStays: {}, rotations: {}, turnarounds: {}, lastUpdated: null };
}

function exportCsv(flightsObj) {
  try {
    const list = Object.values(flightsObj).sort((a, b) => (b.depTs || 0) - (a.depTs || 0));
    const headers = ['flightId', 'reg', 'flightNo', 'origin', 'destination', 'date', 'depTime', 'arrTime', 'depTs', 'arrTs', 'status'];
    const lines = [headers.join(',')];
    for (const f of list) {
      lines.push([
        f.id || '',
        f.reg || '',
        f.flightNo || '',
        f.orig || '',
        f.dest || '',
        f.date || '',
        f.depTime || '',
        f.arrTime || '',
        f.depTs || '',
        f.arrTs || '',
        `"${(f.status || '').replace(/"/g, '""')}"`
      ].join(','));
    }
    fs.writeFileSync(MASTER_CSV_FILE, lines.join('\n'), 'utf-8');
    console.log(`📁 分析用CSVアーカイブを更新しました: ${MASTER_CSV_FILE}`);
  } catch (e) {
    console.warn('⚠️ CSVエクスポート警告:', e.message);
  }
}

function saveHistory(data) {
  // 1. プライベートマスターDB（完全非公開）へ保存
  if (!fs.existsSync(PRIVATE_DB_DIR)) fs.mkdirSync(PRIVATE_DB_DIR, { recursive: true });
  fs.writeFileSync(MASTER_HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`🔒 プライベートマスターDBに永続保存しました: ${MASTER_HISTORY_FILE}`);

  // 2. 日次スナップショット（過去データ永久保証・破損対策）
  const todayStr = toJSTDateStr(Math.floor(Date.now() / 1000));
  if (!fs.existsSync(PRIVATE_SNAPSHOTS_DIR)) fs.mkdirSync(PRIVATE_SNAPSHOTS_DIR, { recursive: true });
  const snapshotFile = path.join(PRIVATE_SNAPSHOTS_DIR, `ana_b767_snapshot_${todayStr}.json`);
  fs.writeFileSync(snapshotFile, JSON.stringify(data, null, 2), 'utf-8');

  // 3. CSV形式でアーカイブ（Excel/データ分析用）
  exportCsv(data.flights);

  // 4. ローカルキャッシュ（プロジェクト内）も同期更新
  if (!fs.existsSync(LOCAL_DATA_DIR)) fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });
  fs.writeFileSync(LOCAL_HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
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
  console.log('✈️  === ANA B767-300ER 機材群 フライトデータ収集＆プライベート蓄積開始 ===');
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

        // 5時間以上空いている場合は「ナイトステイ（夜間駐機）」とみなす
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

  console.log(`✅ 収集・プライベート蓄積完了: 新規フライト ${totalNewFlights} 件 (蓄積総数: ${Object.keys(db.flights).length} 件)`);
  console.log('📊 ナイトステイ別 翌朝初便パターン学習数:', Object.keys(nightStayPatterns).length, '空港');
  return db;
}

// 直接実行時
if (process.argv[1] && process.argv[1].endsWith('collector_ana_fleet.mjs')) {
  collectFleetData().catch(e => console.error(e));
}
