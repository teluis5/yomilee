import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { generateWeeklyPrediction } from './weekly_chiikawa_predictor.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YOMILEE_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isAutoPush = args.includes('--auto-push');

function performAutoPush(updatedAt) {
  console.log('\n🔒 === yomilee: 安全なGitコミット＆プッシュを開始 ===');
  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd: YOMILEE_ROOT, encoding: 'utf-8' }).trim();
    if (!remoteUrl.includes('yomilee') || !remoteUrl.includes('github.com')) {
      console.error(`❌ リモートURL検証エラー: 予期しないリポジトリです (${remoteUrl})`);
      return;
    }

    try {
      execSync('git pull origin main --rebase', { cwd: YOMILEE_ROOT, stdio: 'inherit' });
    } catch {}

    execSync('git add data/chiikawa_weekly_prediction.json data/ana_b767_flight_history.json scripts/ src/pages/site/chiikawajet/', { cwd: YOMILEE_ROOT, stdio: 'inherit' });

    const commitMsg = `feat(yomilee): update Chiikawa Jet weekly prediction dashboard (${updatedAt})`;
    console.log(`📝 コミット実行: "${commitMsg}"`);
    execSync(`git commit -m "${commitMsg}"`, { cwd: YOMILEE_ROOT, stdio: 'inherit' });

    console.log('🚀 リモート (origin main) へプッシュ中...');
    execSync('git push origin main', { cwd: YOMILEE_ROOT, stdio: 'inherit' });
    console.log('🎉 yomilee のGitプッシュが完了しました！GitHub Pagesの自動デプロイが開始されます。');
  } catch (e) {
    console.error('❌ Git操作エラー:', e.message);
  }
}

async function main() {
  const result = await generateWeeklyPrediction();
  if (!result) return;

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
