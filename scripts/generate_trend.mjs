import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YOMILEE_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(YOMILEE_ROOT, '../..');

// 引数解析
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');
const isAutoPush = args.includes('--auto-push');
const apiKeyArg = args.find(a => a.startsWith('--api-key='))?.split('=')[1];
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
const targetLimit = limitArg ? Math.max(1, parseInt(limitArg, 10)) : 2; // デフォルト2記事

// APIキーの自動解決 (.secrets/gemini-key.txt も探索)
function resolveApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  if (apiKeyArg) return apiKeyArg.trim();

  const secretPath = path.join(WORKSPACE_ROOT, '.secrets', 'gemini-key.txt');
  if (fs.existsSync(secretPath)) {
    try {
      const content = fs.readFileSync(secretPath, 'utf-8').trim();
      if (content) return content;
    } catch {
      // 無視
    }
  }

  const localSecretPath = path.join(YOMILEE_ROOT, '.secrets', 'gemini-key.txt');
  if (fs.existsSync(localSecretPath)) {
    try {
      const content = fs.readFileSync(localSecretPath, 'utf-8').trim();
      if (content) return content;
    } catch {
      // 無視
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
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

// 暮らし・ライフスタイル・節約・おでかけキーワード
const LIFESTYLE_PATTERNS = [
  /暮らし/i, /生活/i, /節約/i, /家計/i, /お得/i, /セール/i, /割引/i, /ポイント/i, /還元/i,
  /コストコ/i, /無印/i, /100均/i, /ダイソー/i, /セリア/i, /ニトリ/i, /カルディ/i, /楽天/i, /Amazon/i,
  /新店舗/i, /オープン/i, /商業施設/i, /モール/i, /ショップ/i,
  /時短/i, /便利グッズ/i, /防災/i, /備蓄/i, /料理/i, /レシピ/i, /健康/i, /睡眠/i, /片付け/i, /収納/i, /掃除/i,
  /旅行/i, /観光/i, /おでかけ/i, /週末/i, /イベント/i, /イルミネーション/i, /ホテル/i, /カフェ/i, /スポット/i,
  /グルメ/i, /スイーツ/i, /テイクアウト/i, /朝活/i, /散歩/i
];

// IT・ガジェット・通信・スマホキーワード
const GADGET_PATTERNS = [
  /スマホ/i, /スマートフォン/i, /iPhone/i, /Android/i, /Pixel/i, /Galaxy/i, /AQUOS/i, /Xperia/i,
  /格安SIM/i, /povo/i, /LINEMO/i, /ahamo/i, /楽天モバイル/i, /ワイモバイル/i, /UQ/i, /通信プラン/i, /eSIM/i, /Wi-Fi/i,
  /ガジェット/i, /スマートウォッチ/i, /Apple Watch/i, /イヤホン/i, /充電器/i, /モバイルバッテリー/i, /Anker/i,
  /iPad/i, /タブレット/i, /ノートPC/i, /MacBook/i, /Windows/i,
  /アプリ/i, /便利ツール/i, /AIツール/i, /ChatGPT/i, /ブラウザ/i, /拡張機能/i, /Google/i, /LINE/i, /PayPay/i
];

function calculateScores(text) {
  let lifeScore = 0;
  for (const pattern of LIFESTYLE_PATTERNS) {
    if (pattern.test(text)) lifeScore += 10;
  }
  let gadgetScore = 0;
  for (const pattern of GADGET_PATTERNS) {
    if (pattern.test(text)) gadgetScore += 10;
  }
  return { lifeScore, gadgetScore, totalScore: lifeScore + gadgetScore };
}

// 1. はてなブックマーク（暮らし人気エントリ）
async function fetchHatenaLifeTrends() {
  console.log('📡 はてなブックマーク（暮らし）人気RSSを取得中...');
  try {
    const res = await fetch('https://b.hatena.ne.jp/hotentry/life.rss');
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item\b[\s\S]*?<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const content = match[0];
      const title = decodeXml(content.match(/<title>(.*?)<\/title>/)?.[1] || '');
      const link = content.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const countStr = content.match(/<hatena:bookmarkcount>(.*?)<\/hatena:bookmarkcount>/)?.[1] || '0';
      const desc = decodeXml(content.match(/<description>(.*?)<\/description>/)?.[1] || '');
      const image = content.match(/<hatena:imageurl>(.*?)<\/hatena:imageurl>/)?.[1] || null;

      if (title && link) {
        const bookmarks = parseInt(countStr, 10);
        const textToAnalyze = `${title} ${desc}`;
        const { lifeScore, gadgetScore, totalScore } = calculateScores(textToAnalyze);

        items.push({
          sourceType: 'hatena_life',
          title,
          link,
          bookmarks,
          description: desc,
          image,
          lifeScore,
          gadgetScore,
          score: bookmarks * 1.2 + totalScore * 3,
          sourceName: 'はてなブックマーク（暮らし）'
        });
      }
    }

    items.sort((a, b) => b.score - a.score);
    return items;
  } catch (e) {
    console.warn('⚠️ はてなブックマーク（暮らし）の取得に失敗しました:', e.message);
    return [];
  }
}

// 2. はてなブックマーク（テクノロジー人気エントリ）
async function fetchHatenaTechTrends() {
  console.log('📡 はてなブックマーク（テクノロジー）人気RSSを取得中...');
  try {
    const res = await fetch('https://b.hatena.ne.jp/hotentry/it.rss');
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item\b[\s\S]*?<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const content = match[0];
      const title = decodeXml(content.match(/<title>(.*?)<\/title>/)?.[1] || '');
      const link = content.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const countStr = content.match(/<hatena:bookmarkcount>(.*?)<\/hatena:bookmarkcount>/)?.[1] || '0';
      const desc = decodeXml(content.match(/<description>(.*?)<\/description>/)?.[1] || '');
      const image = content.match(/<hatena:imageurl>(.*?)<\/hatena:imageurl>/)?.[1] || null;

      if (title && link) {
        const bookmarks = parseInt(countStr, 10);
        const textToAnalyze = `${title} ${desc}`;
        const { lifeScore, gadgetScore, totalScore } = calculateScores(textToAnalyze);

        if (gadgetScore > 0 || lifeScore > 0) {
          items.push({
            sourceType: 'hatena_tech',
            title,
            link,
            bookmarks,
            description: desc,
            image,
            lifeScore,
            gadgetScore,
            score: bookmarks + totalScore * 3,
            sourceName: 'はてなブックマーク（ガジェット・IT）'
          });
        }
      }
    }

    items.sort((a, b) => b.score - a.score);
    return items;
  } catch (e) {
    console.warn('⚠️ はてなブックマーク（テクノロジー）の取得に失敗しました:', e.message);
    return [];
  }
}

// 3. Google Trends RSS（急上昇ワード）
async function fetchGoogleTrends() {
  console.log('📡 Google Trends (JP) から急上昇トピックを取得中...');
  try {
    const res = await fetch('https://trends.google.com/trending/rss?geo=JP');
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemContent = match[1];
      const titleMatch = itemContent.match(/<title>(.*?)<\/title>/);
      const trafficMatch = itemContent.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/);
      const pictureMatch = itemContent.match(/<ht:picture>(.*?)<\/ht:picture>/);

      const title = decodeXml(titleMatch ? titleMatch[1] : '');
      const { lifeScore, gadgetScore, totalScore } = calculateScores(title);

      if (title && totalScore > 0) {
        const newsItems = [];
        const newsRegex = /<ht:news_item>([\s\S]*?)<\/ht:news_item>/g;
        let nMatch;
        while ((nMatch = newsRegex.exec(itemContent)) !== null) {
          const nContent = nMatch[1];
          const nTitle = nContent.match(/<ht:news_item_title>(.*?)<\/ht:news_item_title>/)?.[1] || '';
          const nUrl = nContent.match(/<ht:news_item_url>(.*?)<\/ht:news_item_url>/)?.[1] || '';
          const nSource = nContent.match(/<ht:news_item_source>(.*?)<\/ht:news_item_source>/)?.[1] || '';
          if (nTitle && nUrl) {
            newsItems.push({ title: decodeXml(nTitle), url: nUrl, source: decodeXml(nSource) });
          }
        }

        items.push({
          sourceType: 'google_trends',
          title,
          traffic: trafficMatch ? trafficMatch[1] : '注目',
          picture: pictureMatch ? pictureMatch[1] : null,
          lifeScore,
          gadgetScore,
          score: 100 + totalScore * 5,
          news: newsItems,
          sourceName: 'Google急上昇トレンド'
        });
      }
    }

    return items;
  } catch (e) {
    console.warn('⚠️ Google Trends の取得に失敗しました:', e.message);
    return [];
  }
}

// カテゴリ判定
function determineCategories(topic) {
  const life = topic.lifeScore || 0;
  const gadget = topic.gadgetScore || 0;

  if (life > gadget && life > 0) {
    return ['ライフスタイル'];
  } else if (gadget > life && gadget > 0) {
    return ['IT・ガジェット'];
  } else if (gadget > 0 && life > 0) {
    return ['ライフスタイル', 'IT・ガジェット'];
  }
  return ['ライフスタイル'];
}

// スラッグ生成 (日付-キーワード-短縮ハッシュ)
function generateSlug(topic, dateInfo) {
  const words = (topic.title.match(/[a-zA-Z0-9]+/g) || [])
    .filter(w => w.length >= 3 && !/^\d+$/.test(w))
    .slice(0, 3)
    .map(w => w.toLowerCase());

  const hashSource = topic.link || topic.title;
  const hash = crypto.createHash('md5').update(hashSource).digest('hex').slice(0, 6);

  if (words.length > 0) {
    return `${dateInfo.dateStr}-${words.join('-')}-${hash}`;
  }
  return `${dateInfo.dateStr}-trend-${hash}`;
}

// 既存記事との重複チェック
function isDuplicateTopic(topic, blogDir) {
  const dirs = fs.readdirSync(blogDir);
  const targetLink = topic.link || topic.news?.[0]?.url || '';

  for (const dir of dirs) {
    const indexPath = path.join(blogDir, dir, 'index.mdx');
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, 'utf-8');
      // リンクの一致、または同一タイトルの含有をチェック
      if (targetLink && content.includes(targetLink)) {
        return true;
      }
      if (topic.title.length > 10 && content.includes(topic.title.slice(0, 15))) {
        return true;
      }
    }
  }
  return false;
}

// 1話題に特化した Gemini API 記事執筆
async function generateSingleArticleWithGemini(topic, dateInfo, categories) {
  if (!GEMINI_API_KEY) {
    console.log('⚠️ GEMINI_API_KEY が未設定のため、親しみやすいブロガー風フォールバック記事を生成します。');
    return generateSingleFallbackArticle(topic, dateInfo, categories);
  }

  console.log(`🤖 Gemini で【1話題深掘り・yomilee等身大ブロガー風】記事を執筆中: "${topic.title.slice(0, 25)}..."`);

  const topicData = `タイトル: ${topic.title}
情報源: ${topic.sourceName || '話題のトピック'} (${topic.bookmarks ? topic.bookmarks + 'ブクマ' : topic.traffic})
URL: ${topic.link || topic.news?.[0]?.url || ''}
概要・抜粋: ${topic.description || topic.news?.map(n => n.title).join(' / ') || ''}`;

  const systemInstruction = `あなたは暮らしとガジェットの体験談ブログ「yomileeblog（ヨミリーブログ）」の運営者「yomilee」です。
読者に寄り添う親しみやすく等身大の語り口で、提示された【1つの話題・トレンド】を深く・わかりやすく・読者目線で掘り下げた単体ブログ記事（1話題1記事）を執筆してください。

【ペルソナと文体ルール】
1. **親しみやすさと等身大の共感**:
   - 語り口: 「〜ですよね」「〜してみてはいかがでしょうか」「実際に気になったので詳しくチェックしてみました」「日々の暮らしや買い物がちょっと快適になりそうですね」など、温かみがあり丁寧なブログ調。
   - 硬いニュース報道調（「〜と報じられた」「今後の展開が期待される」）や、AI特有の不自然な定型句（「いかがでしたでしょうか」）は使わないこと。
2. **読者目線の実用性と本音**:
   - 単なるニュースの要約ではなく、「結局、自分の生活や家計にどう役立つのか？」「どんな人におすすめなのか？」「ちょっと注意したい点はあるか？」を等身大の目線で率直に解説。
3. **キャッチーでわかりやすい個別記事タイトル**:
   - 日付や「トレンドまとめ」といった文言はタイトルに入れないこと！
   - テーマの魅力を前面に出し、読者が思わず読みたくなる具体的なタイトル（32〜45文字程度）。
   - 例: 「100均耐熱ガラスの落とし穴？お湯で割れる事故を防ぐ注意点と安全な選び方」
   - 例: 「日本で買える本当においしいキムチはどれ？本場の見分け方とおすすめまとめ」

【記事構成ルール】
- **Frontmatter**:
  title: キャッチーな個別記事タイトル（日付や「まとめ」は含めない）
  description: 110〜130文字程度で、読者の好奇心をそそる導入要約
  pubDate: "${dateInfo.dateStr}"
  categories: ${JSON.stringify(categories)}
  heroImage: "./hero.jpg"
- **導入部**:
  - ブロガーらしい親しみやすい導入の挨拶と、その話題に興味を持ったきっかけ
  - <ProblemBox> コンポーネントを配置（読者が「まさにそれが知りたかった」「気になっていた」と感じる悩みや関心を3〜4項目）
- **本文セクション**:
  - H2見出し 3〜4つで構成（読者の疑問を順序立てて解決）:
    - H2: 「何が話題になっている？概要と注目の背景」
    - H2: 「日々の暮らしや生活はどう変わる？注目のメリットと活かし方」
    - H2: 「知っておきたい注意点や失敗しないコツ（おすすめな人）」
    - H2: 「まとめと一次情報リンク」
  - 一次情報リンク: [元記事や詳細はこちら](${topic.link || topic.news?.[0]?.url || ''})
- **まとめ部**:
  - <ConclusionBox> コンポーネントを配置（記事の要点まとめ3点・今日から試せるワンアクション）
- **HTML/MDX構文**:
  - <br />、<hr />などは必ず自己閉じタグにすること。
  - 出力はMarkdown本文のみ（Frontmatter含む、\`\`\`mdx のコードブロックで囲まないこと）。`;

  const userPrompt = `日付: ${dateInfo.formattedJa}（${dateInfo.dateStr}）

【取り上げる話題】
${topicData}

上記の1つの話題を徹底的に料理して、読者が「読んでよかった！」「参考になった！」と感じる充実したyomileeblog記事を1本執筆してください！`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

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
    const errorText = await response.text();
    throw new Error(`Gemini API呼び出しエラー (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  let generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!generatedText) {
    throw new Error('Gemini APIからテキストが取得できませんでした。');
  }

  generatedText = generatedText.replace(/^```(?:mdx|markdown)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
  return generatedText;
}

// 1話題に特化したフォールバック記事生成（APIキー未設定時でも高品質）
function generateSingleFallbackArticle(topic, dateInfo, categories) {
  let mainCleanTitle = topic.title.replace(/[-|].*$/, '').trim();
  mainCleanTitle = mainCleanTitle.replace(/^[「『"']/, '').replace(/[」』"']$/, '').trim();
  const displayTitle = mainCleanTitle.length > 26 ? mainCleanTitle.slice(0, 25) + '…' : mainCleanTitle;

  const title = `【話題】「${displayTitle}」とは？暮らしへの役立て方と知っておきたいポイント`;
  const description = `ネットやSNSでいま大きな話題を集めている「${displayTitle}」について、等身大ブロガー目線で徹底解説！気になる概要から日々の生活への取り入れ方、注意点まで分かりやすくお届けします。`;

  let mdx = `---
title: "${title}"
description: "${description}"
pubDate: "${dateInfo.dateStr}"
categories: ${JSON.stringify(categories)}
heroImage: "./hero.jpg"
---
import ProblemBox from '../../../components/ProblemBox.astro';
import ConclusionBox from '../../../components/ConclusionBox.astro';

こんにちは、yomileeです！

日々の暮らしやSNSを見ていると、<b>「これ、生活がちょっと便利になりそう！」「知っておくと役立つ！」</b>と思える面白い話題や発見がたくさんありますよね。

今回は、いまネットやコミュニティで特に大きな関心を集めている<b>「${mainCleanTitle}」</b>について、等身大ブロガーの目線で詳しく深掘りしてみたいと思います。

<ProblemBox>
- 「${displayTitle}」が話題になっているけれど、具体的に何がポイントなの？
- 自分の普段の暮らしや生活にどう活かせるのか知りたい
- 取り入れる際の注意点や失敗しないコツを事前にチェックしておきたい
</ProblemBox>

それでは、気になる詳細をさっそく見ていきましょう！

---

## 🌟 何が話題になっている？注目の背景と概要

本日、ネットやSNSで特に多くの反響を集めているのがこちらの話題です。

${topic.description ? `> ${topic.description}\n\n` : ''}

この話題がこれほど注目されている背景には、**「日々の生活の中にあるちょっとした疑問や不便に対して、共感できるリアルな解決策や知恵が提示されている」**という点があります。

- **誰もが感じていた疑問の言語化**: 「それ、自分も気になっていた！」という身近なテーマ
- **実践しやすい身近な工夫**: 特別な道具や高価な出費なしで今日から役立つ情報
- **リアルな体験談の価値**: 理屈だけでなく、実際に試したからこそ分かる生の声

---

## 💡 日々の暮らしや生活はどう変わる？取り入れるメリット

実際にこの知恵やツールを生活に取り入れてみると、日々のちょっとしたストレスや時間の無駄を減らすきっかけになりそうです。

### 1. 手間や悩みの削減
普段なんとなく行っていた作業や買い物の選び方に明確な基準ができるため、迷う時間をぐっと短縮できます。

### 2. 生活の満足度アップ
無理のない範囲で暮らしのクオリティを高められるため、日々の生活がちょっと心地よく、前向きな気持ちになれますね。

---

## ⚠️ 知っておきたい注意点やおすすめな人

とても魅力的な話題ですが、取り入れる際にはいくつか気をつけたいポイントもあります。

- **自分の環境に合わせてアレンジする**: 全てをそのまま真似するのではなく、自分や家庭のライフスタイルに合う部分を選んで取り入れるのが長続きのコツです。
- **過度な期待は禁物**: あくまで日々の暮らしをサポートする工夫のひとつとして、気軽な気持ちで試してみるのがおすすめです。

👉 **元記事・一次情報で詳細をチェック**:  
<a href="${topic.link || topic.news?.[0]?.url || '#'}" target="_blank" rel="noopener noreferrer">${topic.title}</a>

---

<ConclusionBox>
- 本日は注目を集める「${displayTitle}」について、暮らしへの役立て方や知っておきたいポイントをご紹介しました。
- 気になった方は、ぜひ無理のない範囲で日常の中に取り入れてみてくださいね。
- 次回も暮らしを豊かにする身近な気づきをお届けします！
</ConclusionBox>
`;

  return mdx;
}

// サムネイル画像（hero.jpg）の取得・保存
async function prepareHeroImage(targetDir, imageUrl) {
  const heroPath = path.join(targetDir, 'hero.jpg');

  if (imageUrl) {
    try {
      console.log(`🖼️ サムネイル画像をダウンロード中: ${imageUrl}`);
      const res = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > 500) {
          fs.writeFileSync(heroPath, Buffer.from(buffer));
          console.log(`✅ hero.jpg を保存しました (${buffer.byteLength} bytes)`);
          return;
        }
      }
    } catch (e) {
      console.warn('⚠️ サムネイル画像の取得に失敗しました。フォールバック画像を適用します。', e.message);
    }
  }

  // フォールバックJPEG
  const minimalJpgBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  fs.writeFileSync(heroPath, Buffer.from(minimalJpgBase64, 'base64'));
  console.log('✅ フォールバック hero.jpg を保存しました');
}

// 安全なGitコミット＆プッシュ（複数記事一括対応）
function performAutoPush(createdSlugs) {
  console.log('\n🔒 === 安全なGitコミット＆プッシュを開始 ===');

  if (!createdSlugs || createdSlugs.length === 0) {
    console.log('ℹ️ プッシュ対象の記事がありません。');
    return true;
  }

  // 1. リモートURLの照合
  try {
    const remoteOutput = execSync('git remote -v', { cwd: YOMILEE_ROOT, encoding: 'utf-8' });
    const isTargetRepo = remoteOutput.includes('teluis5/yomilee');
    if (!isTargetRepo) {
      throw new Error(`リモートURLが teluis5/yomilee と一致しません！誤爆防止のためプッシュを中断します:\n${remoteOutput}`);
    }
    console.log('✅ リモートURL照合OK: yomilee リポジトリを確認しました。');
  } catch (err) {
    console.error('❌ リモートURL照合エラー:', err.message);
    return false;
  }

  // 2. ステージング & コミット & プッシュ
  try {
    for (const slug of createdSlugs) {
      const targetRel = `src/content/blog/${slug}`;
      console.log(`📦 ステージング中: ${targetRel}`);
      execSync(`git add "${targetRel}"`, { cwd: YOMILEE_ROOT, stdio: 'inherit' });
    }

    // ステータス確認
    const status = execSync('git status --porcelain', { cwd: YOMILEE_ROOT, encoding: 'utf-8' });
    if (!status.trim()) {
      console.log('ℹ️ コミットする新しい差分がありません。');
      return true;
    }

    const commitMsg = `feat(yomilee): add ${createdSlugs.length} daily trend article(s) (${createdSlugs[0].slice(0, 10)})`;
    console.log(`💬 コミット実行: "${commitMsg}"`);
    execSync(`git commit -m "${commitMsg}"`, { cwd: YOMILEE_ROOT, stdio: 'inherit' });

    console.log('🚀 リモート (origin main) へプッシュ中...');
    execSync('git push origin main', { cwd: YOMILEE_ROOT, stdio: 'inherit' });

    console.log('🎉 Gitプッシュが完了しました！GitHub Pagesの自動デプロイが開始されます。');
    return true;
  } catch (err) {
    console.error('❌ Gitプッシュ処理中にエラーが発生しました:', err.message);
    return false;
  }
}

// メイン処理
async function main() {
  console.log(`🚀 === yomileeblog 【1話題1記事】トレンド自動生成 (上限: ${targetLimit}記事) ===`);
  const dateInfo = getJSTDate();
  console.log(`📅 対象日付: ${dateInfo.dateStr} (${dateInfo.formattedJa})`);
  console.log(`🔑 Gemini APIキー状態: ${GEMINI_API_KEY ? '設定済み ✅' : '未設定（フォールバックモード） ⚠️'}`);

  // 1. はてブ（暮らし）の取得
  const hatenaLifeTopics = await fetchHatenaLifeTrends();
  console.log(`📊 取得したはてブ（暮らし）候補: ${hatenaLifeTopics.length}件`);

  // 2. はてブ（テクノロジー・日常ガジェット）の取得
  const hatenaTechTopics = await fetchHatenaTechTrends();
  console.log(`📊 取得したはてブ（テック・ガジェット）候補: ${hatenaTechTopics.length}件`);

  // 3. Google Trends の取得
  const googleTrendsTopics = await fetchGoogleTrends();
  console.log(`📊 取得したGoogle急上昇（生活・ガジェット）候補: ${googleTrendsTopics.length}件`);

  // 統合・スコア順候補リスト
  const allCandidates = [];
  googleTrendsTopics.forEach(t => allCandidates.push(t));
  hatenaLifeTopics.forEach(t => {
    if (!allCandidates.some(c => c.title === t.title)) allCandidates.push(t);
  });
  hatenaTechTopics.forEach(t => {
    if (!allCandidates.some(c => c.title === t.title)) allCandidates.push(t);
  });

  if (allCandidates.length === 0) {
    console.error('❌ 暮らし・ガジェット関連のトレンド情報を取得できませんでした。');
    process.exit(1);
  }

  // 重複排除しながら targetLimit 件を選定
  const blogDir = path.join(YOMILEE_ROOT, 'src', 'content', 'blog');
  const selectedTopics = [];

  for (const candidate of allCandidates) {
    if (selectedTopics.length >= targetLimit) break;

    // 重複チェック
    if (!isForce && isDuplicateTopic(candidate, blogDir)) {
      console.log(`⏭️ 既存記事と重複のためスキップ: "${candidate.title.slice(0, 25)}..."`);
      continue;
    }

    selectedTopics.push(candidate);
  }

  if (selectedTopics.length === 0) {
    console.log('ℹ️ 新規に作成可能な未執筆トレンド記事はありませんでした。');
    return;
  }

  console.log(`\n🎯 今回生成する話題: ${selectedTopics.length}件`);
  const createdSlugs = [];

  for (let i = 0; i < selectedTopics.length; i++) {
    const topic = selectedTopics[i];
    const categories = determineCategories(topic);
    const slug = generateSlug(topic, dateInfo);
    const targetDir = path.join(blogDir, slug);

    console.log(`\n--- [記事 ${i + 1}/${selectedTopics.length}] ---`);
    console.log(`📌 話題: ${topic.title}`);
    console.log(`📁 スラッグ: ${slug}`);
    console.log(`📂 カテゴリ: ${categories.join(', ')}`);

    if (fs.existsSync(targetDir) && !isForce) {
      console.log(`ℹ️ すでにディレクトリが存在します: ${slug} (スキップ)`);
      continue;
    }

    fs.mkdirSync(targetDir, { recursive: true });

    // サムネイル画像保存
    const imageUrl = topic.image || topic.picture;
    await prepareHeroImage(targetDir, imageUrl);

    // 記事本文の生成
    let articleMdx = '';
    if (isDryRun) {
      console.log('🧪 --dry-run モード: yomilee風個別フォールバック記事を生成します。');
      articleMdx = generateSingleFallbackArticle(topic, dateInfo, categories);
    } else {
      articleMdx = await generateSingleArticleWithGemini(topic, dateInfo, categories);
    }

    // ファイル書き出し
    const mdxPath = path.join(targetDir, 'index.mdx');
    fs.writeFileSync(mdxPath, articleMdx, 'utf-8');
    console.log(`💾 記事を保存しました: ${mdxPath}`);

    createdSlugs.push(slug);
  }

  // 自動Gitプッシュ
  if (isAutoPush && createdSlugs.length > 0) {
    performAutoPush(createdSlugs);
  } else if (createdSlugs.length > 0) {
    console.log('\n💡 コミット＆プッシュまで自動実行する場合は --auto-push を指定してください。');
  }

  console.log('\n🎉 すべての処理が完了しました！');
}

main().catch(err => {
  console.error('❌ エラーが発生しました:', err);
  process.exit(1);
});
