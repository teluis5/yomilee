import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YOMILEE_ROOT = path.resolve(__dirname, '..');

function escapeYaml(str) {
  return String(str || '').replace(/"/g, '\\"').replace(/\r?\n/g, ' ').trim();
}

function formatMonthDay(dateStr) {
  if (!dateStr) return '';
  const [, mm, dd] = dateStr.split('-');
  return `${Number(mm)}月${Number(dd)}日`;
}

function buildTodayTable(flights = []) {
  if (!flights.length) {
    return '| 便名 | 区間（出発 ➔ 到着） | 定刻ダイヤ | 現在のステータス |\n| :--- | :--- | :--- | :--- |\n| 確認中 | 運航データ取得中 | - | 最新情報を確認中 |';
  }
  const rows = flights.map((f) => {
    const label = f.isPredicted ? `<b>${f.flightNo} (予想)</b>` : `<b>${f.flightNo}</b>`;
    const status = f.status || (f.isLive ? '✈️ 飛行中' : f.isLanded ? '✅ 着陸済' : '🕒 運航予定');
    return `| ${label} | ${f.route || '-'} | ${f.time || '-'} | ${status} |`;
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

/**
 * chiikawa_weekly_prediction.json の内容から本日の日次スケジュール記事を生成・更新する
 * （毎朝6時以降に作成・更新）
 */
export function generateDailyChiikawaArticle(predictionData = null, options = {}) {
  const { force = process.argv.includes('--force') } = options;
  const now = new Date();
  const jstHour = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60 * 1000).getHours();
  if (!force && jstHour < 6) {
    console.log(`ℹ️ 日次スケジュール記事は毎朝6時以降に作成します（現在JST ${jstHour}時台のためスキップ）`);
    return null;
  }

  const jsonPath = path.join(YOMILEE_ROOT, 'data', 'chiikawa_weekly_prediction.json');
  const data = predictionData || JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const weeklySchedule = data.weeklySchedule || [];
  const todayData = weeklySchedule.find((d) => d.statusType === 'today') || weeklySchedule[0];
  const tomorrowData = weeklySchedule.find((d) => d.statusType === 'tomorrow') || weeklySchedule[1];

  if (!todayData?.dateStr) {
    console.warn('⚠️ 日次記事生成スキップ: todayData.dateStr が見つかりません。');
    return null;
  }

  const dateCompact = todayData.dateStr.replace(/-/g, '');
  const slug = `${dateCompact}-chiikawa-jet-schedule`;
  const targetDir = path.join(YOMILEE_ROOT, 'src', 'content', 'blog', slug);
  const indexPath = path.join(targetDir, 'index.mdx');
  const heroPath = path.join(targetDir, 'hero.jpg');
  const templateHero = path.join(YOMILEE_ROOT, 'src', 'content', 'blog', 'ana-chiikawa-jet-schedule-guide', 'hero.jpg');

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  if (!fs.existsSync(heroPath) && fs.existsSync(templateHero)) {
    fs.copyFileSync(templateHero, heroPath);
  }

  const todayMd = formatMonthDay(todayData.dateStr);
  const tomorrowMd = tomorrowData?.dateStr ? formatMonthDay(tomorrowData.dateStr) : '翌日';
  const aircraft = data.aircraft || {};
  const accuracy = data.accuracyStats || {};
  const nightStayStatus = aircraft.isNightStayConfirmed
    ? `確定（${aircraft.nightStay || '確認済'}）`
    : `未確定（有力候補: ${aircraft.nightStay || '確認中'}）`;

  const title = `【${todayMd}速報】ちいかわジェット本日の運行状況＆明日のフライト予想`;
  const description = `本日${todayMd}のANA特別塗装機「ちいかわジェット（JA609A）」の運行状況・時刻表と、明日${tomorrowMd}のフライト予想をリアルタイム更新！現在の位置や夜間の駐機先、翌日の注目ルートをまとめました。`;

  const mdxContent = `---
title: "${escapeYaml(title)}"
description: "${escapeYaml(description)}"
pubDate: "${todayData.dateStr}"
updatedDate: "${todayData.dateStr}"
heroImage: "./hero.jpg"
categories: ["ちいかわ", "旅行"]
---
import ProblemBox from '../../../components/ProblemBox.astro';
import ConclusionBox from '../../../components/ConclusionBox.astro';

<ProblemBox>
- 今日（${todayMd}）のちいかわジェット（JA609A）はどの路線・空港を飛んでいる？
- これからの便や、今夜の駐機先（ナイトステイ）はどこになる？
- 明日（${tomorrowMd}）の始発便と1日の運航予想はどうなっている？
</ProblemBox>

ANAのボーイング767-300ER型機で運航されている特別塗装機<b>「ちいかわジェット（機体記号: JA609A）」</b>の、**${todayMd}**のリアルタイム運航状況と**${tomorrowMd}**の予想スケジュールです。

最新の全週間予想や初便候補のリアルタイム検証は、[ちいかわジェット週間運航ダッシュボード](/site/chiikawajet/)でも随時更新しています。

<div style="background: #f0f9ff; border: 2px solid #bae6fd; border-radius: 8px; padding: 1.2rem; margin: 1.25rem 0;">
  <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
    <span style="background: #0284c7; color: #ffffff; font-weight: bold; font-size: 0.85rem; padding: 0.25rem 0.6rem; border-radius: 4px;">
      ● LIVE 自動更新中
    </span>
    <span style="font-size: 0.85rem; color: #64748b;">更新時刻: ${data.updatedAt || todayData.dateStr}</span>
  </div>
  <p style="margin: 0 0 0.5rem 0; font-weight: bold; color: #1e293b; font-size: 1.05rem;">
    📍 現在の位置（JA609A）: <b>${aircraft.currentLocation || '確認中'}</b>
  </p>
  <p style="margin: 0; color: #475569; font-size: 0.9rem; line-height: 1.6;">
    今夜の駐機先（ナイトステイ）見通し: <b>${nightStayStatus}</b>
  </p>
</div>

## ✈️ 【本日 ${todayData.dateJa || todayMd}】ちいかわジェット運航スケジュール

${buildTodayTable(todayData.flights)}

## 🔮 【明日 ${tomorrowData?.dateJa || tomorrowMd}】の運航予想（プランA〜C）

ANA同型機（B767-300ER）の実績データと今夜の駐機先見通しをもとに算出した、明日の運航シナリオです（検証期間の初便的中率: ${accuracy.firstFlightHitRate ?? '-'}% / 1日通し的中率: ${accuracy.dailyFullHitRate ?? '-'}%）。

${buildTomorrowPlans(tomorrowData?.plans, tomorrowMd)}

<ConclusionBox>
- 本日（${todayMd}）の現在地は「**${aircraft.currentLocation || '確認中'}**」、今夜の駐機先は「**${nightStayStatus}**」です。
- 運航状況は機材繰りに応じて日中・夜間に随時更新されます。最新の確定便は[ちいかわジェット週間運航ダッシュボード](/site/chiikawajet/)をご確認ください。
- 搭乗のコツや座席・機内サービスについては[ANAちいかわジェットの乗り方・仕組みガイド](/blog/ana-chiikawa-jet-schedule-guide/)もあわせてご覧ください。
</ConclusionBox>
`;

  fs.writeFileSync(indexPath, mdxContent, 'utf-8');
  console.log(`📝 日次スケジュール記事を更新しました: ${slug}/index.mdx`);
  return { slug, indexPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  generateDailyChiikawaArticle();
}
