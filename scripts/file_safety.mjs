import fs from 'node:fs';
import path from 'node:path';

/**
 * 一時ファイル経由の原子書き込み（Atomic Write）。
 * 途中終了やクラッシュによるJSON/JSONL/CSVの0バイト化・部分書き込み破損を防止する。
 * Windows + Googleドライブ同期下での瞬間的なファイルロックに備え、rename を最大4回リトライする。
 */
export function atomicWriteFileSync(targetPath, content, encoding = 'utf-8') {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(targetPath);
  const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);

  try {
    fs.writeFileSync(tmpPath, content, encoding);
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        fs.renameSync(tmpPath, targetPath);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES')) {
          const until = Date.now() + 40 * (attempt + 1);
          while (Date.now() < until) { /* brief sync backoff */ }
          continue;
        }
        throw err;
      }
    }
    if (lastErr) {
      // 最終フォールバック: コピー＆一時ファイル削除
      fs.copyFileSync(tmpPath, targetPath);
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

/**
 * 重要JSON/JSONLファイルの日次ローテーションバックアップを非公開ディレクトリへ保存する。
 * 同一日付のバックアップが既にある場合は上書きせずスキップする（1日1回）。
 */
export function backupFileDaily(sourcePath, backupDir, dateStr, maxKeep = 14) {
  try {
    if (!fs.existsSync(sourcePath)) return false;
    fs.mkdirSync(backupDir, { recursive: true });
    const ext = path.extname(sourcePath);
    const stem = path.basename(sourcePath, ext);
    const backupName = `${stem}_${dateStr}${ext}`;
    const backupPath = path.join(backupDir, backupName);

    if (!fs.existsSync(backupPath)) {
      const data = fs.readFileSync(sourcePath);
      atomicWriteFileSync(backupPath, data);
    }

    // 古いバックアップをローテーション削除
    const prefix = `${stem}_`;
    const files = fs.readdirSync(backupDir)
      .filter(name => name.startsWith(prefix) && name.endsWith(ext))
      .sort();
    if (files.length > maxKeep) {
      for (const oldName of files.slice(0, files.length - maxKeep)) {
        try { fs.unlinkSync(path.join(backupDir, oldName)); } catch {}
      }
    }
    return true;
  } catch (e) {
    console.warn(`⚠️ 日次バックアップ警告 (${path.basename(sourcePath)}):`, e.message);
    return false;
  }
}
