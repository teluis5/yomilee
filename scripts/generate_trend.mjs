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

// ジャンル指定: all, news, tech, ai, product, lifestyle
const genreArg = args.find(a => a.startsWith('--genre='))?.split('=')[1]?.toLowerCase() || 'all';

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
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim();
}

// 共通HTTPリクエスト用ヘッダー
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

// -------------------------------------------------------------
// 各種情報収集フェッチャー
// -------------------------------------------------------------

// 1. Yahoo!ニュース（主要トピックス / ITニュース）
async function fetchYahooNews(type = 'top-picks') {
  const url = `https://news.yahoo.co.jp/rss/topics/${type}.xml`;
  const label = type === 'it' ? 'Yahoo! ITニュース' : 'Yahoo! 主要ニュース';
  console.log(`📡 ${label} を取得中...`);
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item\b[\s\S]*?<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const content = match[0];
      const title = decodeXml(content.match(/<title>(.*?)<\/title>/)?.[1] || '');
      const link = decodeXml(content.match(/<link>(.*?)<\/link>/)?.[1] || '');

      if (title && link) {
        items.push({
          sourceType: `yahoo_${type}`,
          title,
          link,
          description: '',
          image: null,
          genreHint: type === 'it' ? 'tech' : 'news',
          score: 80,
          sourceName: label
        });
      }
    }
    return items;
  } catch (e) {
    console.warn(`⚠️ ${label} の取得に失敗しました:`, e.message);
    return [];
  }
}

// 2. PR TIMES（新商品・新サービス・注目発表）
async function fetchPRTimes() {
  console.log('📡 PR TIMES（新商品・新サービス発表）を取得中...');
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

      // 画像URLをdescriptionまたはタグから抽出
      const imgMatch = descRaw.match(/https:\/\/prcdn\.freetls\.fastly\.net\/release_image\/[^\s\"\'\<\>]+/i) ||
                       content.match(/<image>(.*?)<\/image>/i);
      const image = imgMatch ? imgMatch[0] : null;

      // 新商品・新発売・新機能・先行予約・限定などのキーワード判定
      const isProduct = /新発売|新登場|発売|先行|発表|新商品|新モデル|新サービス|誕生|開始|リニューアル|オープン/i.test(title);

      if (title && link && isProduct) {
        // descriptionから画像テキスト等を除去して簡潔に
        const cleanDesc = descRaw.replace(/\[画像\d+:[^\]]+\]/g, '').replace(/\[[^\]]+株式会社\]/g, '').trim().slice(0, 150);

        items.push({
          sourceType: 'prtimes',
          title,
          link,
          description: cleanDesc,
          image,
          genreHint: 'product',
          score: 85,
          sourceName: 'PR TIMES 新商品・新サービス'
        });
      }
    }
    return items;
  } catch (e) {
    console.warn('⚠️ PR TIMES の取得に失敗しました:', e.message);
    return [];
  }
}

// 3. はてなブックマーク（総合・テクノロジー・暮らし）
async function fetchHatena(category = 'life') {
  const urlMap = {
    general: 'https://b.hatena.ne.jp/hotentry.rss',
    it: 'https://b.hatena.ne.jp/hotentry/it.rss',
    life: 'https://b.hatena.ne.jp/hotentry/life.rss'
  };
  const labelMap = {
    general: 'はてなブックマーク（総合人気）',
    it: 'はてなブックマーク（テクノロジー・AI）',
    life: 'はてなブックマーク（暮らし・生活）'
  };

  const url = urlMap[category] || urlMap.life;
  const label = labelMap[category] || labelMap.life;
  console.log(`📡 ${label} を取得中...`);

  try {
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item\b[\s\S]*?<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const content = match[0];
      const title = decodeXml(content.match(/<title>(.*?)<\/title>/)?.[1] || '');
      const link = decodeXml(content.match(/<link>(.*?)<\/link>/)?.[1] || '');
      const countStr = content.match(/<hatena:bookmarkcount>(.*?)<\/hatena:bookmarkcount>/)?.[1] || '0';
      const desc = decodeXml(content.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '');
      const image = content.match(/<hatena:imageurl>(.*?)<\/hatena:imageurl>/)?.[1] || null;

      if (title && link) {
        const bookmarks = parseInt(countStr, 10);
        const genreHint = category === 'it' ? 'tech' : (category === 'general' ? 'news' : 'lifestyle');

        items.push({
          sourceType: `hatena_${category}`,
          title,
          link,
          bookmarks,
          description: desc,
          image,
          genreHint,
          score: bookmarks + 30,
          sourceName: label
        });
      }
    }

    items.sort((a, b) => b.score - a.score);
    return items;
  } catch (e) {
    console.warn(`⚠️ ${label} の取得に失敗しました:`, e.message);
    return [];
  }
}

// 4. Google Trends (急上昇)
async function fetchGoogleTrends() {
  console.log('📡 Google Trends (JP) から急上昇ワードを取得中...');
  try {
    const res = await fetch('https://trends.google.com/trending/rss?geo=JP', { headers: FETCH_HEADERS });
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

      if (title) {
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
          traffic: trafficMatch ? trafficMatch[1] : '急上昇',
          picture: pictureMatch ? pictureMatch[1] : null,
          genreHint: 'news',
          score: 110,
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

// -------------------------------------------------------------
// カテゴリ自動判定ロジック
// -------------------------------------------------------------
function determineCategories(topic) {
  const text = `${topic.title} ${topic.description || ''}`;

  // AI・テクノロジー・IT
  const isTech = /AI|ChatGPT|Claude|Gemini|OpenAI|生成AI|LLM|プログラミング|スマホ|iPhone|Android|Pixel|Galaxy|格安SIM|povo|通信|ガジェット|スマートウォッチ|アプリ|Web|PC|MacBook|Windows|ソフトウェア|脆弱性/i.test(text);

  // 旅行・おでかけ・観光
  const isTravel = /旅行|観光|おでかけ|ホテル|温泉|イルミネーション|紅葉|桜|スポット|京都|東京|北海道|飛行機|新幹線|空港|カフェ|グルメ/i.test(text);

  // 新商品・暮らし・生活
  const isLifestyle = /暮らし|生活|節約|家計|コストコ|無印|100均|ニトリ|カルディ|楽天|Amazon|新発売|新商品|家電|料理|レシピ|健康|睡眠|片付け|掃除|防災|育児/i.test(text);

  if (isTech && isLifestyle) {
    return ['IT・ガジェット', 'ライフスタイル'];
  } else if (isTech) {
    return ['IT・ガジェット'];
  } else if (isTravel) {
    return ['旅行'];
  } else {
    return ['ライフスタイル'];
  }
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

// -------------------------------------------------------------
// 1話題に特化した Gemini API 記事執筆（AI・ニュース・新商品対応）
// -------------------------------------------------------------
async function generateSingleArticleWithGemini(topic, dateInfo, categories) {
  if (!GEMINI_API_KEY) {
    console.log('⚠️ GEMINI_API_KEY が未設定のため、親しみやすいブロガー風フォールバック記事を生成します。');
    return generateSingleFallbackArticle(topic, dateInfo, categories);
  }

  console.log(`🤖 Gemini で【1話題深掘り・yomilee等身大ブロガー風】記事を執筆中: "${topic.title.slice(0, 25)}..."`);

  const topicData = `タイトル: ${topic.title}
情報源: ${topic.sourceName || '話題のトピック'}
URL: ${topic.link || topic.news?.[0]?.url || ''}
概要・抜粋: ${topic.description || topic.news?.map(n => n.title).join(' / ') || ''}`;

  const systemInstruction = `あなたは暮らし・ガジェット・話題の情報を発信する人気ブログ「yomileeblog（ヨミリーブログ）」の運営者「yomilee」です。
読者に寄り添う親しみやすく等身大の語り口で、提示された【1つの話題（トップニュース、最新AI・テクノロジー、注目の新商品、暮らしのトレンドなど）】を深く・わかりやすく・読者目線で掘り下げた単独ブログ記事（1話題1記事）を執筆してください。

【ペルソナと文体ルール】
1. **親しみやすさと読者目線の共感**:
   - 語り口: 「〜ですよね」「〜してみてはいかがでしょうか」「実際に気になったので詳しく調べてみました」「日々の生活やお買い物がちょっと快適になりそうですね」など、温かみがあり丁寧なブログ調。
   - 硬いニュース報道調（「〜と報じられた」「今後の展開が期待される」）や、AI特有の不自然な定型句（「いかがでしたでしょうか」）は使わないこと。
2. **テーマに応じた実用的な切り口**:
   - **AI・テクノロジーの場合**: 難解な専門用語を避け、「結局、僕たちの仕事や日常作業の何がラクになるのか？」「無料で試せるか？導入の手順は？」など、等身大の実践目線で解説。
   - **新商品・新製品の場合**: 「何が新しくなったのか？」「既存モデルや他社製品との決定的な違いは？」「どんな人におすすめで、買いなのか？」という本音目線。
   - **トップニュース・時事の場合**: 「私たちの普段の暮らしや家計にどう関わってくるのか？」「今押さえておきたい要点」を整理。
3. **キャッチーでわかりやすい個別記事タイトル**:
   - 日付や「まとめ」といった事務的な文言はタイトルに入れないこと！
   - 読者の興味を惹きつける具体的で魅力的なタイトル（32〜45文字程度）。
   - 例: 「〇〇が新登場！何が進化した？買い替えるべき理由と気になる注意点」
   - 例: 「話題の最新AI『〇〇』とは？日々の作業が爆速化する活用法と使ってみた感想」

【記事構成ルール】
- **Frontmatter**:
  title: キャッチーな個別記事タイトル（日付や「まとめ」は含めない）
  description: 110〜130文字程度で、読者の好奇心をそそる導入要約
  pubDate: "${dateInfo.dateStr}"
  categories: ${JSON.stringify(categories)}
  heroImage: "./hero.jpg"
- **導入部**:
  - ブロガーらしい親しみやすい導入の挨拶と、その話題に興味を持ったきっかけ
  - <ProblemBox> コンポーネントを配置（読者が「まさにそれが知りたかった」「気になっていた」と感じる疑問や関心を3〜4項目）
- **本文セクション**:
  - H2見出し 3〜4つで構成（読者の疑問を順序立てて解決）:
    - H2: 「何が起きている？注目の背景と概要」
    - H2: 「日々の暮らしや仕事はどう変わる？注目のメリットと活かし方」
    - H2: 「知っておきたい注意点やおすすめな人（選び方のポイント）」
    - H2: 「まとめと一次情報リンク」
  - 一次情報リンク: [元記事や公式発表はこちら](${topic.link || topic.news?.[0]?.url || ''})
- **まとめ部**:
  - <ConclusionBox> コンポーネントを配置（記事の要点まとめ3点・今日から試せるワンアクション）
- **HTML/MDX構文**:
  - <br />、<hr />などは必ず自己閉じタグにすること。
  - 出力はMarkdown本文のみ（Frontmatter含む、\`\`\`mdx のコードブロックで囲まないこと）。`;

  const userPrompt = `日付: ${dateInfo.formattedJa}（${dateInfo.dateStr}）

【取り上げる話題】
${topicData}

上記の話題を徹底的に料理して、読者が「読んでよかった！」「生活に役立ちそう！」と感じる充実したyomileeblog記事を1本執筆してください！`;

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

  const isProduct = categories.includes('ライフスタイル') && /新発売|発売|新登場|登場|限定|新商品/i.test(topic.title);
  const isTech = categories.includes('IT・ガジェット');

  let title = `【注目】「${displayTitle}」とは？暮らしへの役立て方と知っておきたいポイント`;
  if (isProduct) {
    title = `【新登場】「${displayTitle}」の特徴・魅力と気になるポイントを徹底解説！`;
  } else if (isTech) {
    title = `【注目テクノロジー】「${displayTitle}」のメリット・活用法と生活への影響`;
  }

  const description = `ネットやSNSで話題の「${displayTitle}」について、等身大ブロガー目線でわかりやすく徹底解説！気になる概要から日々の生活や作業への活かし方、注意点までお届けします。`;

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

日々の生活やネットを見ていると、<b>「これ、生活がちょっと便利になりそう！」「知っておくと役立つ！」</b>と思える面白い新製品やテクノロジー、話題がたくさんありますよね。

今回は、いまネットやメディアで大きな注目を集めている<b>「${mainCleanTitle}」</b>について、等身大ブロガーの目線で詳しく深掘りしてみたいと思います。

<ProblemBox>
- 「${displayTitle}」が話題になっているけれど、具体的に何が凄いの？
- 自分の普段の生活や仕事、家計にどう役立つのか知りたい
- 取り入れる際の注意点や失敗しないコツを事前にチェックしておきたい
</ProblemBox>

それでは、気になる詳細をさっそくチェックしていきましょう！

---

## 🌟 何が話題になっている？注目の背景と概要

本日、ネットやメディアで特に多くの反響を集めているのがこちらの話題です。

${topic.description ? `> ${topic.description}\n\n` : ''}

この話題が注目されている背景には、**「日々の生活の中にあるちょっとした不便や疑問に対して、新しい価値や実践的な解決策が提示されている」**という点があります。

- **身近な課題へのアプローチ**: 「それ、気になっていた！」と感じる身近なテーマ
- **すぐに役立つ実用性**: 高度すぎる話ではなく、日々の暮らしや買い物に直結する内容
- **今後の動向にも期待**: 今後の普及やアップデートでさらに生活が便利になる可能性

---

## 💡 日々の暮らしや日常はどう変わる？取り入れるメリット

実際にこの話題や製品、サービスを生活に取り入れてみると、日々のちょっとしたストレスや作業の無駄を減らす大きなきっかけになりそうです。

### 1. 作業や生活の効率化
これまで時間がかかっていた作業や選び方に明確な基準ができるため、日々の生活をよりスマートに整えることができます。

### 2. 暮らしの快適さ・満足度アップ
無理のない範囲で新しい知恵や便利アイテムを取り入れることで、毎日の生活が一段と心地よく、前向きな気持ちになれますね。

---

## ⚠️ 知っておきたい注意点やおすすめな人

とても魅力的な話題ですが、取り入れる際にはいくつか気をつけたいポイントもあります。

- **自分のライフスタイルに合わせて選ぶ**: 話題になっているからといって無理に全部を取り入れるのではなく、自分に合った部分を見極めるのが大切です。
- **今後の口コミや情報もチェック**: 発売直後や新発表の場合は、実際のユーザーの声や続報もあわせて追っていくのが賢い付き合い方です。

👉 **元記事・公式情報で詳細をチェック**:  
<a href="${topic.link || topic.news?.[0]?.url || '#'}" target="_blank" rel="noopener noreferrer">${topic.title}</a>

---

<ConclusionBox>
- 本日は注目の「${displayTitle}」について、暮らしへの役立て方や知っておきたいポイントをご紹介しました。
- 気になった方は、ぜひ無理のない範囲で日常の中に取り入れてみてくださいね。
- 次回も暮らしやデジタル生活を豊かにする身近な気づきをお届けします！
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
      const res = await fetch(imageUrl, { headers: FETCH_HEADERS });
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

    const commitMsg = `feat(yomilee): add ${createdSlugs.length} daily article(s) (${createdSlugs[0].slice(0, 10)})`;
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

// -------------------------------------------------------------
// メイン処理
// -------------------------------------------------------------
async function main() {
  console.log(`🚀 === yomileeblog 自動記事生成 (ジャンル: ${genreArg}, 上限: ${targetLimit}記事) ===`);
  const dateInfo = getJSTDate();
  console.log(`📅 対象日付: ${dateInfo.dateStr} (${dateInfo.formattedJa})`);
  console.log(`🔑 Gemini APIキー状態: ${GEMINI_API_KEY ? '設定済み ✅' : '未設定（フォールバックモード） ⚠️'}`);

  const candidatePool = [];

  // ジャンルに応じた情報収集
  if (genreArg === 'all' || genreArg === 'news') {
    const yahooTop = await fetchYahooNews('top-picks');
    const hatenaGeneral = await fetchHatena('general');
    const googleTrends = await fetchGoogleTrends();
    candidatePool.push(...yahooTop, ...hatenaGeneral, ...googleTrends);
  }

  if (genreArg === 'all' || genreArg === 'tech' || genreArg === 'ai') {
    const hatenaTech = await fetchHatena('it');
    const yahooIT = await fetchYahooNews('it');
    candidatePool.push(...hatenaTech, ...yahooIT);
  }

  if (genreArg === 'all' || genreArg === 'product') {
    const prtimes = await fetchPRTimes();
    candidatePool.push(...prtimes);
  }

  if (genreArg === 'all' || genreArg === 'lifestyle') {
    const hatenaLife = await fetchHatena('life');
    candidatePool.push(...hatenaLife);
  }

  // 重複排除とスコアリング
  const uniqueCandidates = [];
  for (const item of candidatePool) {
    if (!uniqueCandidates.some(c => c.title === item.title || (c.link && c.link === item.link))) {
      uniqueCandidates.push(item);
    }
  }

  // スコア順にソート（画像ありボーナス ＋ 指定ジャンル適合ブースト）
  uniqueCandidates.sort((a, b) => {
    let aScore = a.score + (a.image || a.picture ? 15 : 0);
    let bScore = b.score + (b.image || b.picture ? 15 : 0);

    if (genreArg === 'ai' || genreArg === 'tech') {
      const techPattern = /AI|ChatGPT|Claude|Gemini|OpenAI|生成AI|LLM|スマホ|iPhone|Android|Pixel|Galaxy|ガジェット|アプリ|新機能|ツール|Apple|Google|Microsoft/i;
      if (techPattern.test(a.title)) aScore += 60;
      if (techPattern.test(b.title)) bScore += 60;
    } else if (genreArg === 'product') {
      const prodPattern = /新発売|新商品|新登場|発売|先行|発表|限定|コラボ|新モデル|誕生|オープン/i;
      if (prodPattern.test(a.title)) aScore += 60;
      if (prodPattern.test(b.title)) bScore += 60;
    } else if (genreArg === 'news') {
      if (a.sourceType.startsWith('yahoo_top') || a.sourceType === 'hatena_general' || a.sourceType === 'google_trends') aScore += 40;
      if (b.sourceType.startsWith('yahoo_top') || b.sourceType === 'hatena_general' || b.sourceType === 'google_trends') bScore += 40;
    }

    return bScore - aScore;
  });

  console.log(`📊 収集した候補総数: ${uniqueCandidates.length}件`);

  if (uniqueCandidates.length === 0) {
    console.error('❌ 該当ジャンルの情報を取得できませんでした。');
    process.exit(1);
  }

  // 既存記事との重複排除を行いながら targetLimit 件を選定
  const blogDir = path.join(YOMILEE_ROOT, 'src', 'content', 'blog');
  const selectedTopics = [];

  for (const candidate of uniqueCandidates) {
    if (selectedTopics.length >= targetLimit) break;

    if (!isForce && isDuplicateTopic(candidate, blogDir)) {
      console.log(`⏭️ 既存記事と重複のためスキップ: "${candidate.title.slice(0, 25)}..."`);
      continue;
    }

    selectedTopics.push(candidate);
  }

  if (selectedTopics.length === 0) {
    console.log('ℹ️ 新規に作成可能な未執筆記事はありませんでした。');
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
    console.log(`📌 タイトル: ${topic.title}`);
    console.log(`📰 情報源: ${topic.sourceName}`);
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
