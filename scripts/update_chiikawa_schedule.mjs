import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YOMILEE_ROOT = path.resolve(__dirname, '..');
const TELUIS_ROOT = YOMILEE_ROOT;
const WORKSPACE_ROOT = path.resolve(TELUIS_ROOT, '../..');

// 引数解析
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');
const isAutoPush = args.includes('--auto-push');

// 対象記事ファイル
const TARGET_ARTICLE = path.join(TELUIS_ROOT, 'src', 'content', 'blog', 'ana-chiikawa-jet-schedule-guide', 'index.mdx');

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

// JSTの日付ヘルパー
function getJSTDate() {
  const now = new Date();
  const jstOffset = 9 * 60; // JST: UTC+9
  const localOffset = now.getTimezoneOffset();
  const jstDate = new Date(now.getTime() + (jstOffset + localOffset) * 60 * 1000);
  const yyyy = jstDate.getFullYear();
  const mm = String(jstDate.getMonth() + 1).padStart(2, '0');
  const dd = String(jstDate.getDate()).padStart(2, '0');
  const hh = String(jstDate.getHours()).padStart(2, '0');
  const min = String(jstDate.getMinutes()).padStart(2, '0');
  return {
    yyyy, mm, dd,
    dateStr: `${yyyy}-${mm}-${dd}`,
    timeStr: `${hh}:${min}`,
    formattedJa: `${yyyy}年${Number(mm)}月${Number(dd)}日 ${hh}:${min}`
  };
}

// タイムスタンプをJST時刻文字列に変換
function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  const jstOffset = 9 * 60;
  const localOffset = d.getTimezoneOffset();
  const jstDate = new Date(d.getTime() + (jstOffset + localOffset) * 60 * 1000);
  const hh = String(jstDate.getHours()).padStart(2, '0');
  const mm = String(jstDate.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const jstOffset = 9 * 60;
  const localOffset = d.getTimezoneOffset();
  const jstDate = new Date(d.getTime() + (jstOffset + localOffset) * 60 * 1000);
  const yyyy = jstDate.getFullYear();
  const mm = String(jstDate.getMonth() + 1).padStart(2, '0');
  const dd = String(jstDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// -------------------------------------------------------------
// 1. フライトデータ取得 (curl.exe / Python経由でCloudflareブロック回避)
// -------------------------------------------------------------
async function fetchFlightData() {
  const url = 'https://api.flightradar24.com/common/v1/flight/list.json?query=JA609A&fetchBy=reg&page=1&limit=25';
  console.log('📡 Flightradar24 API から JA609A の運航データを取得中...');

  // 1. curl.exe (Windows標準、Cloudflare通過)
  try {
    const cmd = `curl.exe -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`;
    const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    const data = JSON.parse(stdout);
    const rawFlights = data.result?.response?.data || [];
    if (rawFlights.length > 0) {
      console.log(`✅ [curl] ${rawFlights.length} 件のフライト履歴・予定を取得しました。`);
      return rawFlights;
    }
  } catch (e) {
    console.warn('⚠️ curl.exe での取得失敗、Pythonにフォールバック:', e.message);
  }

  // 2. Python urllib にフォールバック
  try {
    const pyCode = `
import urllib.request, json
url = '${url}'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
with urllib.request.urlopen(req, timeout=10) as resp:
    print(resp.read().decode('utf-8'))
`;
    const stdout = execSync(`python -c "${pyCode.replace(/\n/g, ' ')}"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    const data = JSON.parse(stdout);
    const rawFlights = data.result?.response?.data || [];
    if (rawFlights.length > 0) {
      console.log(`✅ [python] ${rawFlights.length} 件のフライト履歴・予定を取得しました。`);
      return rawFlights;
    }
  } catch (e) {
    console.warn('⚠️ Python での取得失敗:', e.message);
  }

  return null;
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
  if (/Canceled|Cancelled/i.test(statusText)) return '欠航';
  return statusText;
}

// -------------------------------------------------------------
// 2. スケジュールテーブル Markdown 生成（今後の予定ファースト）
// -------------------------------------------------------------
function generateScheduleMarkdown(rawFlights, dateInfo) {
  const todayStr = dateInfo.dateStr;
  const nowTs = Math.floor(Date.now() / 1000);

  // フライト情報のパース
  const parsed = [];
  for (const f of rawFlights) {
    const flightNo = f.identification?.number?.default || 'ANA';
    const origCode = f.airport?.origin?.code?.iata || '---';
    const origName = AIRPORT_NAMES[origCode] || f.airport?.origin?.name || origCode;
    const destCode = f.airport?.destination?.code?.iata || '---';
    const destName = AIRPORT_NAMES[destCode] || f.airport?.destination?.name || destCode;

    const t = f.time || {};
    const depSched = t.scheduled?.departure;
    const arrSched = t.scheduled?.arrival;
    const depReal = t.real?.departure;
    const arrReal = t.real?.arrival;

    const date = formatDate(depSched || depReal);
    const depTime = formatTime(depSched);
    const arrTime = formatTime(arrSched);
    const statusText = f.status?.text || '';
    const status = translateStatus(statusText);
    const isLive = Boolean(f.status?.live);
    const isLanded = /Landed/i.test(statusText) || Boolean(arrReal);

    // 未来の便（未出発・飛行中）判定
    const isUpcoming = isLive || (!isLanded && (depSched ? depSched >= nowTs - 1800 : false));

    parsed.push({
      date,
      flightNo,
      origCode,
      origName,
      destCode,
      destName,
      route: `${origName} ➔ ${destName}`,
      scheduleTime: `${depTime}発 - ${arrTime}着`,
      status,
      isLive,
      isLanded,
      isUpcoming,
      depTimestamp: depSched || depReal || 0,
      arrTimestamp: arrSched || arrReal || 0
    });
  }

  // 最新順から古い順（時系列昇順）にソート
  const chronological = [...parsed].sort((a, b) => a.depTimestamp - b.depTimestamp);

  // 本日のフライト
  const todayFlights = chronological.filter(f => f.date === todayStr);

  // これから飛ぶ便（Upcoming）と 終了した便（Past）に分類
  const upcomingFlights = todayFlights.filter(f => !f.isLanded);
  const pastFlights = todayFlights.filter(f => f.isLanded);

  // 最新の着陸便・駐機場所（ナイトステイ先）の特定
  const lastCompletedFlight = [...pastFlights].pop() || [...chronological].filter(f => f.isLanded).pop();
  const currentAirportCode = lastCompletedFlight ? lastCompletedFlight.destCode : 'HND';
  const currentAirportName = AIRPORT_NAMES[currentAirportCode] || currentAirportCode;

  let md = `\n{/* CHIIKAWA_SCHEDULE_START */}\n`;
  md += `### ✈️ 【最新】ちいかわジェット今後の運行予定・フライト状況（${dateInfo.formattedJa} 自動更新）\n\n`;

  // 1. 現在の機体位置 ＆ 明日のフライト予測ボックス
  md += `<div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem;">\n`;
  md += `  <p style="margin: 0 0 0.5rem 0; font-weight: bold; color: #166534; font-size: 1rem;">\n`;
  md += `    📍 現在の機体位置 ＆ 今後の出発予測\n`;
  md += `  </p>\n`;
  md += `  <ul style="margin: 0; padding-left: 1.25rem; color: #15803d; font-size: 0.9rem; line-height: 1.6;">\n`;
  md += `    <li><b>現在地</b>: <b>${currentAirportName}（${currentAirportCode}）</b> に滞在／駐機中</li>\n`;
  md += `    <li><b>今後の始発便予測</b>: 航空機の運用上、次のフライトは<b>「${currentAirportName}発」</b>の便（羽田行き等）からスタートする可能性が極めて高いです！</li>\n`;
  md += `  </ul>\n`;
  md += `</div>\n\n`;

  // 2. これから飛ぶ予定のフライト（Upcoming Flights）
  md += `#### 🕒 本日これからの運行予定（出発前・飛行中）\n\n`;
  if (upcomingFlights.length > 0) {
    md += `| 便名 | 区間（出発 ➔ 到着） | 定刻ダイヤ | ステータス |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    for (const f of upcomingFlights) {
      md += `| <b>${f.flightNo}</b> | ${f.route} | ${f.scheduleTime} | <b>${f.status}</b> |\n`;
    }
    md += `\n`;
  } else {
    md += `> 🌙 **本日のフライトはすべて終了しました。**\n`;
    md += `> 機体は現在 **${currentAirportName}** で夜間駐機（ナイトステイ）中です。明朝の運航計画（午前6〜7時頃）が入り次第、ここに最新ダイヤが自動反映されます。\n\n`;
  }

  // 3. 本日の運航実績（終了分）
  if (pastFlights.length > 0) {
    md += `#### 📋 本日の運航実績（終了分）\n\n`;
    md += `| 便名 | 区間（出発 ➔ 到着） | 定刻ダイヤ | 運航結果 |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    for (const f of pastFlights) {
      md += `| <b>${f.flightNo}</b> | ${f.route} | ${f.scheduleTime} | ${f.status} |\n`;
    }
    md += `\n`;
  }

  md += `<small style="color: #64748b; display: block; margin-top: 0.5rem;">※フライトレーダー24（JA609A）公式トラッキングデータよりリアルタイム自動更新しています。天候や急な機材繰りにより変更となる場合があるため、搭乗前には必ずANA公式サイトの発着案内をご確認ください。</small>\n`;
  md += `{/* CHIIKAWA_SCHEDULE_END */}\n`;

  return { md, flightCount: todayFlights.length };
}

// -------------------------------------------------------------
// 3. 記事本文への組み込み・差分更新
// -------------------------------------------------------------
function updateArticleContent(scheduleMd, dateInfo) {
  if (!fs.existsSync(TARGET_ARTICLE)) {
    console.error(`❌ 対象記事が見つかりません: ${TARGET_ARTICLE}`);
    return false;
  }

  let content = fs.readFileSync(TARGET_ARTICLE, 'utf-8');

  // 既存のマーカーがあるか確認（JSXコメントまたはHTMLコメント）
  const markerRegex = /(?:\{\/\*\s*CHIIKAWA_SCHEDULE_START\s*\*\/\}|<!--\s*CHIIKAWA_SCHEDULE_START\s*-->)[\s\S]*?(?:\{\/\*\s*CHIIKAWA_SCHEDULE_END\s*\*\/\}|<!--\s*CHIIKAWA_SCHEDULE_END\s*-->)/;

  if (markerRegex.test(content)) {
    const currentSection = content.match(markerRegex)[0];
    // 日時以外の表部分を比較して差分チェック
    const cleanCurrent = currentSection.replace(/（\d{4}年\d+月\d+日 \d{2}:\d{2} 自動更新）/, '').trim();
    const cleanNew = scheduleMd.replace(/（\d{4}年\d+月\d+日 \d{2}:\d{2} 自動更新）/, '').trim();

    if (!isForce && cleanCurrent === cleanNew) {
      console.log('ℹ️ スケジュール内容に変更はありません（更新スキップ）。');
      return false;
    }

    content = content.replace(markerRegex, scheduleMd.trim());
  } else {
    // マーカーがない場合、ステップ2の後に挿入
    const insertTarget = '### ステップ2：本日のフライトスケジュールを確認';
    if (content.includes(insertTarget)) {
      content = content.replace(insertTarget, `${scheduleMd}\n${insertTarget}`);
    } else {
      // 適切な位置が見つからなければ「## 🔍 【超実用】」の直前に挿入
      content = content.replace('## 🔍 【超実用】', `${scheduleMd}\n\n## 🔍 【超実用】`);
    }
  }

  // Frontmatter の updatedDate を更新
  if (content.includes('updatedDate:')) {
    content = content.replace(/updatedDate:\s*["'][^"']+["']/, `updatedDate: "${dateInfo.dateStr}"`);
  } else {
    content = content.replace(/pubDate:\s*["']([^"']+)["']/, `pubDate: "$1"\nupdatedDate: "${dateInfo.dateStr}"`);
  }

  fs.writeFileSync(TARGET_ARTICLE, content, 'utf-8');
  console.log(`💾 記事のスケジュールを最新情報に更新しました: ${TARGET_ARTICLE}`);
  return true;
}

// -------------------------------------------------------------
// 4. Git コミット＆プッシュ
// -------------------------------------------------------------
function performAutoPush(dateInfo) {
  console.log('\n🔒 === 安全なGitコミット＆プッシュを開始 ===');
  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd: TELUIS_ROOT, encoding: 'utf-8' }).trim();
    if (!remoteUrl.includes('teluis') || !remoteUrl.includes('github.com')) {
      console.error(`❌ リモートURL検証エラー: 予期しないリポジトリです (${remoteUrl})`);
      return;
    }

    // git pull
    try {
      execSync('git pull origin main --rebase', { cwd: TELUIS_ROOT, stdio: 'inherit' });
    } catch {}

    const relPath = path.relative(TELUIS_ROOT, TARGET_ARTICLE);
    execSync(`git add "${relPath}"`, { cwd: TELUIS_ROOT, stdio: 'inherit' });

    const commitMsg = `feat(teluis): update ANA chiikawa jet flight schedule (${dateInfo.dateStr} ${dateInfo.timeStr})`;
    console.log(`📝 コミット実行: "${commitMsg}"`);
    execSync(`git commit -m "${commitMsg}"`, { cwd: TELUIS_ROOT, stdio: 'inherit' });

    console.log('🚀 リモート (origin main) へプッシュ中...');
    execSync('git push origin main', { cwd: TELUIS_ROOT, stdio: 'inherit' });
    console.log('🎉 Gitプッシュが完了しました！GitHub Pagesの自動デプロイが開始されます。');
  } catch (e) {
    console.error('❌ Git操作中にエラーが発生しました:', e.message);
  }
}

// -------------------------------------------------------------
// メイン処理
// -------------------------------------------------------------
async function main() {
  const dateInfo = getJSTDate();
  console.log('========================================================');
  console.log('✈️  === ANAちいかわジェット (JA609A) 運行予定自動更新 ===');
  console.log(`📅 実行日時: ${dateInfo.formattedJa}`);
  console.log('========================================================\n');

  // 1. フライトデータ取得
  const rawFlights = await fetchFlightData();
  if (!rawFlights || rawFlights.length === 0) {
    console.log('⚠️ 運航データが取得できませんでした。');
    return;
  }

  // 2. テーブルMarkdown生成
  const { md: scheduleMd, flightCount } = generateScheduleMarkdown(rawFlights, dateInfo);
  console.log(`📊 本日・直近の運航便数: ${flightCount} 便\n`);

  if (isDryRun) {
    console.log('🧪 --dry-run モード: 記事ファイル更新をスキップします。生成プレビュー:');
    console.log(scheduleMd);
    return;
  }

  // 3. 記事本文への書き込み
  const isUpdated = updateArticleContent(scheduleMd, dateInfo);

  // 4. 自動プッシュ
  if (isUpdated && isAutoPush) {
    performAutoPush(dateInfo);
  }

  console.log('\n========================================================');
  console.log(`🎉 処理が完了しました！ (更新状態: ${isUpdated ? '更新あり' : '更新なし（差分なし）'})`);
  console.log('========================================================');
}

main().catch(err => {
  console.error('❌ 実行時エラー:', err);
  process.exit(1);
});
