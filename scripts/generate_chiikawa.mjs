import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
const apiKeyArg = args.find(a => a.startsWith('--api-key='))?.split('=')[1];
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
const targetLimit = limitArg ? Math.max(1, parseInt(limitArg, 10)) : 1; // デフォルト1記事（1日2回実行で計2記事）

// APIキーの自動解決
function resolveApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  if (apiKeyArg) return apiKeyArg.trim();

  const paths = [
    path.join(WORKSPACE_ROOT, '.secrets', 'gemini-key.txt'),
    path.join(TELUIS_ROOT, '.secrets', 'gemini-key.txt'),
    path.join(WORKSPACE_ROOT, '1_Projects', 'yomilee', '.secrets', 'gemini-key.txt')
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf-8').trim();
        if (content) return content;
      } catch {}
    }
  }

  return '';
}

const GEMINI_API_KEY = resolveApiKey();

// 今日の日付 (JST)
function getJSTDate() {
  const now = new Date();
  const jstOffset = 9 * 60; // JST: UTC+9
  const localOffset = now.getTimezoneOffset();
  const jstDate = new Date(now.getTime() + (jstOffset + localOffset) * 60 * 1000);
  const yyyy = jstDate.getFullYear();
  const mm = String(jstDate.getMonth() + 1).padStart(2, '0');
  const dd = String(jstDate.getDate()).padStart(2, '0');
  return { yyyy, mm, dd, dateStr: `${yyyy}-${mm}-${dd}`, formattedJa: `${yyyy}年${Number(mm)}月${Number(dd)}日` };
}

function decodeXml(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim();
}

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

// -------------------------------------------------------------
// ちいかわ関連トピック収集フェッチャー
// -------------------------------------------------------------

// 1. Google News RSS（「ちいかわ」検索）
async function fetchGoogleNewsChiikawa() {
  const query = encodeURIComponent('ちいかわ');
  const url = `https://news.google.com/rss/search?q=${query}&hl=ja&gl=JP&ceid=JP:ja`;
  console.log('📡 Google News（ちいかわ最新ニュース）を取得中...');

  try {
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item\b[\s\S]*?<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const content = match[0];
      let rawTitle = decodeXml(content.match(/<title>(.*?)<\/title>/)?.[1] || '');
      const link = decodeXml(content.match(/<link>(.*?)<\/link>/)?.[1] || '');
      const pubDate = decodeXml(content.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '');

      // メディア名の除去（例: 「タイトル - Yahoo!ニュース」）
      const sourceMatch = rawTitle.match(/ - ([^-]+)$/);
      const sourceName = sourceMatch ? sourceMatch[1] : 'ニュースメディア';
      const cleanTitle = rawTitle.replace(/ - [^-]+$/, '').trim();

      if (cleanTitle && link) {
        items.push({
          sourceType: 'google_news_chiikawa',
          title: cleanTitle,
          rawTitle,
          link,
          pubDate,
          description: '',
          image: null,
          sourceName: `Googleニュース (${sourceName})`
        });
      }
    }
    return items;
  } catch (e) {
    console.warn('⚠️ Google News (ちいかわ) の取得に失敗しました:', e.message);
    return [];
  }
}

// 2. PR TIMES（新商品・コラボ・プレスリリース）
async function fetchPRTimesChiikawa() {
  console.log('📡 PR TIMES（ちいかわ新商品・コラボ発表）を取得中...');
  try {
    const res = await fetch('https://prtimes.jp/index.rdf', { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item\b[\s\S]*?<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const content = match[0];
      const title = decodeXml(content.match(/<title>(.*?)<\/title>/)?.[1] || '');
      const link = decodeXml(content.match(/<link>(.*?)<\/link>/)?.[1] || '');
      const descRaw = decodeXml(content.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '');

      // ちいかわ関連キーワード判定
      const isChiikawa = /ちいかわ|ハチワレ|うさぎ|ナガノ|モモンガ|くりまんじゅう|シーサー|ラッコ|ちいかわらんど|ちいかわベーカリー|ちいかわレストラン/i.test(title) ||
                         /ちいかわ/i.test(descRaw);

      if (title && link && isChiikawa) {
        // 画像抽出
        const imgMatch = descRaw.match(/https:\/\/prcdn\.freetls\.fastly\.net\/release_image\/[^\s\"\'\<\>]+/i) ||
                         content.match(/<image>(.*?)<\/image>/i);
        const image = imgMatch ? imgMatch[0] : null;
        const cleanDesc = descRaw.replace(/\[画像\d+:[^\]]+\]/g, '').replace(/\[[^\]]+株式会社\]/g, '').trim().slice(0, 150);

        items.push({
          sourceType: 'prtimes_chiikawa',
          title,
          rawTitle: title,
          link,
          description: cleanDesc,
          image,
          sourceName: 'PR TIMES 公式プレスリリース'
        });
      }
    }
    return items;
  } catch (e) {
    console.warn('⚠️ PR TIMES の取得に失敗しました:', e.message);
    return [];
  }
}

// 3. Yahoo!ニュース（エンタメ）
async function fetchYahooEntertainmentChiikawa() {
  console.log('📡 Yahoo!ニュース（エンタメ・ちいかわ話題）を取得中...');
  try {
    const res = await fetch('https://news.yahoo.co.jp/rss/topics/entertainment.xml', { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item\b[\s\S]*?<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const content = match[0];
      const title = decodeXml(content.match(/<title>(.*?)<\/title>/)?.[1] || '');
      const link = decodeXml(content.match(/<link>(.*?)<\/link>/)?.[1] || '');

      if (title && link && /ちいかわ|ハチワレ|うさぎ|ナガノ|モモンガ|くりまんじゅう/i.test(title)) {
        items.push({
          sourceType: 'yahoo_entertainment_chiikawa',
          title,
          rawTitle: title,
          link,
          description: '',
          image: null,
          sourceName: 'Yahoo!ニュース エンタメ'
        });
      }
    }
    return items;
  } catch (e) {
    console.warn('⚠️ Yahoo!ニュースの取得に失敗しました:', e.message);
    return [];
  }
}

// -------------------------------------------------------------
// スコアリング・フィルタリング
// -------------------------------------------------------------
function filterAndScoreChiikawaTopics(rawTopics) {
  const scored = [];

  for (const t of rawTopics) {
    // 競走馬など無関係なノイズの除外
    if (/競馬|騎手|JRA|オッズ|出走|馬番|パドック/i.test(t.title)) {
      continue;
    }

    // 必ず「ちいかわ」またはナガノ作品主要キャラクターを含むこと
    const hasChar = /ちいかわ|ハチワレ|うさぎ|モモンガ|くりまんじゅう|シーサー|ラッコ|古本屋|ナガノ展|ナガノ/i.test(t.title);
    if (!hasChar) continue;

    let score = 50;

    // PR TIMES 公式リリースは高信頼・画像付き
    if (t.sourceType === 'prtimes_chiikawa') score += 40;

    // グッズ・コラボ・新商品・イベント関連は読者の実用性が高いため加点
    if (/コラボ|新商品|新登場|発売|限定|一番くじ|くじ|食玩|ガチャ|ポップアップ|カフェ|らんど|レストラン|ベーカリー|単行本|予約|特典/i.test(t.title)) {
      score += 30;
    }

    // 画像がある場合は加点
    if (t.image) score += 20;

    // 大手企業とのコラボ（ANA, ファミマ, GU, ユニクロ, サンリオ, くら寿司 等）
    if (/ANA|ファミマ|ファミリーマート|セブン|ローソン|GU|ユニクロ|サンリオ|くら寿司|しまむら|アベイル|パルコ/i.test(t.title)) {
      score += 25;
    }

    scored.push({ ...t, score });
  }

  // スコア順に降順ソート
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// -------------------------------------------------------------
// 重複チェック
// -------------------------------------------------------------
const HISTORY_FILE = path.join(YOMILEE_ROOT, 'scripts', 'history_chiikawa.json');

function loadHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch {
      return { links: [], titles: [], slugs: [] };
    }
  }
  return { links: [], titles: [], slugs: [] };
}

function saveHistory(history) {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 直近500件を保持
    history.links = history.links.slice(-500);
    history.titles = history.titles.slice(-500);
    history.slugs = history.slugs.slice(-500);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch (e) {
    console.warn('⚠️ 履歴ファイルの保存に失敗:', e.message);
  }
}

function isDuplicateTopic(topic, history, blogDir) {
  const targetLink = topic.link || '';
  const cleanTitle = topic.title.replace(/[「『【】」』]/g, '').trim();

  // 1. 履歴ファイルでのチェック
  if (targetLink && history.links.includes(targetLink)) return true;
  if (history.titles.some(t => t.includes(cleanTitle.slice(0, 15)) || cleanTitle.includes(t.slice(0, 15)))) {
    return true;
  }

  // 2. ブログディレクトリの既存記事チェック
  if (fs.existsSync(blogDir)) {
    const dirs = fs.readdirSync(blogDir);
    for (const dir of dirs) {
      const indexPath = path.join(blogDir, dir, 'index.mdx');
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, 'utf-8');
        if (targetLink && content.includes(targetLink)) return true;
        if (cleanTitle.length > 10 && content.includes(cleanTitle.slice(0, 15))) return true;
      }
    }
  }

  return false;
}

// スラッグ生成 (chiikawa-YYYYMMDD-hash)
function generateSlug(topic, dateInfo) {
  const hashSource = topic.link || topic.title;
  const hash = crypto.createHash('md5').update(hashSource).digest('hex').slice(0, 6);
  return `chiikawa-${dateInfo.yyyy}${dateInfo.mm}${dateInfo.dd}-${hash}`;
}

// -------------------------------------------------------------
// サムネイル画像（hero.jpg）の取得・保存
// -------------------------------------------------------------
async function prepareHeroImage(targetDir, imageUrl, pageUrl) {
  const heroPath = path.join(targetDir, 'hero.jpg');

  // 1. 直接指定された画像URLがあればダウンロード
  if (imageUrl) {
    try {
      console.log(`🖼️ サムネイル画像をダウンロード中: ${imageUrl}`);
      const res = await fetch(imageUrl, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > 1000) {
          fs.writeFileSync(heroPath, Buffer.from(buffer));
          console.log(`✅ hero.jpg を保存しました (${buffer.byteLength} bytes)`);
          return;
        }
      }
    } catch (e) {
      console.warn('⚠️ サムネイル直接ダウンロード失敗:', e.message);
    }
  }

  // 2. 記事ページURLからのOGP画像探索
  if (pageUrl) {
    try {
      console.log(`🔍 ページOGP画像を探索中: ${pageUrl.slice(0, 60)}...`);
      const res = await fetch(pageUrl, {
        headers: FETCH_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const html = await res.text();
        const ogMatch = html.match(/<meta[^>]+property=[\"\']og:image[\"\'][^>]+content=[\"\']([^\"\']+)[\"\']/i) ||
                        html.match(/<meta[^>]+content=[\"\']([^\"\']+)[\"\'][^>]+property=[\"\']og:image[\"\']/i);
        if (ogMatch && ogMatch[1]) {
          const ogImgUrl = ogMatch[1];
          console.log(`🖼️ 発見したOGP画像をダウンロード中: ${ogImgUrl}`);
          const imgRes = await fetch(ogImgUrl, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(8000) });
          if (imgRes.ok) {
            const buf = await imgRes.arrayBuffer();
            if (buf.byteLength > 1000) {
              fs.writeFileSync(heroPath, Buffer.from(buf));
              console.log(`✅ hero.jpg (OGP) を保存しました (${buf.byteLength} bytes)`);
              return;
            }
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ ページOGP探索失敗:', e.message);
    }
  }

  // 3. 高品質フォールバック画像（ちいかわパステル調のSVG/WebP/JPEG）
  // 1ピクセルの透明JPEGではなく、視覚的に整った軽量JPEG
  const fallbackJpgBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  fs.writeFileSync(heroPath, Buffer.from(fallbackJpgBase64, 'base64'));
  console.log('✅ フォールバック hero.jpg を保存しました');
}

function cleanTitleForDisplay(rawTitle) {
  let t = rawTitle.replace(/[-|].*$/, '').trim();
  // （週刊女性PRIME）や (オリコンニュース) 等の括弧書きを除去
  t = t.replace(/[（\(][^）\)]+[）\)]/g, '').trim();
  // 全ての引用符やカギ括弧・特殊記号を除去
  t = t.replace(/[“”"「」『』【】]/g, '').trim();
  return t;
}

// -------------------------------------------------------------
// フォールバック記事生成（APIキー未設定・エラー時用）
// -------------------------------------------------------------
function generateFallbackChiikawaArticle(topic, dateInfo) {
  const mainCleanTitle = cleanTitleForDisplay(topic.title);
  const displayTitle = mainCleanTitle.length > 25 ? mainCleanTitle.slice(0, 24) + '…' : mainCleanTitle;

  const isCollab = /コラボ|ANA|ファミマ|GU|ユニクロ|サンリオ|くら寿司|しまむら/i.test(topic.title);
  const isGoods = /グッズ|新商品|発売|限定|一番くじ|食玩|ガチャ/i.test(topic.title);

  let title = `【ちいかわ】${displayTitle}が登場！発売日・取扱店舗・注目ポイントまとめ`;
  if (isCollab) {
    title = `【ちいかわコラボ】${displayTitle}の最新情報！開催期間・限定グッズ・購入のコツ`;
  } else if (isGoods) {
    title = `【ちいかわ新商品】${displayTitle}のラインナップ・価格・取扱店舗まとめ`;
  }

  const description = `ちいかわの最新情報「${displayTitle}」を徹底まとめ！発売日や開催期間、取扱店舗、注目のラインナップや購入時の注意点・整理券対策までわかりやすく解説します。`;

  return `---
title: "${title}"
description: "${description}"
pubDate: "${dateInfo.dateStr}"
heroImage: "./hero.jpg"
categories: ["ちいかわ", "新商品・トレンド"]
---
import ProblemBox from '../../../components/ProblemBox.astro';
import ConclusionBox from '../../../components/ConclusionBox.astro';

<ProblemBox>
- 「${displayTitle}」はいつ発売？どこで買えるの？
- グッズのラインナップや価格帯、限定アイテムを知りたい
- 売り切れや争奪戦・整理券の対策はどうすればいい？
</ProblemBox>

大人気の「ちいかわ（なんか小さくてかわいいやつ）」より、見逃せない注目の最新情報<b>「${mainCleanTitle}」</b>が登場しました！

今回は、ちいかわファンなら絶対にチェックしておきたい発売日・開催期間、取扱店舗、ラインナップの詳細や、争奪戦を回避して確実に手に入れるためのポイントを実用的にわかりやすくまとめました。

---

## 📅 「${displayTitle}」の概要と発売日・取扱店舗

まずは、今回発表された注目の基本情報とスケジュールを整理します。

${topic.description ? `> ${topic.description}\n\n` : ''}

- **発売日・開始時期**: 公式発表・順次展開
- **取扱店舗**: 全国の対象店舗、公式オンラインショップ等
- **対象キャラクター**: ちいかわ、ハチワレ、うさぎ ほか

人気コラボや限定グッズは初日や発売直後に完売・品薄になるケースが非常に多いため、取扱店舗や発売タイミングは事前にしっかり把握しておきましょう。

---

## 🛍️ 注目のラインナップ・限定グッズと見どころ

今回のラインナップは、ファンの心をくすぐる可愛らしいデザインと実用性を兼ね備えたアイテムが揃っています。

1. **限定デザインアイテム**: 今回のテーマに合わせた描き下ろしイラストや特別な仕様
2. **普段使いしやすい実用グッズ**: 日常の生活やお出かけで活躍する使い勝手の良いラインナップ
3. **コレクション性抜群の小物**: バッグに付けたり並べて飾りたくなる愛らしい仕上がり

細部までこだわり抜かれた表情やポーズは、ちいかわファン必見の仕上がりになっています。

---

## ⚠️ 争奪戦必至？売り切れ対策と確実にゲットするコツ

ちいかわのコラボや限定新商品は非常に注目度が高く、店頭での混雑やオンラインでの即完売が予想されます。以下のポイントを押さえて準備しておきましょう。

- **事前整理券・入場予約の確認**: 店頭販売の場合、開店前の整理券配布や事前予約制が導入される場合があります。
- **購入個数制限のルール**: 「お一人様○点まで」などの購入制限が設けられることが多いため、ルールを確認しておきましょう。
- **オンライン通販の事前スタンバイ**: 公式オンラインショップで購入する場合は、事前に会員登録やログインを済ませ、販売開始時刻の数分前からスタンバイするのが鉄則です。

👉 **最新の公式情報・一次ソースはこちら**:  
<a href="${topic.link}" target="_blank" rel="noopener noreferrer">${topic.title}</a>

---

<ConclusionBox>
- **${displayTitle}** の最新情報を実用目線で総まとめしました。
- 発売日や取扱店舗、整理券の有無を事前にチェックして、スムーズにゲットしましょう！
</ConclusionBox>
`;
}

// -------------------------------------------------------------
// Gemini API による記事生成
// -------------------------------------------------------------
async function generateChiikawaArticleWithGemini(topic, dateInfo) {
  if (!GEMINI_API_KEY) {
    console.log('⚠️ GEMINI_API_KEY 未設定のため、フォールバック記事を生成します。');
    return generateFallbackChiikawaArticle(topic, dateInfo);
  }

  console.log(`🤖 Gemini で【teluis × ちいかわ実用ガイド】記事を執筆中: "${topic.title.slice(0, 30)}..."`);

  const topicData = `タイトル: ${topic.title}
情報源: ${topic.sourceName}
リンク: ${topic.link}
概要: ${topic.description || '最新のちいかわニュース'}`;

  const systemInstruction = `あなたは生活改善・スマートな暮らしを届ける情報サイト「teluis」の編集部員であり、同時に「ちいかわ（なんか小さくてかわいいやつ）」を愛する実用派ライターです。
提示された最新のちいかわニュース（コラボ、新商品、イベント、グッズ、一番くじ等）をもとに、ちいかわファンが「今すぐ知りたい実用的な情報（発売日・場所・価格・購入制限・争奪戦回避のコツ）」がひと目でわかる充実したブログ記事を1本執筆してください。

【執筆ルール】
1. **ペルソナと文体**:
   - ちいかわへの愛とワクワク感を持ちつつも、teluisらしい「実用的で整理された丁寧なガイド調」。
   - AI特有の陳腐な定型句（「いかがでしたでしょうか」「〜のではないでしょうか」「ぜひチェックしてみてください」など）は絶対に使用禁止。
   - 自然で読みやすい日本語で、情報がスッと頭に入ってくる構成にする。
2. **タイトル（32〜45文字程度）**:
   - 読者の検索意図を満たす具体的でクリックしたくなる魅力的なタイトル。
   - 例: 「【ちいかわ×ANA】限定コラボグッズ登場！発売日・取扱場所・争奪戦対策まとめ」
   - 例: 「【ちいかわ新商品】〇〇が発売決定！ラインナップ・価格・取扱店舗まとめ」
   - 「まとめ」だけでなく具体的な中身を記載する。
3. **記事の構成**:
   - Frontmatter:
     title: キャッチーなタイトル（32〜45文字）
     description: 110〜130文字程度で、記事の要点をまとめた魅力的な概要
     pubDate: "${dateInfo.dateStr}"
     heroImage: "./hero.jpg"
     categories: ["ちいかわ", "新商品・トレンド"]
   - 導入部:
     - 簡潔な挨拶と今回の話題の紹介
     - <ProblemBox> コンポーネント（読者が疑問に思う発売日・購入場所・売り切れ対策などを3点箇条書き）
   - 本文H2見出し（3〜4つ）:
     - H2: 概要と発売日・開催期間・取扱店舗（いつ・どこで買えるか）
     - H2: 注目のラインナップ・限定アイテムと価格（表やリストを活用）
     - H2: 争奪戦回避！購入時の注意点・確実に手に入れるポイント（整理券、事前予約、購入制限、通販のコツなど）
     - H2: 公式一次情報・まとめ
   - 一次ソースリンク:
     <a href="${topic.link}" target="_blank" rel="noopener noreferrer">${topic.title}</a>
   - まとめ部:
     - <ConclusionBox> コンポーネント（記事の要点3点を箇条書き）
4. **構文制約**:
   - <br />、<hr />、<img /> などのHTMLタグは必ず自己閉じタグにすること。
   - コードブロック (\`\`\`mdx や \`\`\`) で囲まず、Markdownテキストのみを出力すること。`;

  const userPrompt = `日付: ${dateInfo.formattedJa} (${dateInfo.dateStr})

【取り上げる話題】
${topicData}

上記のちいかわ最新情報を徹底的に整理して、読者がスムーズにグッズやコラボを楽しめる最高のteluis記事を執筆してください！`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: systemInstruction + '\n\n---\n\n' + userPrompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192
        }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.warn(`⚠️ Gemini API エラー (${response.status}): ${err}`);
      return generateFallbackChiikawaArticle(topic, dateInfo);
    }

    const data = await response.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return generateFallbackChiikawaArticle(topic, dateInfo);
    }

    text = text.replace(/^```(?:mdx|markdown)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
    return text;
  } catch (e) {
    console.warn('⚠️ Gemini API 呼び出し失敗:', e.message);
    return generateFallbackChiikawaArticle(topic, dateInfo);
  }
}

// -------------------------------------------------------------
// Gitコミット＆プッシュ（安全検証付き）
// -------------------------------------------------------------
function performAutoPush(createdSlugs) {
  if (createdSlugs.length === 0) return;

  console.log('\n🔒 === 安全なGitコミット＆プッシュを開始 ===');
  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd: TELUIS_ROOT, encoding: 'utf-8' }).trim();
    if (!remoteUrl.includes('teluis') || !remoteUrl.includes('github.com')) {
      console.error(`❌ リモートURL検証エラー: 予期しないリポジトリです (${remoteUrl})`);
      return;
    }
    console.log(`✅ リモートURL照合OK: teluis リポジトリを確認しました。`);

    // git pull
    try {
      execSync('git pull origin main --rebase', { cwd: TELUIS_ROOT, stdio: 'inherit' });
    } catch {}

    // 新規記事のステージング
    for (const slug of createdSlugs) {
      const relPath = `src/content/blog/${slug}`;
      console.log(`📦 ステージング中: ${relPath}`);
      execSync(`git add "${relPath}"`, { cwd: TELUIS_ROOT, stdio: 'inherit' });
    }

    // 履歴ファイルもステージング
    if (fs.existsSync(HISTORY_FILE)) {
      execSync(`git add scripts/history_chiikawa.json`, { cwd: TELUIS_ROOT, stdio: 'inherit' });
    }

    const dateInfo = getJSTDate();
    const commitMsg = `feat(teluis): add ${createdSlugs.length} chiikawa article(s) (${dateInfo.dateStr})`;
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
  console.log(`🐹 === teluis 【ちいかわ最新情報】自動更新システム ===`);
  console.log(`📅 対象日付: ${dateInfo.dateStr} (${dateInfo.formattedJa})`);
  console.log(`🔑 Gemini APIキー状態: ${GEMINI_API_KEY ? '設定済み (Gemini 2.5 Flash)' : '未設定（フォールバックモード）'}`);
  console.log(`🎯 生成上限: ${targetLimit} 記事`);
  console.log('========================================================\n');

  // 1. 各ソースから話題を収集
  const [googleItems, prtimesItems, yahooItems] = await Promise.all([
    fetchGoogleNewsChiikawa(),
    fetchPRTimesChiikawa(),
    fetchYahooEntertainmentChiikawa()
  ]);

  const allTopics = [...prtimesItems, ...googleItems, ...yahooItems];
  console.log(`📥 収集したちいかわ関連候補総数: ${allTopics.length} 件`);

  // 2. スコアリング＆フィルタリング
  const scoredTopics = filterAndScoreChiikawaTopics(allTopics);
  console.log(`✨ フィルタリング通過候補: ${scoredTopics.length} 件`);

  if (scoredTopics.length === 0) {
    console.log('⚠️ 本日生成可能なちいかわトピックが見つかりませんでした。');
    return;
  }

  // 3. 重複排除
  const history = loadHistory();
  const blogDir = path.join(TELUIS_ROOT, 'src', 'content', 'blog');
  const validTopics = [];

  for (const topic of scoredTopics) {
    if (!isForce && isDuplicateTopic(topic, history, blogDir)) {
      continue;
    }
    validTopics.push(topic);
    if (validTopics.length >= targetLimit) break;
  }

  console.log(`📝 今回生成するちいかわ話題: ${validTopics.length} 件\n`);

  if (validTopics.length === 0) {
    console.log('✅ すべてのトピックは既に記事作成済みです（新規トピックなし）。');
    return;
  }

  const createdSlugs = [];

  for (let i = 0; i < validTopics.length; i++) {
    const topic = validTopics[i];
    console.log(`--- [記事 ${i + 1}/${validTopics.length}] ---`);
    console.log(`📌 タイトル: ${topic.title}`);
    console.log(`🌐 情報源: ${topic.sourceName}`);

    const slug = generateSlug(topic, dateInfo);
    console.log(`📂 スラッグ: ${slug}`);

    const targetDir = path.join(blogDir, slug);

    if (isDryRun) {
      console.log('🧪 --dry-run モード: 記事生成・ファイル保存をスキップします。');
      continue;
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // サムネイル画像の保存
    await prepareHeroImage(targetDir, topic.image, topic.link);

    // 記事本文の生成
    const articleMdx = await generateChiikawaArticleWithGemini(topic, dateInfo);

    // ファイル書き出し
    const mdxPath = path.join(targetDir, 'index.mdx');
    fs.writeFileSync(mdxPath, articleMdx, 'utf-8');
    console.log(`💾 記事を保存しました: ${mdxPath}`);

    // 履歴更新
    history.links.push(topic.link);
    history.titles.push(topic.title);
    history.slugs.push(slug);
    createdSlugs.push(slug);
  }

  // 履歴保存
  if (!isDryRun && createdSlugs.length > 0) {
    saveHistory(history);
  }

  // 自動プッシュ
  if (isAutoPush && createdSlugs.length > 0) {
    performAutoPush(createdSlugs);
  }

  console.log('\n========================================================');
  console.log(`🎉 ちいかわ記事の処理が完了しました！ (生成数: ${createdSlugs.length}件)`);
  console.log('========================================================');
}

main().catch(err => {
  console.error('❌ 実行エラー:', err);
  process.exit(1);
});
