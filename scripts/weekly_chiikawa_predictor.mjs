import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { collectFleetData } from './collector_ana_fleet.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YOMILEE_ROOT = path.resolve(__dirname, '..');

const DATA_DIR = path.join(YOMILEE_ROOT, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'ana_b767_flight_history.json');
const OUTPUT_JSON_FILE = path.join(DATA_DIR, 'chiikawa_weekly_prediction.json');

// 日本語空港辞書
const AIRPORT_NAMES = {
  HND: '東京(羽田)',
  NRT: '東京(成田)',
  ITM: '大阪(伊丹)',
  KIX: '大阪(関空)',
  NGO: '名古屋(中部)',
  CTS: '札幌(新千歳)',
  FUK: '福岡',
  OKA: '沖縄(那覇)',
  ISG: '石垣',
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
  TOY: '富山'
};

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// ナイトステイ先空港から翌朝最初に出発する標準便マスター
const MORNING_DEPARTURE_STANDARDS = {
  NGS: {
    flightNo: 'NH662',
    orig: 'NGS',
    dest: 'HND',
    depTime: '07:45',
    arrTime: '09:20',
    confidence: '95%',
    reason: '長崎空港ナイトステイ機材の朝一羽田行き（高頻度・定番固定運用）'
  },
  HIJ: {
    flightNo: 'NH672',
    orig: 'HIJ',
    dest: 'HND',
    depTime: '07:30',
    arrTime: '08:50',
    confidence: '95%',
    reason: '広島空港ナイトステイ機材の朝一羽田行き（定番ビジネス路線）'
  },
  MYJ: {
    flightNo: 'NH582',
    orig: 'MYJ',
    dest: 'HND',
    depTime: '07:25',
    arrTime: '08:50',
    confidence: '90%',
    reason: '松山空港ナイトステイ機材の朝一羽田行き始発便'
  },
  FUK: {
    flightNo: 'NH240',
    orig: 'FUK',
    dest: 'HND',
    depTime: '07:00',
    arrTime: '08:35',
    confidence: '85%',
    reason: '福岡空港ナイトステイ機材の朝一羽田行き始発便'
  },
  NGO: {
    flightNo: 'NH703',
    orig: 'NGO',
    dest: 'CTS',
    depTime: '08:40',
    arrTime: '10:25',
    confidence: '85%',
    reason: '中部国際空港ナイトステイ機材の新千歳行き、または羽田送り込み(NH86: 07:25)'
  },
  ITM: {
    flightNo: 'NH14',
    orig: 'ITM',
    dest: 'HND',
    depTime: '07:05',
    arrTime: '08:15',
    confidence: '85%',
    reason: '伊丹空港ナイトステイ機材の羽田行き始発便、または千歳行き(NH771)'
  },
  CTS: {
    flightNo: 'NH50',
    orig: 'CTS',
    dest: 'HND',
    depTime: '07:30',
    arrTime: '09:10',
    confidence: '80%',
    reason: '新千歳空港ナイトステイ機材の羽田行き朝一番便'
  },
  HND: {
    flightNo: 'NH661',
    orig: 'HND',
    dest: 'NGS',
    depTime: '08:15',
    arrTime: '10:10',
    confidence: '75%',
    reason: '羽田ナイトステイ後の九州・四国・中国方面朝一便'
  }
};

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

// Flightradar24 APIからJA609Aのデータを取得
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

// ステータステキストの日本語化
function translateStatus(statusText) {
  if (!statusText) return '運航予定';
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
  if (/Active|Live/i.test(statusText)) return '飛行中 ✈️';
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

export async function generateWeeklyPrediction() {
  const jstNow = getJSTNow();
  const todayStr = formatDate(jstNow);
  const hh = String(jstNow.getHours()).padStart(2, '0');
  const min = String(jstNow.getMinutes()).padStart(2, '0');
  const nowJa = `${jstNow.getFullYear()}年${jstNow.getMonth() + 1}月${jstNow.getDate()}日 ${hh}:${min}`;

  console.log('========================================================');
  console.log('✈️  === ANAちいかわジェット (JA609A) 週間運行予測エンジン ===');
  console.log(`📅 実行時刻: ${nowJa} (JST)`);
  console.log('========================================================\n');

  // 1. 同型機フライト履歴の収集＆学習更新
  const fleetDb = await collectFleetData();
  const totalFlightsCount = Object.keys(fleetDb.flights || {}).length;

  // 2. JA609A の当日の状況を取得
  const rawFlights = fetchChiikawaFlights();
  const parsedFlights = [];
  for (const f of rawFlights) {
    const flightNo = f.identification?.number?.default;
    const origCode = f.airport?.origin?.code?.iata;
    const destCode = f.airport?.destination?.code?.iata;
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

    const d = new Date(depTs * 1000);
    const jstD = new Date(d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60 * 1000);
    const flightDateStr = formatDate(jstD);

    const isLanded = /着陸済/.test(statusJa);
    const isLive = /飛行中/.test(statusJa);

    parsedFlights.push({
      flightNo: flightNo || 'ANA便',
      origCode,
      destCode,
      origName,
      destName,
      route: `${origName} ➔ ${destName}`,
      dateStr: flightDateStr,
      depTime: formatTime(depSched || depReal),
      arrTime: formatTime(arrSched || arrReal),
      statusJa,
      isLanded,
      isLive,
      depTs,
      arrTs
    });
  }

  parsedFlights.sort((a, b) => a.depTs - b.depTs);

  // 本日分のフライト
  const todayFlights = parsedFlights.filter(f => f.dateStr === todayStr);

  // 現在地とナイトステイ先
  let currentAirport = '長崎';
  let currentAirportCode = 'NGS';
  let isAirborne = false;

  const liveFlight = parsedFlights.find(f => f.isLive);
  if (liveFlight) {
    isAirborne = true;
    currentAirport = `${liveFlight.origName} ➔ ${liveFlight.destName} へ飛行中`;
    currentAirportCode = liveFlight.destCode;
  } else {
    const landedFlights = parsedFlights.filter(f => f.isLanded);
    if (landedFlights.length > 0) {
      const lastLanded = landedFlights[landedFlights.length - 1];
      currentAirport = lastLanded.destName;
      currentAirportCode = lastLanded.destCode;
    }
  }

  let nightStayCode = currentAirportCode;
  let nightStayName = currentAirport;
  if (todayFlights.length > 0) {
    const lastToday = todayFlights[todayFlights.length - 1];
    nightStayCode = lastToday.destCode;
    nightStayName = lastToday.destName;
  }

  // 3. 向こう7日間の日付リストを構築
  const weeklyDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(jstNow.getTime() + i * 24 * 60 * 60 * 1000);
    weeklyDays.push({
      dayIndex: i,
      dateStr: formatDate(d),
      dateJa: formatJaDate(d),
      dow: DAY_NAMES[d.getDay()],
      isToday: i === 0,
      isTomorrow: i === 1,
      isWeekend: d.getDay() === 0 || d.getDay() === 6
    });
  }

  // 4. 明日（Day 1）の予測ダイヤ
  const learnedStays = fleetDb.nightStays?.[nightStayCode] || {};
  let standard1 = MORNING_DEPARTURE_STANDARDS[nightStayCode] || {
    flightNo: `ANA便 (${nightStayCode}発)`,
    orig: nightStayCode,
    dest: 'HND',
    depTime: '07:30前後',
    arrTime: '09:00前後',
    confidence: '70%',
    reason: `${AIRPORT_NAMES[nightStayCode] || nightStayCode}からの朝一折り返し便`
  };

  let topFlightNo = null;
  let topCount = 0;
  for (const fn in learnedStays) {
    if (learnedStays[fn] > topCount) {
      topCount = learnedStays[fn];
      topFlightNo = fn;
    }
  }
  let flight1Reason = standard1.reason;
  if (topCount > 0) {
    flight1Reason += `（過去同型機実績 ${topCount}回連続投入）`;
  }

  const tomorrowFlights = [
    {
      step: '第1便 (朝一始発)',
      flightNo: standard1.flightNo,
      route: `${AIRPORT_NAMES[standard1.orig] || standard1.orig} ➔ ${AIRPORT_NAMES[standard1.dest] || standard1.dest}`,
      time: `${standard1.depTime}発 - ${standard1.arrTime}着`,
      probability: 95,
      confidence: '本命 ◎ (95%)',
      reason: flight1Reason
    },
    {
      step: '第2便 (午前往路)',
      flightNo: 'NH677 / NH251',
      route: '東京(羽田) ➔ 広島 または 福岡',
      time: '10:15〜10:30発 - 11:40〜12:30着',
      probability: 75,
      confidence: '有力 ◯ (75%)',
      reason: '羽田での折り返し整備（約60分）後、主要地方基幹路線へ再投入'
    },
    {
      step: '第3便 (午後復路)',
      flightNo: 'NH682 / NH256',
      route: '広島 または 福岡 ➔ 東京(羽田)',
      time: '12:45〜13:10発 - 14:05〜14:50着',
      probability: 75,
      confidence: '有力 ◯ (75%)',
      reason: '地方空港から羽田への昼折り返し便'
    },
    {
      step: '第4便 (夕方便)',
      flightNo: 'NH593 / NH669',
      route: '東京(羽田) ➔ 松山 または 長崎',
      time: '14:15〜19:15発',
      probability: 60,
      confidence: '可能性あり △ (60%)',
      reason: '午後〜夕方にかけての四国・九州方面への2巡目フライト'
    }
  ];

  // 5. Day 2〜Day 6（向こう1週間）の路線確率予測
  // ANA B767-300ER の投入路線別ベース確率モデル
  const baseRouteProbabilities = [
    { route: '羽田 ➔ 福岡 / 福岡 ➔ 羽田', destCode: 'FUK', baseProb: 40, flights: 'NH245 / NH250 / NH251 / NH256', note: 'ANA屈指のドル箱幹線。平日・週末問わず高頻度で充当' },
    { route: '羽田 ➔ 広島 / 広島 ➔ 羽田', destCode: 'HIJ', baseProb: 30, flights: 'NH677 / NH682 / NH685 / NH688', note: 'B767の主力路線。ビジネス需要が高く安定運用' },
    { route: '羽田 ➔ 長崎 / 長崎 ➔ 羽田', destCode: 'NGS', baseProb: 25, flights: 'NH661 / NH664 / NH669 / NH662', note: '九州の定番就航地。夜間ナイトステイが頻出' },
    { route: '羽田 ➔ 松山 / 松山 ➔ 羽田', destCode: 'MYJ', baseProb: 20, flights: 'NH593 / NH596 / NH582', note: '四国基幹路線。午後〜夕方往復パターンの有力候補' },
    { route: '羽田 ➔ 新千歳 / 新千歳 ➔ 羽田', destCode: 'CTS', baseProb: 15, flights: 'NH55 / NH60 / NH71 / NH76', note: '北海道幹線。大型機材のサポートで週末や多客期に投入' },
    { route: '羽田 ➔ 伊丹 / 伊丹 ➔ 羽田', destCode: 'ITM', baseProb: 15, flights: 'NH21 / NH26 / NH35 / NH40', note: '伊丹シャトル便。早朝・昼間帯での突発充当あり' },
    { route: '羽田 ➔ 那覇 / 那覇 ➔ 羽田', destCode: 'OKA', baseProb: 10, flights: 'NH467 / NH472', note: '沖縄観光路線。週末や連休に特別ペイント機の遠征あり' }
  ];

  const weeklySchedule = [];
  for (const day of weeklyDays) {
    if (day.dayIndex === 0) {
      // 本日
      weeklySchedule.push({
        ...day,
        statusType: 'today',
        statusLabel: '本日（リアルタイム）',
        currentAirport: currentAirport,
        nightStay: nightStayName,
        flights: todayFlights.length > 0 ? todayFlights.map(f => ({
          flightNo: f.flightNo,
          route: f.route,
          time: `${f.depTime}発 - ${f.arrTime}着`,
          status: f.statusJa,
          isLanded: f.isLanded,
          isLive: f.isLive
        })) : [{
          flightNo: '運航計画待機中',
          route: `${currentAirport} 駐機中`,
          time: '朝便発表待ち',
          status: '待機中',
          isLanded: false,
          isLive: false
        }]
      });
    } else if (day.dayIndex === 1) {
      // 明日
      weeklySchedule.push({
        ...day,
        statusType: 'tomorrow',
        statusLabel: '明日（ナイトステイ確定予測）',
        expectedStart: `${nightStayName}発 (${standard1.flightNo})`,
        flights: tomorrowFlights
      });
    } else {
      // 2日後〜6日後
      // 週末補正（土日は福岡・新千歳・那覇の確率が微増、広島が微減など）
      const weekendFactor = day.isWeekend ? 1.2 : 1.0;
      const predictionsForDay = baseRouteProbabilities.map((r, idx) => {
        let prob = Math.round(r.baseProb * (day.isWeekend && (r.destCode === 'OKA' || r.destCode === 'CTS') ? weekendFactor : 1.0));
        // 少しずつ日によってバリエーションを出す（ランダムではなく周期的な傾向）
        const cycleOffset = ((day.dayIndex * 7 + idx * 13) % 15) - 7;
        prob = Math.max(5, Math.min(65, prob + cycleOffset));

        let rank = '可能性あり △';
        let star = '★★☆☆☆';
        if (prob >= 35) {
          rank = '本命 ◎';
          star = '★★★★★';
        } else if (prob >= 25) {
          rank = '有力 ◯';
          star = '★★★★☆';
        } else if (prob >= 15) {
          rank = '注目 ▲';
          star = '★★★☆☆';
        }

        return {
          route: r.route,
          destCode: r.destCode,
          probability: prob,
          star,
          rank,
          candidateFlights: r.flights,
          note: r.note
        };
      }).sort((a, b) => b.probability - a.probability);

      weeklySchedule.push({
        ...day,
        statusType: 'forecast',
        statusLabel: '週間確率予報',
        topRoute: predictionsForDay[0].route,
        topProbability: predictionsForDay[0].probability,
        routes: predictionsForDay.slice(0, 4)
      });
    }
  }

  // 6. 空港別「ちいかわジェット遭遇確率レーダー」
  const airportRadar = [
    { code: 'HND', name: '東京(羽田)', prob: 95, level: 'S (超高確率)', note: 'B767の全国運行ハブ。ほぼ毎日どこかの便で飛来します。' },
    { code: 'FUK', name: '福岡空港',   prob: 65, level: 'A (高確率)',   note: '羽田発着の最大就航地。昼・夕方ダイヤで遭遇チャンス大。' },
    { code: 'NGS', name: '長崎空港',   prob: 50, level: 'A (高確率)',   note: '夜間ナイトステイ便（NH669/NH662）で固定投入されやすい。' },
    { code: 'HIJ', name: '広島空港',   prob: 45, level: 'B (中確率)',   note: '午前〜昼（NH677/NH682）のビジネスダイヤで投入頻度高。' },
    { code: 'MYJ', name: '松山空港',   prob: 40, level: 'B (中確率)',   note: '午後便（NH593/NH596）での充当実績が多数あり。' },
    { code: 'CTS', name: '新千歳空港', prob: 30, level: 'C (週末注目)', note: '多客期や週末の大型機サポートとして投入される傾向。' },
    { code: 'ITM', name: '大阪(伊丹)', prob: 25, level: 'C (注目)',     note: '羽田-伊丹シャトル便での突発投入や朝一番便の実績あり。' },
    { code: 'OKA', name: '沖縄(那覇)', prob: 15, level: 'D (レア)',     note: 'リゾート路線への遠征フライト。遭遇できれば超ラッキー！' }
  ];

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
      nightStayCode: nightStayCode
    },
    weeklySchedule,
    airportRadar,
    dbStats: {
      totalFleetFlights: totalFlightsCount,
      fleetCount: 15
    }
  };

  fs.writeFileSync(OUTPUT_JSON_FILE, JSON.stringify(resultData, null, 2), 'utf-8');
  console.log(`💾 週間予測JSONデータを保存しました: ${OUTPUT_JSON_FILE}`);
  return resultData;
}

if (process.argv[1] && process.argv[1].endsWith('weekly_chiikawa_predictor.mjs')) {
  generateWeeklyPrediction().catch(e => console.error(e));
}
