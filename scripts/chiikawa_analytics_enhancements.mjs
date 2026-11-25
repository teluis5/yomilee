import fs from 'node:fs';
import { atomicWriteFileSync } from './file_safety.mjs';

function normalizeFlightNo(raw) {
  if (!raw) return '';
  const num = String(raw).replace(/[^0-9]/g, '');
  if (!num) return String(raw).trim();
  return `NH${parseInt(num, 10)}`;
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

// ============================================================================
// 1. 羽田空港 スポット / ピア連動解析
// ============================================================================
/**
 * ゲート番号またはODPT到着口文字列から羽田第2ターミナルのピア側を判定する。
 * - 北ピア: ゲート 46〜62 / 到着口 "1,2,3" 系
 * - 南ピア: ゲート 63〜73 / 到着口 "4,5,6" 系
 * - 沖止め/バス: 500番台
 */
export function resolveHndPier(gateOrArrivalText) {
  const s = String(gateOrArrivalText || '').trim().toUpperCase();
  if (!s) return null;
  if (s.includes('北ピア') || /(?:^|[^0-9])1\s*,\s*2(?:\s*,\s*3)?(?:$|[^0-9])/.test(s)) return 'NORTH';
  if (s.includes('南ピア') || /(?:^|[^0-9])4\s*,\s*5(?:\s*,\s*6)?(?:$|[^0-9])/.test(s)) return 'SOUTH';
  const m = s.match(/(\d{2,3})/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  if (num >= 500 && num <= 599) return 'BUS';
  if (num >= 46 && num <= 62) return 'NORTH';
  if (num >= 63 && num <= 75) return 'SOUTH';
  return null;
}

/**
 * ODPTの arrGate から表示・保存用の現在スポット/ピア表記を解決する。
 */
export function resolveHndSpotFromOdptGate(arrGateRaw, airportCode = 'HND') {
  if (airportCode !== 'HND') return null;
  const raw = String(arrGateRaw || '').trim().toUpperCase();
  if (!raw) return null;
  if (/^(?:[4-9]\d|5\d\d)[A-Z]?$/.test(raw)) {
    return {
      spot: raw,
      pier: resolveHndPier(raw),
      source: 'ODPT_SPOT',
      note: `羽田空港 ${raw}番スポット（ODPT到着情報）連動判定`
    };
  }
  const pier = resolveHndPier(raw);
  if (pier === 'NORTH') {
    return {
      spot: `北ピア(${raw})`,
      pier: 'NORTH',
      source: 'ODPT_PIER',
      note: `羽田第2ターミナル 北ピア（到着口${raw} / 46〜62番ゲート帯）連動判定`
    };
  }
  if (pier === 'SOUTH') {
    return {
      spot: `南ピア(${raw})`,
      pier: 'SOUTH',
      source: 'ODPT_PIER',
      note: `羽田第2ターミナル 南ピア（到着口${raw} / 63〜73番ゲート帯）連動判定`
    };
  }
  return null;
}

/**
 * 羽田スポット/ピア親和性スコア。
 * - 同一スポット番号: 1.12
 * - 短時間折返し（35〜95分）での同一ピア一致: 1.07 / 反対ピア: 0.95
 * - 100分超の長時間待機（トーイング移動あり得る）ではピア差を無効化（1.0）
 */
export function evaluateHndSpotAffinityEnhanced(currentSpot, candidateDepGate, turnaroundMin = null) {
  const spot = String(currentSpot || '').trim().toUpperCase();
  const gate = String(candidateDepGate || '').trim().toUpperCase();
  if (!spot || !gate) return 1.0;

  const isExactSpotNum = /^(?:[4-9]\d|5\d\d)[A-Z]?$/.test(spot);
  const isExactGateNum = /^(?:[4-9]\d|5\d\d)[A-Z]?$/.test(gate);
  if (isExactSpotNum && isExactGateNum && spot === gate) {
    return 1.12;
  }

  // ピア連動はクイックターン（35〜95分、または未指定時）に限定して適用
  if (turnaroundMin !== null && (turnaroundMin < 35 || turnaroundMin > 95)) {
    return 1.0;
  }

  const spotPier = resolveHndPier(spot);
  const gatePier = resolveHndPier(gate);
  if (spotPier && gatePier && spotPier !== 'BUS' && gatePier !== 'BUS') {
    return spotPier === gatePier ? 1.07 : 0.95;
  }
  return 1.0;
}

// ============================================================================
// 2. B767全機 羽田発着 二部グラフ同時割当（競合解消）エンジン
// ============================================================================
/**
 * 羽田到着767便群(A) と 羽田出発767便群(D) の二部グラフ最大重みマッチングを解き、
 * 特定の到着便 curArrFn -> 候補出発便 depFn の「フリート全体整合係数」を算出する。
 *
 * キャッシュキーで同一日・同一モデルに対して一度だけ計算する。
 */
export function buildHndBipartiteMatching(allDayFlights, learnedModel, excludedFlightsSet = null) {
  const transitions = learnedModel?.transitions || {};
  const list = Array.isArray(allDayFlights) ? allDayFlights : Object.values(allDayFlights || {});

  const arrivals = list.filter(f => {
    if (!f || f.isCancelled || f.dest !== 'HND') return false;
    if (!(f.is767 || f.is76P || String(f.model || '').includes('76'))) return false;
    const arrM = parseTimeToMinutes(f.actArrTime || f.arrTime);
    return arrM !== null && arrM >= 450 && arrM <= 1260;
  });

  const departures = list.filter(f => {
    if (!f || f.isCancelled || f.origin !== 'HND') return false;
    if (!(f.is767 || f.is76P || String(f.model || '').includes('76'))) return false;
    if (excludedFlightsSet && excludedFlightsSet.has(normalizeFlightNo(f.flightNo))) return false;
    const depM = parseTimeToMinutes(f.actDepTime || f.depTime);
    return depM !== null && depM >= 510 && depM <= 1320;
  });

  // 全有効エッジ (arrFn -> depFn) の重みを計算
  const edgeWeight = (arrF, depF) => {
    const arrM = parseTimeToMinutes(arrF.actArrTime || arrF.arrTime);
    const depM = parseTimeToMinutes(depF.actDepTime || depF.depTime);
    if (arrM === null || depM === null) return 0;
    const turn = depM - arrM;
    if (turn < 35 || turn > 130) return 0;

    const aFn = normalizeFlightNo(arrF.flightNo);
    const dFn = normalizeFlightNo(depF.flightNo);
    const tr = transitions[aFn]?.[dFn] || 0;

    // ターンアラウンド適合度（50〜85分を頂点）
    let turnScore = 0.4;
    if (turn >= 50 && turn <= 85) turnScore = 1.0;
    else if (turn >= 40 && turn < 50) turnScore = 0.85;
    else if (turn > 85 && turn <= 105) turnScore = 0.80;
    else if (turn >= 35 && turn < 40) turnScore = 0.55;

    // 遷移実績が支配的なシグナル
    const transScore = tr > 0 ? (2.0 + Math.min(tr, 10) * 1.1) : 0.6;
    const strictBonus = (depF.is767Strict ? 1.15 : 0.85);
    return turnScore * transScore * strictBonus;
  };

  const edges = [];
  const adjByArr = new Map();
  const adjByDep = new Map();

  for (const a of arrivals) {
    const aFn = normalizeFlightNo(a.flightNo);
    for (const d of departures) {
      const dFn = normalizeFlightNo(d.flightNo);
      if (aFn === dFn) continue;
      const w = edgeWeight(a, d);
      if (w <= 0) continue;
      const e = { aFn, dFn, w };
      edges.push(e);
      if (!adjByArr.has(aFn)) adjByArr.set(aFn, []);
      adjByArr.get(aFn).push(e);
      if (!adjByDep.has(dFn)) adjByDep.set(dFn, []);
      adjByDep.get(dFn).push(e);
    }
  }

  // 重み降順グリーディ初期化
  edges.sort((x, y) => y.w - x.w);
  const matchArrToDep = new Map();
  const matchDepToArr = new Map();
  for (const e of edges) {
    if (!matchArrToDep.has(e.aFn) && !matchDepToArr.has(e.dFn)) {
      matchArrToDep.set(e.aFn, e.dFn);
      matchDepToArr.set(e.dFn, e.aFn);
    }
  }

  // 2-opt 局所スワップ改善（総重みが増える交換を反復適用）
  const weightLookup = new Map(edges.map(e => [`${e.aFn}>${e.dFn}`, e.w]));
  const matchedArrs = [...matchArrToDep.keys()];
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (let i = 0; i < matchedArrs.length; i++) {
      for (let j = i + 1; j < matchedArrs.length; j++) {
        const a1 = matchedArrs[i];
        const a2 = matchedArrs[j];
        const d1 = matchArrToDep.get(a1);
        const d2 = matchArrToDep.get(a2);
        const curW = (weightLookup.get(`${a1}>${d1}`) || 0) + (weightLookup.get(`${a2}>${d2}`) || 0);
        const swapW1 = weightLookup.get(`${a1}>${d2}`) || 0;
        const swapW2 = weightLookup.get(`${a2}>${d1}`) || 0;
        if (swapW1 > 0 && swapW2 > 0 && swapW1 + swapW2 > curW + 0.05) {
          matchArrToDep.set(a1, d2);
          matchArrToDep.set(a2, d1);
          matchDepToArr.set(d2, a1);
          matchDepToArr.set(d1, a2);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return {
    matchArrToDep,
    matchDepToArr,
    weightLookup,
    adjByDep
  };
}

/**
 * 二部マッチング結果から、特定の羽田折返し (curArrFn -> depFn) の競合解消倍率を返す。
 * - 全体最適マッチと一致: 最大 1.15倍
 * - 他機体(ownerArr)が強く占有している便: 最小 0.72倍
 * 過学習・極端なバイアスを防ぐため、倍率は [0.72, 1.15] の穏当な範囲に制限する。
 */
export function getHndContentionFactor(bipartite, curArrFn, candidateDepFn) {
  if (!bipartite || !curArrFn || !candidateDepFn) return 1.0;
  const aFn = normalizeFlightNo(curArrFn);
  const dFn = normalizeFlightNo(candidateDepFn);

  const assignedOwner = bipartite.matchDepToArr.get(dFn);
  if (!assignedOwner) return 1.0;

  if (assignedOwner === aFn) {
    // フリート全体最適マッチで自機(aFn)に割り当てられた本命便
    const myW = bipartite.weightLookup.get(`${aFn}>${dFn}`) || 0;
    const rivals = (bipartite.adjByDep.get(dFn) || []).filter(e => e.aFn !== aFn);
    const maxRivalW = rivals.length > 0 ? Math.max(...rivals.map(r => r.w)) : 0;
    if (myW > maxRivalW * 1.25) return 1.15;
    return 1.08;
  }

  // 別到着便 assignedOwner が dFn を全体最適で確保している場合
  const ownerW = bipartite.weightLookup.get(`${assignedOwner}>${dFn}`) || 0;
  const myW = bipartite.weightLookup.get(`${aFn}>${dFn}`) || 0;
  if (ownerW > myW * 1.8) return 0.75;
  if (ownerW > myW * 1.2) return 0.86;
  return 0.94;
}

// ============================================================================
// 3. 連続稼働日数・連続地方泊・整備（運休・羽田帰還）リスク分析
// ============================================================================
export function analyzeOperatingAndMaintenanceProfile(fleetDb, todayStr, currentNightStayCode = null) {
  const allRawFlights = Object.values(fleetDb?.flights || {}).filter(f => Boolean(f?.reg && f?.date));
  const allByRegDate = {};
  const activeRegsByDate = {};
  for (const f of allRawFlights) {
    ((allByRegDate[f.reg] ||= {})[f.date] ||= []).push(f);
    (activeRegsByDate[f.date] ||= new Set()).add(f.reg);
  }

  const flights = allRawFlights.filter(f => {
    if (!f.flightNo || !f.flightNo.startsWith('NH')) return false;
    const num = parseInt(f.flightNo.replace(/[^0-9]/g, ''), 10);
    return num > 0 && num < 2000;
  });

  const byRegDate = {};
  for (const f of flights) {
    ((byRegDate[f.reg] ||= {})[f.date] ||= []).push(f);
  }

  // 全B767実績から「連続地方泊 k 泊目の翌日羽田帰還確率」と「羽田泊翌日の実運休/整備率」を算出
  // ※ 9000番台の訓練飛行や収集初日/軽量モードの未収集ギャップを誤って運休カウントしないよう厳密に除外
  const regionalStreakStats = {};
  let hndStayCount = 0;
  let idleNextAfterHnd = 0;
  let singleDayIdleAfterHnd = 0;
  let multiDayMaintAfterHnd = 0;
  let trainingNextAfterHnd = 0;
  let ja609aHndStayCount = 0;
  let ja609aIdleAfterHnd = 0;
  const fleetOperatingStreaks = [];

  for (const [reg, dm] of Object.entries(byRegDate)) {
    const dates = Object.keys(dm).sort();
    let regStreak = 0;
    let opStreak = 0;
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i];
      const list = [...dm[d]].sort((a, b) => (parseTimeToMinutes(a.depTime) ?? 0) - (parseTimeToMinutes(b.depTime) ?? 0));
      const stay = list[list.length - 1]?.dest || 'HND';
      const prevDiff = i > 0 ? Math.round((new Date(`${d}T00:00:00Z`) - new Date(`${dates[i - 1]}T00:00:00Z`)) / 86400000) : 1;
      if (prevDiff === 1) opStreak++;
      else {
        if (opStreak > 0) fleetOperatingStreaks.push(opStreak);
        opStreak = 1;
      }

      if (i < dates.length - 1) {
        const nd = dates[i + 1];
        const nextDiff = Math.round((new Date(`${nd}T00:00:00Z`) - new Date(`${d}T00:00:00Z`)) / 86400000);
        const nextDayStr = new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
        const isFullCoverageDay = reg === 'JA609A' || (activeRegsByDate[nextDayStr]?.size || 0) >= 6;

        if (stay === 'HND') {
          regStreak = 0;
          if (isFullCoverageDay) {
            hndStayCount++;
            if (reg === 'JA609A') ja609aHndStayCount++;
            if (nextDiff >= 2) {
              // 翌日に訓練便(9000番台)や他便で稼働していた場合は運休から除外
              const nextDayAny = allByRegDate[reg]?.[nextDayStr] || [];
              if (nextDayAny.length > 0) {
                trainingNextAfterHnd++;
              } else {
                idleNextAfterHnd++;
                if (reg === 'JA609A') ja609aIdleAfterHnd++;
                if (nextDiff === 2) singleDayIdleAfterHnd++;
                else multiDayMaintAfterHnd++;
              }
            }
          }
        } else {
          regStreak++;
          if (nextDiff === 1) {
            const nList = [...dm[nd]].sort((a, b) => (parseTimeToMinutes(a.depTime) ?? 0) - (parseTimeToMinutes(b.depTime) ?? 0));
            const nStay = nList[nList.length - 1]?.dest || 'HND';
            const bucket = Math.min(regStreak, 4);
            regionalStreakStats[bucket] ||= { hndReturns: 0, total: 0 };
            regionalStreakStats[bucket].total++;
            if (nStay === 'HND') regionalStreakStats[bucket].hndReturns++;
          }
        }
      }
    }
    if (opStreak > 0) fleetOperatingStreaks.push(opStreak);
  }

  // JA609A 自身の直近稼働統計を算出
  const jaMap = byRegDate['JA609A'] || {};
  const jaDates = Object.keys(jaMap).filter(d => d <= todayStr).sort();

  // 連続稼働日数（todayStr または前日から遡る）
  let consecutiveOperatingDays = 0;
  if (jaDates.length > 0) {
    let cursor = new Date(`${jaDates[jaDates.length - 1]}T00:00:00Z`);
    const dateSet = new Set(jaDates);
    while (dateSet.has(cursor.toISOString().slice(0, 10))) {
      consecutiveOperatingDays++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
  }

  // 直近7日・14日の累積レグ数
  const todayMs = new Date(`${todayStr}T00:00:00Z`).valueOf();
  let recent7dLegs = 0;
  let recent14dLegs = 0;
  for (const d of jaDates) {
    const diffDays = Math.round((todayMs - new Date(`${d}T00:00:00Z`).valueOf()) / 86400000);
    const legs = jaMap[d].length;
    if (diffDays >= 0 && diffDays < 7) recent7dLegs += legs;
    if (diffDays >= 0 && diffDays < 14) recent14dLegs += legs;
  }

  // 前日までの連続地方泊数（todayStr より前の完了日ベース）
  const pastJaDates = jaDates.filter(d => d < todayStr);
  let consecutiveRegionalStaysBeforeToday = 0;
  for (let i = pastJaDates.length - 1; i >= 0; i--) {
    const d = pastJaDates[i];
    const list = [...jaMap[d]].sort((a, b) => (parseTimeToMinutes(a.depTime) ?? 0) - (parseTimeToMinutes(b.depTime) ?? 0));
    const stay = list[list.length - 1]?.dest || 'HND';
    if (stay === 'HND') break;
    consecutiveRegionalStaysBeforeToday++;
  }

  const effectiveRegionalStreak = currentNightStayCode
    ? (currentNightStayCode === 'HND' ? 0 : consecutiveRegionalStaysBeforeToday + 1)
    : consecutiveRegionalStaysBeforeToday;

  const fleetRegionalReturnCurve = {};
  for (const [k, st] of Object.entries(regionalStreakStats)) {
    fleetRegionalReturnCurve[`streak_${k}`] = {
      total: st.total,
      hndReturns: st.hndReturns,
      returnRatePct: st.total > 0 ? Number(((st.hndReturns / st.total) * 100).toFixed(1)) : 0
    };
  }

  // 特別塗装機(JA609A)は通常機と異なり予備機待機や訓練投入されにくいため、
  // 整備ドック入り（複数日運休）率を主指標とし、一般機の1日予備機・訓練率は参考値として分離する
  const fleetMaintenanceDockRateAfterHndPct = hndStayCount > 0
    ? Number(((multiDayMaintAfterHnd / hndStayCount) * 100).toFixed(1))
    : 0;
  const fleetIdleRateAfterHndPct = hndStayCount > 0
    ? Number(((idleNextAfterHnd / hndStayCount) * 100).toFixed(1))
    : 0;

  let hndReturnPressure = 'low';
  if (effectiveRegionalStreak >= 4) hndReturnPressure = 'high';
  else if (effectiveRegionalStreak >= 3) hndReturnPressure = 'medium';

  let maintenanceRiskLevel = 'low';
  if (consecutiveOperatingDays >= 28 && recent14dLegs >= 65) {
    maintenanceRiskLevel = 'elevated';
  } else if (consecutiveOperatingDays >= 14 || recent7dLegs >= 35) {
    maintenanceRiskLevel = 'moderate';
  }

  const notes = [];
  notes.push(`JA609Aは現在 ${consecutiveOperatingDays}日連続稼働中（直近7日: ${recent7dLegs}便 / 14日: ${recent14dLegs}便・羽田泊翌日運休実績 ${ja609aIdleAfterHnd}/${ja609aHndStayCount}回）`);
  if (effectiveRegionalStreak >= 3) {
    notes.push(`地方泊が${effectiveRegionalStreak}泊連続となる見込みのため、羽田帰還圧力が高め（同型機実績では3泊目以降の翌日羽田帰還率 約${fleetRegionalReturnCurve.streak_3?.returnRatePct || 65}%）`);
  } else if (effectiveRegionalStreak === 0) {
    notes.push(`特別塗装機のため訓練・予備機待機は除外し、同型機の複数日整備（ドック入り）実績ベースで羽田泊翌日の整備運休率は約${fleetMaintenanceDockRateAfterHndPct}%`);
  }
  if (maintenanceRiskLevel === 'elevated') {
    notes.push('長期連続稼働帯に入っているため、羽田帰還後の定期整備（Aチェック等）による運休に留意');
  }

  return {
    asOfDate: todayStr,
    specialLiveryPolicy: 'exclude_training_and_standby',
    ja609aConsecutiveOperatingDays: consecutiveOperatingDays,
    ja609aRecent7dLegs: recent7dLegs,
    ja609aRecent14dLegs: recent14dLegs,
    ja609aHndStayStats: { hndStayCount: ja609aHndStayCount, idleAfterHnd: ja609aIdleAfterHnd },
    consecutiveRegionalStaysBeforeToday,
    projectedRegionalStayStreak: effectiveRegionalStreak,
    hndReturnPressure,
    maintenanceRiskLevel,
    fleetMaintenanceDockRateAfterHndPct,
    referenceNormalFleetIdleRatePct: fleetIdleRateAfterHndPct,
    fleetIdleSamples: {
      multiDayMaintAfterHnd,
      singleDayStandbyReference: singleDayIdleAfterHnd,
      trainingReference: trainingNextAfterHnd,
      hndStayCount
    },
    fleetRegionalReturnCurve,
    summaryNote: notes.join('。') + '。'
  };
}

/**
 * 連続地方泊数に応じた羽田泊帰還ブースト係数（穏当な補正）
 */
export function getRegionalReturnHndBoost(regionalStayStreak) {
  if (!Number.isFinite(regionalStayStreak) || regionalStayStreak < 3) return 1.0;
  if (regionalStayStreak === 3) return 1.16;
  return 1.28;
}

// ============================================================================
// 4. 週間予測（D+1〜D+6）リードタイム別アーカイブ保存＆自動検証
// ============================================================================
export function loadWeeklyPredictionsArchive(archiveFile) {
  if (!fs.existsSync(archiveFile)) return [];
  try {
    const raw = fs.readFileSync(archiveFile, 'utf-8');
    return raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch (e) {
    console.warn('⚠️ weekly_predictions_archive.jsonl 読み込み警告:', e.message);
    return [];
  }
}

/**
 * 実行日 issuedDate (= todayStr) の Day 1〜Day 6 予測をアーカイブへ保存する。
 * - 過去日 (issuedDate < todayStr) のレコードは絶対に改変しない（Immutable）
 * - 同一日 (issuedDate === todayStr) のレコードのみ最新の予測内容で更新する
 */
export function updateWeeklyPredictionsArchive(archiveFile, todayStr, weeklySchedule, isNightStayConfirmed) {
  const existing = loadWeeklyPredictionsArchive(archiveFile);
  const byKey = new Map();
  for (const rec of existing) {
    if (rec.issuedDate && rec.targetDate) {
      byKey.set(`${rec.issuedDate}|${rec.targetDate}`, rec);
    }
  }

  const nowIso = new Date().toISOString();
  for (const day of (weeklySchedule || [])) {
    if (!day || day.dayIndex < 1 || day.dayIndex > 6 || !day.dateStr) continue;
    const plans = Array.isArray(day.plans) ? day.plans : [];
    if (plans.length === 0) continue;

    const record = {
      issuedDate: todayStr,
      issuedAtIso: nowIso,
      targetDate: day.dateStr,
      leadDays: day.dayIndex,
      isNightStayConfirmed: Boolean(isNightStayConfirmed),
      plans: plans.slice(0, 3).map(p => ({
        planId: p.planId,
        probability: p.probability,
        startAirportCode: p.startAirportCode || p.flights?.[0]?.orig || null,
        stayCode: p.stayCode || p.flights?.[p.flights.length - 1]?.dest || null,
        routeSummary: p.routeSummary || '',
        firstFlight: normalizeFlightNo(p.flights?.[0]?.flightNo || ''),
        flightNos: (p.flights || []).map(f => normalizeFlightNo(f.flightNo)).filter(Boolean)
      }))
    };

    const key = `${todayStr}|${day.dateStr}`;
    byKey.set(key, record);
  }

  const sortedRecords = [...byKey.values()].sort((a, b) => {
    if (a.issuedDate !== b.issuedDate) return a.issuedDate.localeCompare(b.issuedDate);
    return a.targetDate.localeCompare(b.targetDate);
  });

  try {
    const content = sortedRecords.map(r => JSON.stringify(r)).join('\n') + (sortedRecords.length ? '\n' : '');
    atomicWriteFileSync(archiveFile, content, 'utf-8');
  } catch (e) {
    console.warn('⚠️ weekly_predictions_archive.jsonl 保存警告:', e.message);
  }
  return sortedRecords;
}

/**
 * アーカイブされた D+1〜D+6 予測を確定済み実績 (byDate) と突合し、リードタイム別の実測精度を集計する。
 */
export function evaluateWeeklyArchiveAccuracy(archiveRecords, byDate, todayStr) {
  const byLead = {};
  for (let d = 1; d <= 6; d++) {
    byLead[`D+${d}`] = {
      leadDays: d,
      samples: 0,
      planAFirstHits: 0,
      top3FirstHits: 0,
      planAFlightsHit: 0,
      top3FlightsHit: 0,
      totalFlights: 0,
      planAStayHits: 0,
      top3StayHits: 0
    };
  }

  for (const rec of (archiveRecords || [])) {
    if (!rec.targetDate || rec.targetDate >= todayStr) continue;
    const actualList = byDate?.[rec.targetDate];
    if (!actualList || actualList.length < 4) continue;
    const bucket = byLead[`D+${rec.leadDays}`];
    if (!bucket) continue;

    const plans = rec.plans || [];
    if (plans.length === 0) continue;

    const actualFirst = normalizeFlightNo(actualList[0].normFn || actualList[0].flightNo);
    const actualStay = actualList[actualList.length - 1].dest;
    const actualFns = actualList.map(f => normalizeFlightNo(f.normFn || f.flightNo));

    const planA = plans[0];
    const planAFnSet = new Set(planA.flightNos || []);
    const top3FnSet = new Set(plans.flatMap(p => p.flightNos || []));
    const top3FirstSet = new Set(plans.map(p => p.firstFlight).filter(Boolean));
    const top3StaySet = new Set(plans.map(p => p.stayCode).filter(Boolean));

    bucket.samples++;
    if (planA.firstFlight === actualFirst) bucket.planAFirstHits++;
    if (top3FirstSet.has(actualFirst)) bucket.top3FirstHits++;
    if (planA.stayCode === actualStay) bucket.planAStayHits++;
    if (top3StaySet.has(actualStay)) bucket.top3StayHits++;

    bucket.totalFlights += actualFns.length;
    bucket.planAFlightsHit += actualFns.filter(fn => planAFnSet.has(fn)).length;
    bucket.top3FlightsHit += actualFns.filter(fn => top3FnSet.has(fn)).length;
  }

  const pct = (num, den) => den > 0 ? Number(((num / den) * 100).toFixed(1)) : null;
  const summaryByLead = {};
  let totalArchivedRecords = (archiveRecords || []).length;
  let totalEvaluatedRecords = 0;

  for (const [k, b] of Object.entries(byLead)) {
    totalEvaluatedRecords += b.samples;
    summaryByLead[k] = {
      leadDays: b.leadDays,
      samples: b.samples,
      planAFirstHitRate: pct(b.planAFirstHits, b.samples),
      top3FirstHitRate: pct(b.top3FirstHits, b.samples),
      planAFlightHitRate: pct(b.planAFlightsHit, b.totalFlights),
      top3FlightHitRate: pct(b.top3FlightsHit, b.totalFlights),
      planAStayHitRate: pct(b.planAStayHits, b.samples),
      top3StayHitRate: pct(b.top3StayHits, b.samples)
    };
  }

  return {
    totalArchivedRecords,
    totalEvaluatedRecords,
    byLeadTime: summaryByLead
  };
}

// ============================================================================
// 5. 外れ要因の自動分類（評価ログ分析強化）
// ============================================================================
const FAILURE_LABELS = {
  perfect: '完全的中',
  hnd_morning_branch: '羽田朝一分岐',
  regional_morning_miss: '地方朝一外れ',
  hnd_turnaround_branch: '羽田折返し分岐',
  regional_mid_branch: '地方中盤分岐',
  delay_or_disruption: '遅延・イレギュラー運航'
};

export function classifyEvaluationFailure({ actualList, evaluatedFlights, prevNightStayCode, isFirstHit, dayHitFlights }) {
  const total = actualList.length;
  if (dayHitFlights === total) {
    return {
      failureCategory: 'perfect',
      failureCategoryLabel: FAILURE_LABELS.perfect,
      failureDetail: `全${total}便が予測シナリオと一致`
    };
  }

  // 大幅遅延（30分超の実出発/実到着遅延）またはイレギュラー便数（3便以下）の検知
  const hasMajorDelay = actualList.some(f => {
    if (f.realDeparture && f.depTs && (f.realDeparture - f.depTs) >= 35 * 60) return true;
    if (f.realArrival && f.arrTs && (f.realArrival - f.arrTs) >= 35 * 60) return true;
    return false;
  });

  if (!isFirstHit) {
    const first = actualList[0];
    if (prevNightStayCode === 'HND') {
      return {
        failureCategory: 'hnd_morning_branch',
        failureCategoryLabel: FAILURE_LABELS.hnd_morning_branch,
        failureDetail: `羽田泊翌朝の初便 ${first.normFn}(羽田➔${first.dest}) が予測上位3プラン外に分岐`
      };
    }
    return {
      failureCategory: 'regional_morning_miss',
      failureCategoryLabel: FAILURE_LABELS.regional_morning_miss,
      failureDetail: `地方泊(${prevNightStayCode})翌朝の初便 ${first.normFn}(${first.orig}➔${first.dest}) が予測外（機材変更・臨時便等）`
    };
  }

  // 初便的中後、最初に外れた便を特定
  const firstMissIdx = evaluatedFlights.findIndex(ef => !ef.isHit);
  const missActual = firstMissIdx >= 0 ? actualList[firstMissIdx] : null;
  const prevActual = firstMissIdx > 0 ? actualList[firstMissIdx - 1] : null;

  if (hasMajorDelay && firstMissIdx >= 1) {
    return {
      failureCategory: 'delay_or_disruption',
      failureCategoryLabel: FAILURE_LABELS.delay_or_disruption,
      failureDetail: `遅延影響を含み第${firstMissIdx + 1}便 ${missActual?.normFn || ''}(${missActual?.orig || ''}➔${missActual?.dest || ''}) でスジ変更`
    };
  }

  if (missActual && missActual.orig === 'HND') {
    return {
      failureCategory: 'hnd_turnaround_branch',
      failureCategoryLabel: FAILURE_LABELS.hnd_turnaround_branch,
      failureDetail: `${prevActual ? `${prevActual.normFn}着後の` : ''}羽田発 第${firstMissIdx + 1}便 ${missActual.normFn}(羽田➔${missActual.dest}) で別スジへ分岐`
    };
  }

  return {
    failureCategory: 'regional_mid_branch',
    failureCategoryLabel: FAILURE_LABELS.regional_mid_branch,
    failureDetail: `${missActual?.orig || '地方'}発 第${firstMissIdx + 1}便 ${missActual?.normFn || ''} で別スジへ分岐`
  };
}

export function summarizeFailureBreakdown(evalRecords) {
  const counts = {};
  for (const r of (evalRecords || [])) {
    const cat = r.failureCategory || 'perfect';
    counts[cat] = (counts[cat] || 0) + 1;
  }
  const total = (evalRecords || []).length || 1;
  const result = {};
  for (const [cat, count] of Object.entries(counts)) {
    result[cat] = {
      label: FAILURE_LABELS[cat] || cat,
      count,
      ratePct: Number(((count / total) * 100).toFixed(1))
    };
  }
  return result;
}
