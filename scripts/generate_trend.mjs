import fs from 'node:fs';
import path from 'node:path';
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

        // 暮らし・ライフスタイルに適合するものを優先
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

        // 一般的なスマホ・日常ガジェット・便利ツールにヒットするもののみ採用
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

      // 生活・ガジェット・話題のトピック
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
function determineCategories(mainTopic) {
  const life = mainTopic.lifeScore || 0;
  const gadget = mainTopic.gadgetScore || 0;

  if (life > gadget && life > 0) {
    return ['ライフスタイル'];
  } else if (gadget > life && gadget > 0) {
    return ['IT・ガジェット'];
  } else if (gadget > 0 && life > 0) {
    return ['ライフスタイル', 'IT・ガジェット'];
  }
  return ['ライフスタイル'];
}

// yomilee風 Gemini API 記事執筆
async function generateArticleWithGemini(mainTopic, subTopics, dateInfo, categories) {
  if (!GEMINI_API_KEY) {
    console.log('⚠️ GEMINI_API_KEY が未設定のため、親しみやすいブロガー風フォールバック記事を生成します。');
    return generateFallbackArticle(mainTopic, subTopics, dateInfo, categories);
  }

  console.log('🤖 Gemini で【yomilee等身大ブロガー風】の親しみやすい記事を執筆中...');

  const mainTopicData = `【メイン特集トピック（最重要）】
タイトル: ${mainTopic.title}
情報源: ${mainTopic.sourceName || '話題のトピック'} (${mainTopic.bookmarks ? mainTopic.bookmarks + 'ブクマ' : mainTopic.traffic})
URL: ${mainTopic.link || mainTopic.news?.[0]?.url || ''}
概要・抜粋: ${mainTopic.description || mainTopic.news?.map(n => n.title).join(' / ') || ''}`;

  const subTopicsData = subTopics.map((t, i) => {
    const url = t.link || t.news?.[0]?.url || '';
    const desc = t.description || t.news?.map(n => n.title).join(' / ') || '';
    return `- トピック${i + 1}: ${t.title} (${url})\n  要約: ${desc}`;
  }).join('\n');

  const systemInstruction = `あなたは暮らしとガジェットの体験談ブログ「yomileeblog（ヨミリーブログ）」の運営者「yomilee」です。
読者に寄り添う親しみやすく等身大の語り口で、日々の暮らしがちょっと便利になったり、お得になったり、ワクワクするような話題をわかりやすくお届けします。

【ペルソナと文体ルール】
1. **親しみやすさと等身大の共感**:
   - 語り口: 「〜ですよね」「〜してみてはいかがでしょうか」「実際に気になったので詳しくチェックしてみました」「日々の暮らしや買い物がちょっと快適になりそうですね」など、温かみがあり丁寧なブログ調。
   - 硬いニュース報道調（「〜と報じられた」「今後の展開が期待される」）や、AI特有の不自然な定型句（「いかがでしたでしょうか」）は使わないこと。
2. **読者目線の実用性と本音**:
   - 「結局、自分の生活や家計にどう役立つのか？」「どんな人におすすめなのか？」「ちょっと注意したい点はあるか？」を等身大の目線で率直に解説。
3. **キャッチーでわかりやすいタイトル**:
   - 事務的な日付まとめではなく、メイン特集の魅力を前面に出した、思わずクリックしたくなるタイトル（32〜45文字程度）。
   - 例: 「〇〇が話題！日々の暮らしや買い物がちょっと快適になる注目トレンドまとめ」
   - 例: 「これ便利そう！注目の〇〇と今チェックしておきたいライフスタイル＆ガジェット話題4選」

【記事構成ルール】
- **Frontmatter**:
  title: キャッチーなブログタイトル
  description: 110〜130文字程度で、読者の好奇心をそそる導入要約
  pubDate: "${dateInfo.dateStr}"
  categories: ${JSON.stringify(categories)}
  heroImage: "./hero.jpg"
- **導入部**:
  - ブロガーらしい親しみやすい導入の挨拶と日常の小話
  - <ProblemBox> コンポーネントを配置（読者が「まさにそれが知りたかった」「気になっていた」と感じる悩みや関心を3〜4項目）
- **メイン特集セクション (H2)**:
  - 今回のトップトピック（${mainTopic.title}）を丁寧に解説
  - H3「何が話題になっている？概要と注目ポイント」
  - H3「日々の暮らしや生活はどう変わる？（導入・活用のメリット）」
  - H3「気になる注意点やおすすめな人」
  - 一次情報リンク: [元記事や詳細をチェック](${mainTopic.link || mainTopic.news?.[0]?.url || ''})
- **あわせて読みたい注目トピック4選 (H2)**:
  - サブトピックをそれぞれH3見出しで、1〜2段落＋yomileeの一言コメント（「これ試してみたい」「ここが便利そう」など）を添えて紹介。
- **まとめ部**:
  - <ConclusionBox> コンポーネントを配置（本日のまとめ・暮らしの知恵・読者が今すぐ試せるワンアクション）
- **HTML/MDX構文**:
  - <br />、<hr />などは必ず自己閉じタグにすること。
  - 出力はMarkdown本文のみ（Frontmatter含む、\`\`\`mdx のコードブロックで囲まないこと）。`;

  const userPrompt = `日付: ${dateInfo.formattedJa}（${dateInfo.dateStr}）

${mainTopicData}

【あわせて紹介するサブトピック】
${subTopicsData}

上記のトピックを活用して、読者が「読んでよかった！」「生活に役立ちそう！」と感じる親しみやすいyomileeblog記事を執筆してください！`;

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

// フォールバック記事生成（APIキー未設定時でも高品質に生成）
function generateFallbackArticle(mainTopic, subTopics, dateInfo, categories) {
  let mainCleanTitle = mainTopic.title.replace(/[-|].*$/, '').trim();
  // 外側の鉤括弧をストリップ
  mainCleanTitle = mainCleanTitle.replace(/^[「『"']/, '').replace(/[」』"']$/, '').trim();

  const displayTitle = mainCleanTitle.length > 26 ? mainCleanTitle.slice(0, 25) + '…' : mainCleanTitle;
  const title = `【${dateInfo.mm}月${dateInfo.dd}日】「${displayTitle}」が話題！暮らしと便利トレンドまとめ`;
  const description = `${dateInfo.formattedJa}の注目トレンド！ネットやSNSで大きな話題の「${displayTitle}」のポイントや日々の暮らしへの役立て方、注目の便利トピックを等身大ブロガー目線でわかりやすくお届けします。`;

  // ひとことメモのバリエーション
  const commentTemplates = [
    '日々の暮らしを快適にするちょっとした工夫や知恵は、知っておくだけでも役立ちますね。気になる方はぜひチェックしてみてください！',
    'SNSでも共感の声が多く集まっていました。日常のちょっとした不便を解消するヒントになりそうです。',
    'これは実際に試してみたくなる話題ですね！週末のお買い物や生活の中で意識してみるのもおすすめです。',
    '新しい視点や便利なツールが登場するとワクワクしますね。今後のアップデートや口コミも追っていきたいところです！'
  ];

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

日々の生活やネットを見ていると、<b>「これ、生活がちょっと便利になりそう！」「試してみたい！」</b>と思える面白いサービスや便利グッズ、お得な話題がたくさんありますよね。

本日もネットやSNSで注目を集めている話題の中から、暮らしやデジタル生活に役立つトレンドを厳選してピックアップしました。

<ProblemBox>
- 「${mainCleanTitle.slice(0, 25)}」が話題だけど、具体的に何が便利なの？
- 忙しい毎日の中で、暮らしをラクにする知恵やお得な情報を手軽に知りたい
- 今日の注目のライフスタイル・デジタル話題をスキマ時間にサクッとチェックしたい
</ProblemBox>

まずは今日一番注目したいメインの話題からじっくり見ていきましょう！

---

## 🌟 【本日のメイン注目トピック】${mainTopic.title}

本日、ネットやSNSで特に大きな関心を集めているのがこちらの話題です。

${mainTopic.description ? `> ${mainTopic.description}\n\n` : ''}

### なぜ今、注目されているの？
単なるニュースにとどまらず、**「私たちの普段の暮らしや毎日のちょっとした不便をどう解決してくれるか」**という実践的なメリットが多くの人に共感されているポイントです。

- **日々の手間やストレスを軽減**: 面倒だった作業や管理をスマートにしてくれる工夫
- **生活の質の向上**: 無理のない範囲で暮らしがワンランク快適になる体験
- **知っておくと得する気づき**: 毎日の買い物や生活防衛にも役立つヒント

### 普段の生活はどう快適になる？
実際に取り入れてみることで、日々のちょっとした時間の節約や気分のリフレッシュに繋がりそうです。

「自分には合うかな？」と気になる方もいるかもしれませんが、まずは気軽にチェックしてみてはいかがでしょうか。

👉 **元記事・詳しい情報をチェック**:  
<a href="${mainTopic.link || mainTopic.news?.[0]?.url || '#'}" target="_blank" rel="noopener noreferrer">${mainTopic.title}</a>

---

## 💡 あわせてチェックしたい！今日の暮らし＆便利トピック4選

メイン特集のほかにも、今日チェックしておきたい注目の話題や便利ネタが揃っています。サクッと確認していきましょう！

`;

  subTopics.slice(0, 4).forEach((t, i) => {
    const url = t.link || t.news?.[0]?.url || '#';
    const comment = commentTemplates[i % commentTemplates.length];
    mdx += `### ${i + 1}. ${t.title}\n\n`;
    if (t.description) {
      mdx += `${t.description}\n\n`;
    }
    mdx += `**yomileeのひとことメモ**:<br />\n`;
    mdx += `${comment}\n\n`;
    mdx += `🔗 <a href="${url}" target="_blank" rel="noopener noreferrer">詳細や元リンクはこちら</a>\n\n---\n\n`;
  });

  mdx += `<ConclusionBox>
- 本日は「${displayTitle}」を中心に、暮らしとデジタル生活をちょっと豊かにする注目トピックをお届けしました。
- 気になるサービスや知恵があれば、まずは無理のない範囲で日常に取り入れてみるのがおすすめです。
- 次回も日々の暮らしに役立つリアルな情報をお届けします！
</ConclusionBox>\n`;

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
  console.log('🖼️ フォールバック hero.jpg を作成中...');
  const minimalJpgBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  fs.writeFileSync(heroPath, Buffer.from(minimalJpgBase64, 'base64'));
  console.log('✅ フォールバック hero.jpg を保存しました');
}

// 安全なGitコミット＆プッシュ（安全照合付き）
function performAutoPush(slug) {
  console.log('\n🔒 === 安全なGitコミット＆プッシュを開始 ===');

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
    const targetBlogRelPath = `src/content/blog/${slug}`;
    console.log(`📦 ステージング中: ${targetBlogRelPath}`);
    execSync(`git add "${targetBlogRelPath}"`, { cwd: YOMILEE_ROOT, stdio: 'inherit' });

    // ステータス確認
    const status = execSync('git status --porcelain', { cwd: YOMILEE_ROOT, encoding: 'utf-8' });
    if (!status.includes(slug)) {
      console.log('ℹ️ コミットする新しい差分がありません。');
      return true;
    }

    const commitMsg = `feat(yomilee): add daily lifestyle trend ${slug}`;
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
  console.log('🚀 === yomileeblog 【暮らし＆デジタル生活】トレンド自動生成 ===');
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

  // 統合・トピック選定
  const combinedTopics = [];

  // Google急上昇でヒットしたものを優先投入
  googleTrendsTopics.forEach(t => combinedTopics.push(t));

  // はてブ暮らし
  for (const t of hatenaLifeTopics) {
    if (combinedTopics.length >= 8) break;
    if (!combinedTopics.some(c => c.title === t.title)) {
      combinedTopics.push(t);
    }
  }

  // はてブテック・ガジェット
  for (const t of hatenaTechTopics) {
    if (combinedTopics.length >= 10) break;
    if (!combinedTopics.some(c => c.title === t.title)) {
      combinedTopics.push(t);
    }
  }

  if (combinedTopics.length === 0) {
    console.error('❌ 暮らし・ガジェット関連のトレンド情報を取得できませんでした。');
    process.exit(1);
  }

  const mainTopic = combinedTopics[0];
  const subTopics = combinedTopics.slice(1);
  const categories = determineCategories(mainTopic);

  console.log(`🔥 【本日のメイン特集】: ${mainTopic.title}`);
  console.log(`📂 【判定カテゴリ】: ${categories.join(', ')}`);
  console.log(`📌 【サブトピック】: ${subTopics.length}件`);

  // 記事保存先ディレクトリ
  const slug = `${dateInfo.dateStr}-daily-trend`;
  const targetDir = path.join(YOMILEE_ROOT, 'src', 'content', 'blog', slug);

  if (fs.existsSync(targetDir) && !isForce) {
    console.log(`ℹ️ すでに本日の記事ディレクトリが存在します: ${slug}`);
    console.log('   上書きする場合は --force を指定してください。');
    if (isAutoPush) {
      console.log('   --auto-push が指定されているため、Gitプッシュのみ試行します。');
      performAutoPush(slug);
    }
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  // サムネイル画像
  const imageUrl = mainTopic.image || mainTopic.picture || subTopics.find(t => t.image || t.picture)?.image;
  await prepareHeroImage(targetDir, imageUrl);

  // 記事本文の生成
  let articleMdx = '';
  if (isDryRun) {
    console.log('🧪 --dry-run モード: yomilee風テンプレート記事を生成します。');
    articleMdx = generateFallbackArticle(mainTopic, subTopics, dateInfo, categories);
  } else {
    articleMdx = await generateArticleWithGemini(mainTopic, subTopics, dateInfo, categories);
  }

  // ファイル書き出し
  const mdxPath = path.join(targetDir, 'index.mdx');
  fs.writeFileSync(mdxPath, articleMdx, 'utf-8');
  console.log(`💾 記事を保存しました: ${mdxPath}`);

  // 自動Gitプッシュ
  if (isAutoPush) {
    performAutoPush(slug);
  } else {
    console.log('💡 コミット＆プッシュまで自動実行する場合は --auto-push を指定してください。');
  }

  console.log('🎉 すべての処理が完了しました！');
}

main().catch(err => {
  console.error('❌ エラーが発生しました:', err);
  process.exit(1);
});
