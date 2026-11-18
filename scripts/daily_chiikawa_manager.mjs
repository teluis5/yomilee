import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { generateWeeklyPrediction } from './weekly_chiikawa_predictor.mjs';
import { generatePokemonWeeklyPrediction } from './weekly_pokemon_predictor.mjs';
import { generateDailyChiikawaArticle } from './generate_daily_chiikawa_article.mjs';
import { generateDailyPokemonArticle } from './generate_daily_pokemon_article.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YOMILEE_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isAutoPush = args.includes('--auto-push');
const isQuick = args.includes('--quick');

function performAutoPush(updatedAt) {
  console.log('\n🔒 === yomilee: 安全なGitコミット＆プッシュを開始 ===');
  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd: YOMILEE_ROOT, encoding: 'utf-8' }).trim();
    if (!remoteUrl.includes('yomilee') || !remoteUrl.includes('github.com')) {
      console.error(`❌ リモートURL検証エラー: 予期しないリポジトリです (${remoteUrl})`);
      return;
    }

    try {
      execSync('git pull origin main --rebase --autostash', { cwd: YOMILEE_ROOT, stdio: 'inherit' });
    } catch {}

    if (isQuick) {
      // 15分毎のクイックモード: ちいかわ予測JSONのみステージングして軽量コミット
      execSync('git add data/chiikawa_weekly_prediction.json src/data/chiikawa_weekly_prediction.json data/daily_predictions_snapshot.json data/evaluation_log.jsonl', { cwd: YOMILEE_ROOT, stdio: 'inherit' });
    } else {
      execSync('git add data/chiikawa_weekly_prediction.json src/data/chiikawa_weekly_prediction.json data/ana_fleet_status.json src/data/ana_fleet_status.json data/daily_predictions_snapshot.json scripts/ src/pages/site/chiikawajet/ src/assets/images/chiikawajet_ogp.png public/brand/chiikawajet_ogp.png src/content/blog', { cwd: YOMILEE_ROOT, stdio: 'inherit' });
      execSync('git add data/pokemon_weekly_prediction.json src/data/pokemon_weekly_prediction.json', { cwd: YOMILEE_ROOT, stdio: 'inherit' });
      if (fs.existsSync(path.join(YOMILEE_ROOT, 'src', 'assets', 'images', 'pokemonjet_ogp.png'))) {
        execSync('git add src/assets/images/pokemonjet_ogp.png public/brand/pokemonjet_ogp.png public/brand/pokemonjet_ogp.jpg', { cwd: YOMILEE_ROOT, stdio: 'inherit' });
      }
      if (fs.existsSync(path.join(YOMILEE_ROOT, 'data', 'pokemon_prediction_snapshots.json'))) {
        execSync('git add data/pokemon_prediction_snapshots.json', { cwd: YOMILEE_ROOT, stdio: 'inherit' });
      }
      if (fs.existsSync(path.join(YOMILEE_ROOT, 'data', 'evaluation_log.jsonl'))) {
        execSync('git add data/evaluation_log.jsonl', { cwd: YOMILEE_ROOT, stdio: 'inherit' });
      }
      if (fs.existsSync(path.join(YOMILEE_ROOT, 'data', 'chiikawa_first_flight_history.json'))) {
        execSync('git add data/chiikawa_first_flight_history.json', { cwd: YOMILEE_ROOT, stdio: 'inherit' });
      }
    }

    const commitMsg = isQuick
      ? `feat(yomilee): update Chiikawa Jet (JA609A) real-time position (${updatedAt})`
      : `feat(yomilee): update Chiikawa Jet weekly prediction dashboard (${updatedAt})`;
    console.log(`📝 コミット実行: "${commitMsg}"`);
    try {
      execSync(`git commit -m "${commitMsg}"`, { cwd: YOMILEE_ROOT, stdio: 'inherit' });
      console.log('🚀 リモート (origin main) へプッシュ中...');
      execSync('git push origin main', { cwd: YOMILEE_ROOT, stdio: 'inherit' });
      console.log('🎉 yomilee のGitプッシュが完了しました！GitHub Pagesの自動デプロイが開始されます。');
    } catch (err) {
      console.log('ℹ️ yomilee: コミット対象の変更がないか、すでに最新です。');
    }
  } catch (e) {
    console.error('❌ Git操作エラー:', e.message);
  }
}

async function main() {
  const result = await generateWeeklyPrediction();
  if (!result) return;

  if (!isQuick) {
    try {
      generateDailyChiikawaArticle(result);
    } catch (err) {
      console.warn('⚠️ 日次スケジュール記事の生成に失敗しました:', err.message);
    }
    try {
      const pokemonResult = await generatePokemonWeeklyPrediction();
      if (pokemonResult) {
        generateDailyPokemonArticle(pokemonResult);
      }
      const pokemonCardScript = path.resolve(YOMILEE_ROOT, '..', '..', '5_script', 'generate_pokemon_tweet_card.py');
      if (fs.existsSync(pokemonCardScript)) {
        execSync(`python "${pokemonCardScript}"`, { stdio: 'inherit' });
      }
    } catch (err) {
      console.warn('⚠️ ポケモンジェットの予想・記事・画像更新に失敗しました:', err.message);
    }

    // 運行予想インフォグラフィック画像（Twitterカード/OGP）を最新データで自動生成
    try {
      const cardGenScript = path.resolve(YOMILEE_ROOT, '..', '..', '5_script', 'generate_chiikawa_tweet_card.py');
      console.log(`🖼️ 運行予想インフォグラフィック画像を再生成中: python "${cardGenScript}"`);
      execSync(`python "${cardGenScript}"`, { stdio: 'inherit' });
    } catch (err) {
      console.warn('⚠️ カード画像生成で警告が発生しました:', err.message);
    }
  } else {
    console.log('⚡ 15分毎クイックモード: ポケモン予想・記事生成・画像レンダリングをスキップ（サーバー負荷抑制）');
  }

  if (isDryRun) {
    console.log('🧪 --dry-run モード: Gitプッシュをスキップします。');
    return;
  }

  if (isAutoPush) {
    performAutoPush(result.updatedAt);
  }

  console.log('\n========================================================');
  console.log('🎉 yomilee ちいかわジェット週間予測ダッシュボード更新完了！');
  console.log('========================================================');
}

main().catch(e => console.error(e));
