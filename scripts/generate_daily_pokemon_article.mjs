import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YOMILEE_ROOT = path.resolve(__dirname, '..');

function escapeYaml(str) {
  return String(str || '').replace(/"/g, '\\"').replace(/\r?\n/g, ' ').trim();
}

function getTodayJstStr() {
  const now = new Date();
  const jst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60 * 1000);
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, '0');
  const d = String(jst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatMonthDay(dateStr) {
  if (!dateStr) return '';
  const [, mm, dd] = dateStr.split('-');
  return `${Number(mm)}月${Number(dd)}日`;
}

function buildDomesticTodayTable(flights = []) {
  if (!flights.length) {
    return '| 便名 | 区間（出発 ➔ 到着） | 定刻ダイヤ | 現在のステータス |\n| :--- | :--- | :--- | :--- |\n| 確認中 | 運航データ取得中 | - | 最新情報を確認中 |';
  }
  const rows = flights.map((f) => {
    const label = f.isPredicted ? `<b>${f.flightNo} (予想)</b>` : `<b>${f.flightNo}</b>`;
    const route = f.route || `${f.originName || f.origCode || '-'} ➔ ${f.destinationName || f.destCode || '-'}`;
    const time = f.time || f.timeRange || (f.depTime && f.arrTime ? `${f.depTime} - ${f.arrTime}` : '-');
    const status = f.status || (f.isLive ? '✈️ 飛行中' : f.isLanded ? '✅ 着陸済' : '🕒 運航予定');
    return `| ${label} | ${route} | ${time} | ${status} |`;
  });
  return [
    '| 便名 | 区間（出発 ➔ 到着） | 定刻ダイヤ | 現在のステータス |',
    '| :--- | :--- | :--- | :--- |',
    ...rows
  ].join('\n');
}

function buildTomorrowPlans(plans = [], tomorrowMd) {
  if (!plans.length) {
    return `明日（${tomorrowMd}）の運航予想は、今夜の駐機先が確定し次第更新されます。`;
  }
  return plans.slice(0, 3).map((plan, idx) => {
    const flights = (plan.flights || []).map((f) =>
      `| <b>${f.flightNo}</b> | ${f.route || '-'} | ${f.time || '-'} | ${f.confidence || `${plan.probability || '-'}%`} |`
    );
    const table = flights.length
      ? [
          '| 便名 | 区間（出発 ➔ 到着） | 定刻ダイヤ | 予想確度 |',
          '| :--- | :--- | :--- | :--- |',
          ...flights
        ].join('\n')
      : '（運航便データ準備中）';
    const title = plan.title || plan.planName || `プラン${idx + 1}`;
    const prob = plan.probability != null ? `（確率 ${plan.probability}%）` : '';
    const summary = plan.routeSummary ? `\n\nルート概要: **${plan.routeSummary}**` : '';
    return `#### ${title}${prob}${summary}\n\n${table}`;
  }).join('\n\n');
}

function buildFleetTable(jets = []) {
  if (!jets.length) {
    return '| 機体 | 機材 / 登録記号 | 区分 | 現在の状況 / 最新フライト |\n| :--- | :--- | :--- | :--- |\n| 確認中 | - | - | データ取得中 |';
  }
  const rows = jets.map((j) => {
    const cf = j.currentFlight;
    const flightInfo = cf ? `${cf.flightNo || ''} (${cf.route || j.currentLocation || '-'})` : (j.currentLocation || '確認中');
    const state = j.flightState || '確認中';
    return `| <b>${j.name}</b> | ${j.modelCode || '-'} (${j.reg}) | ${j.category || j.type} | ${state} / ${flightInfo} |`;
  });
  return [
    '| 機体 | 機材 / 登録記号 | 区分 | 現在の状況 / 最新フライト |',
    '| :--- | :--- | :--- | :--- |',
    ...rows
  ].join('\n');
}

/**
 * pokemon_weekly_prediction.json の内容から本日の日次スケジュール記事を生成・更新する
 * （毎朝6時以降に作成・更新）
 */
export function generateDailyPokemonArticle(predictionData = null, options = {}) {
  const { force = process.argv.includes('--force') } = options;
  const now = new Date();
  const jstHour = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60 * 1000).getHours();
  if (!force && jstHour < 6) {
    console.log(`ℹ️ ポケモンジェット日次記事は毎朝6時以降に作成します（現在JST ${jstHour}時台のためスキップ）`);
    return null;
  }

  const jsonPath = path.join(YOMILEE_ROOT, 'data', 'pokemon_weekly_prediction.json');
  if (!predictionData && !fs.existsSync(jsonPath)) {
    console.warn('⚠️ ポケモン予測JSONが見つかりません:', jsonPath);
    return null;
  }
  const data = predictionData || JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const todayStr = getTodayJstStr();
  const dateCompact = todayStr.replace(/-/g, '');
  const slug = `${dateCompact}-pokemon-jet-schedule`;
  const targetDir = path.join(YOMILEE_ROOT, 'src', 'content', 'blog', slug);
  const indexPath = path.join(targetDir, 'index.mdx');
  const heroPath = path.join(targetDir, 'hero.jpg');
  const ogpJpgPath = path.join(YOMILEE_ROOT, 'public', 'brand', 'pokemonjet_ogp.jpg');
  const fallbackHero = path.join(YOMILEE_ROOT, 'src', 'content', 'blog', 'ana-chiikawa-jet-schedule-guide', 'hero.jpg');

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  if (fs.existsSync(ogpJpgPath)) {
    fs.copyFileSync(ogpJpgPath, heroPath);
  } else if (!fs.existsSync(heroPath) && fs.existsSync(fallbackHero)) {
    fs.copyFileSync(fallbackHero, heroPath);
  }

  const jets = data.jets || [];
  const domesticJet = jets.find((j) => j.reg === 'JA819A') || jets[0] || {};
  const dp = data.domesticPrediction || {};
  const todayMd = formatMonthDay(todayStr);
  const tomorrowMd = dp.tomorrowDate ? formatMonthDay(dp.tomorrowDate) : '翌日';
  const nightStayStatus = dp.isNightStayConfirmed
    ? `確定（${dp.nightStayName || '確認済'}）`
    : `未確定（有力候補: ${dp.nightStayName || '確認中'}）`;

  const title = `【${todayMd}速報】ANAポケモンジェット全5機 本日の運行状況＆国内線JA819Aスケジュール`;
  const description = `本日${todayMd}のANA特別塗装機「ポケモンジェット」全5機（赤JA819A・ピカチュウNH・イーブイNH・緑・初代）のリアルタイム運行状況と、国内線JA819Aの本日のフライト予定をまとめました。`;

  const mdxContent = `---
title: "${escapeYaml(title)}"
description: "${escapeYaml(description)}"
pubDate: "${todayStr}"
updatedDate: "${todayStr}"
heroImage: "./hero.jpg"
categories: ["ポケモン", "旅行"]
---
import ProblemBox from '../../../components/ProblemBox.astro';
import ConclusionBox from '../../../components/ConclusionBox.astro';

<ProblemBox>
- 今日（${todayMd}）の国内線ポケモンジェット赤（JA819A）はどの路線・空港を飛んでいる？
- ピカチュウジェットNHやイーブイジェットNHなど国際線4機の現在地はどこ？
- 本日の運航ダイヤと最新の飛行ステータスをひと目で確認したい！
</ProblemBox>

ANAの特別塗装機<b>「ポケモンジェット」全5機</b>の、**${todayMd}**のリアルタイム運航状況と国内線仕様機（JA819A）の本日のスケジュールです。

<div style="background: #fef2f2; border: 2px solid #fecaca; border-radius: 8px; padding: 1.2rem; margin: 1.25rem 0;">
  <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
    <span style="background: #dc2626; color: #ffffff; font-weight: bold; font-size: 0.85rem; padding: 0.25rem 0.6rem; border-radius: 4px;">
      ● LIVE 自動更新中
    </span>
    <span style="font-size: 0.85rem; color: #64748b;">更新時刻: ${data.updatedAt || todayStr}</span>
  </div>
  <p style="margin: 0 0 0.5rem 0; font-weight: bold; color: #1e293b; font-size: 1.05rem;">
    📍 国内線 JA819A（ポケモンジェット 赤）現在地: <b>${domesticJet.currentLocation || '確認中'}</b>
  </p>
  <p style="margin: 0; color: #475569; font-size: 0.9rem; line-height: 1.6;">
    運航ステータス: <b>${domesticJet.flightState || '確認中'}</b> / 今夜の駐機先見通し: <b>${nightStayStatus}</b>
  </p>
</div>

## ✈️ 【本日 ${todayMd}】国内線 JA819A（ポケモンジェット 赤）運航スケジュール

${buildDomesticTodayTable(domesticJet.todayFlights)}

## 🔮 【明日 ${tomorrowMd}】国内線 JA819A の運航予想（プランA〜C）

ANA同型機（B787-8）の公式ODPTダイヤと今夜の駐機先見通しをもとに算出した、明日の運航シナリオです。

${buildTomorrowPlans(dp.tomorrowPlans, tomorrowMd)}

## 🌐 ANAポケモンジェット全5機 リアルタイム現在地一覧

${buildFleetTable(jets)}

<ConclusionBox>
- 本日（${todayMd}）の国内線ポケモンジェット赤（JA819A）の現在地は「**${domesticJet.currentLocation || '確認中'}**」、今夜の駐機先見通しは「**${nightStayStatus}**」です。
- 運航状況は機材繰りに応じて日中・夜間に随時自動更新されます。
</ConclusionBox>
`;

  fs.writeFileSync(indexPath, mdxContent, 'utf-8');
  console.log(`📝 ポケモンジェット日次記事を更新しました: ${indexPath}`);
  return indexPath;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  generateDailyPokemonArticle();
}
