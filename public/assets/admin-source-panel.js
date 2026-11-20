(() => {
  'use strict';

  if (window.__yomileeAdminSourcePanelMounted) return;

  function isAdminBrowser() {
    if (document.cookie.indexOf('teluis_admin=true') !== -1) return true;
    try {
      return localStorage.getItem('teluis_admin') === 'true';
    } catch {
      return false;
    }
  }

  if (!isAdminBrowser()) return;

  const ALLOWED_EMAILS = ['y.fujii1715@gmail.com', 'fjiysk13.729.kr@gmail.com'];

  const FIREBASE_CONFIG = {
    projectId: 'teluis-ops-center',
    appId: '1:311874080291:web:ca483a08b32423fa91eb96',
    storageBucket: 'teluis-ops-center.firebasestorage.app',
    apiKey: 'AIzaSyC6z48nLxSCOk5kEt7aTdNY0hfT21iG094',
    authDomain: 'teluis-ops-center.firebaseapp.com',
    messagingSenderId: '311874080291',
    projectNumber: '311874080291',
  };

  const FIREBASE_SCRIPTS = [
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js',
  ];

  const KIND_LABELS = {
    official: '公式',
    news: 'ニュース',
    blog: '他社ブログ',
    recruit: '求人情報',
    sns: 'SNS',
    data: '調査データ',
  };

  const GENERATOR_LABELS = {
    manual_ai: 'AI共同執筆・手動特集',
    generate_trend: 'トレンド自動生成 (generate_trend)',
    generate_chiikawa: 'ちいかわ自動生成 (generate_chiikawa)',
    generate_store_openings: '新店舗自動生成 (generate_store_openings)',
    backfill: '遡及データ登録',
  };

  const CHEVRON_MASK =
    'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23000\' stroke-width=\'2.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E")';

  const CSS_TEXT = `
.ysp-host {
  margin: 0.75rem 0 1.25rem;
  font-family: var(--font-base, sans-serif);
  font-size: 0.875rem;
  line-height: 1.55;
  color: #1e293b;
}
.ysp-panel {
  border: 1px solid #cbd5e1;
  border-left: 4px solid var(--theme-accent, #007cba);
  border-radius: 8px;
  background: #f8fafc;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.ysp-summary {
  list-style: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5ch 0.65rem;
  padding: 0.65rem 0.9rem;
  cursor: pointer;
  font-weight: 700;
  color: #0f172a;
  user-select: none;
}
.ysp-summary::-webkit-details-marker {
  display: none;
}
.ysp-summary:hover {
  background: #f1f5f9;
  border-radius: 7px;
}
.ysp-summary:focus-visible {
  outline: 2px solid var(--theme-accent, #007cba);
  outline-offset: 2px;
  border-radius: 7px;
}
.ysp-summary::before {
  content: "";
  inline-size: 1em;
  block-size: 1em;
  flex-shrink: 0;
  background-color: currentColor;
  -webkit-mask: ${CHEVRON_MASK} no-repeat center / contain;
  mask: ${CHEVRON_MASK} no-repeat center / contain;
  rotate: -90deg;
}
.ysp-panel[open] > .ysp-summary::before {
  rotate: 0deg;
}
.ysp-panel[open] > .ysp-summary {
  border-bottom: 1px solid #e2e8f0;
  border-radius: 7px 7px 0 0;
}
.ysp-panel::details-content {
  interpolate-size: allow-keywords;
  overflow: clip;
  contain: layout;
}
.ysp-panel:not([open])::details-content {
  block-size: 0;
}
@media (prefers-reduced-motion: no-preference) {
  .ysp-summary::before {
    transition: rotate 0.2s ease;
  }
  .ysp-panel::details-content {
    transition: block-size, content-visibility, display;
    transition-duration: 0.25s;
    transition-timing-function: ease-in-out;
    transition-behavior: allow-discrete;
  }
}
.ysp-summary-title {
  font-size: 0.85rem;
}
.ysp-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.12rem 0.55rem;
  border-radius: 9999px;
  font-size: 0.74rem;
  font-weight: 700;
  border: 1px solid transparent;
  line-height: 1.4;
}
.ysp-badge-official_primary { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
.ysp-badge-news_secondary { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
.ysp-badge-past_estimate { background: #fffbeb; color: #b45309; border-color: #fde68a; }
.ysp-badge-mixed { background: #eef2ff; color: #4338ca; border-color: #c7d2fe; }
.ysp-badge-external_blog { background: #fff1f2; color: #be123c; border-color: #fecdd3; }
.ysp-badge-neutral { background: #e2e8f0; color: #334155; border-color: #cbd5e1; }
.ysp-summary-count {
  font-size: 0.75rem;
  font-weight: 600;
  color: #475569;
}
.ysp-body {
  padding: 0.9rem 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.ysp-note {
  margin: 0;
  color: #475569;
  font-size: 0.82rem;
}
.ysp-error {
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  background: #fff1f2;
  border: 1px solid #fecdd3;
  color: #9f1239;
  font-size: 0.8rem;
  word-break: break-word;
}
.ysp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.ysp-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  line-height: 1.25;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #0f172a;
  padding: 0.45rem 0.85rem;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.ysp-btn:hover {
  background: #f1f5f9;
  text-decoration: none;
  opacity: 1;
}
.ysp-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.ysp-btn-primary {
  background: #0369a1;
  border-color: #0369a1;
  color: #ffffff;
}
.ysp-btn-primary:hover {
  background: #075985;
}
.ysp-section-label {
  font-size: 0.76rem;
  font-weight: 700;
  color: #475569;
  margin-bottom: 0.35rem;
}
.ysp-summary-box {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.65rem 0.8rem;
  font-size: 0.84rem;
  color: #1e293b;
  margin: 0;
}
.ysp-source-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.ysp-source-item {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.6rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.ysp-source-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.ysp-kind-pill {
  display: inline-block;
  padding: 0.08rem 0.45rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  background: #e2e8f0;
  color: #334155;
}
.ysp-kind-official { background: #d1fae5; color: #065f46; }
.ysp-kind-news { background: #dbeafe; color: #1e40af; }
.ysp-kind-blog { background: #ffe4e6; color: #9f1239; }
.ysp-kind-recruit { background: #fef3c7; color: #92400e; }
.ysp-kind-sns { background: #f3e8ff; color: #6b21a8; }
.ysp-kind-data { background: #e0e7ff; color: #3730a3; }
.ysp-source-name {
  font-weight: 700;
  font-size: 0.82rem;
  color: #0f172a;
}
.ysp-source-link {
  font-size: 0.76rem;
  color: #0369a1;
  text-decoration: underline;
  word-break: break-all;
  overflow-wrap: anywhere;
}
.ysp-source-note {
  margin: 0;
  font-size: 0.78rem;
  color: #475569;
}
.ysp-unverified-box {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 0.6rem 0.8rem;
}
.ysp-unverified-list {
  margin: 0.25rem 0 0;
  padding-left: 1.2rem;
  font-size: 0.78rem;
  color: #92400e;
}
.ysp-unverified-list li {
  margin-bottom: 0.2rem;
}
.ysp-meta-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px dashed #cbd5e1;
  font-size: 0.73rem;
  color: #64748b;
}
.ysp-meta-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.85rem;
}
.ysp-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.72rem;
  background: #e2e8f0;
  color: #334155;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  word-break: break-all;
}
`;

  function el(tag, opts, ...children) {
    const node = document.createElement(tag);
    if (opts) {
      if (opts.className) node.className = opts.className;
      if (opts.text !== undefined) node.textContent = String(opts.text);
      if (opts.type) node.type = opts.type;
      if (opts.href) node.href = opts.href;
      if (opts.target) node.target = opts.target;
      if (opts.rel) node.rel = opts.rel;
      if (opts.disabled !== undefined) node.disabled = Boolean(opts.disabled);
      if (opts.onClick) node.addEventListener('click', opts.onClick);
    }
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function parseSafeHttpUrl(rawUrl) {
    try {
      const parsed = new URL(String(rawUrl || '').trim());
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.href;
      }
    } catch {}
    return '';
  }

  function getPageContext() {
    const rawPath = decodeURIComponent(window.location.pathname || '/');
    const cleanSlug = rawPath.replace(/^\/blog\//, '').replace(/^\/+|\/+$/g, '');
    if (
      !cleanSlug ||
      cleanSlug === 'blog' ||
      cleanSlug === 'about' ||
      cleanSlug === 'contact' ||
      cleanSlug === 'privacy' ||
      cleanSlug.startsWith('category/') ||
      /^\d+$/.test(cleanSlug)
    ) {
      return null;
    }
    const normalizedSlug = cleanSlug.replace(/[^a-zA-Z0-9_-]+/g, '__').replace(/^_+|_+$/g, '');
    if (!normalizedSlug) return null;
    return {
      slug: cleanSlug,
      docId: `yomilee__${normalizedSlug}`,
    };
  }

  function injectStyles() {
    if (document.getElementById('ysp-styles')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'ysp-styles';
    styleEl.textContent = CSS_TEXT;
    document.head.appendChild(styleEl);
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.addEventListener('load', () => {
        script.dataset.loaded = '1';
        resolve();
      });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
      document.head.appendChild(script);
    });
  }

  async function ensureFirebase() {
    if (!(window.firebase && window.firebase.auth && window.firebase.firestore)) {
      for (const src of FIREBASE_SCRIPTS) {
        await loadScriptOnce(src);
      }
    }
    const app = window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp(FIREBASE_CONFIG);
    const auth = window.firebase.auth(app);
    const db = window.firebase.firestore(app);
    return { app, auth, db };
  }

  function clearChildren(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function renderPanel(panelState, ctx, refs, handlers) {
    const wasOpen = refs.details.open;
    clearChildren(refs.summary);
    clearChildren(refs.body);

    refs.summary.appendChild(el('span', { className: 'ysp-summary-title', text: '🔒 管理者ソース' }));

    if (panelState.status === 'loading') {
      refs.summary.appendChild(el('span', { className: 'ysp-badge ysp-badge-neutral', text: '読込中...' }));
      refs.body.appendChild(el('p', { className: 'ysp-note', text: '非公開データベースから情報源を確認しています...' }));
      refs.details.open = wasOpen;
      return;
    }

    if (panelState.status === 'needs_auth') {
      refs.summary.appendChild(
        el('span', { className: 'ysp-badge ysp-badge-neutral', text: '初回Google認証が必要' })
      );
      refs.body.appendChild(
        el('p', {
          className: 'ysp-note',
          text: 'この記事の参照サイト・根拠メモは非公開Firestoreに保存されています。管理者アカウントで一度ログインすると以降は自動表示されます。',
        })
      );
      if (panelState.error) {
        refs.body.appendChild(el('div', { className: 'ysp-error', text: panelState.error }));
      }
      refs.body.appendChild(
        el(
          'div',
          { className: 'ysp-actions' },
          el('button', {
            type: 'button',
            className: 'ysp-btn ysp-btn-primary',
            text: 'Googleアカウントでログイン',
            onClick: () => handlers.login('smart'),
          }),
          el('button', {
            type: 'button',
            className: 'ysp-btn',
            text: '📲 画面遷移でログイン（ポップアップ不可時）',
            onClick: () => handlers.login('redirect'),
          })
        )
      );
      refs.details.open = wasOpen;
      return;
    }

    if (panelState.status === 'unauthorized') {
      refs.summary.appendChild(el('span', { className: 'ysp-badge ysp-badge-external_blog', text: '権限なし' }));
      refs.body.appendChild(
        el('div', {
          className: 'ysp-error',
          text: `許可されていないアカウント（${panelState.email || '不明'}）でログイン中です。管理者アカウントに切り替えてください。`,
        })
      );
      refs.body.appendChild(
        el(
          'div',
          { className: 'ysp-actions' },
          el('button', {
            type: 'button',
            className: 'ysp-btn ysp-btn-primary',
            text: '別アカウントでログインし直す',
            onClick: () => handlers.switchAccount(),
          }),
          el('button', {
            type: 'button',
            className: 'ysp-btn',
            text: 'ログアウト',
            onClick: () => handlers.logout(),
          })
        )
      );
      refs.details.open = wasOpen;
      return;
    }

    if (panelState.status === 'error') {
      refs.summary.appendChild(el('span', { className: 'ysp-badge ysp-badge-external_blog', text: '取得エラー' }));
      refs.body.appendChild(el('div', { className: 'ysp-error', text: panelState.error || '取得に失敗しました。' }));
      refs.body.appendChild(
        el(
          'div',
          { className: 'ysp-actions' },
          el('button', {
            type: 'button',
            className: 'ysp-btn',
            text: '再読込',
            onClick: () => handlers.reload(),
          }),
          el('button', {
            type: 'button',
            className: 'ysp-btn',
            text: 'ログアウト',
            onClick: () => handlers.logout(),
          })
        )
      );
      refs.details.open = wasOpen;
      return;
    }

    if (panelState.status === 'not_found') {
      refs.summary.appendChild(el('span', { className: 'ysp-badge ysp-badge-neutral', text: '未登録' }));
      refs.body.appendChild(
        el('p', {
          className: 'ysp-note',
          text: 'この記事の情報源メタデータはまだFirestoreに登録されていません。',
        })
      );
      refs.body.appendChild(
        el(
          'div',
          { className: 'ysp-meta-footer' },
          el(
            'div',
            { className: 'ysp-meta-tags' },
            el('span', {}, 'DocID: ', el('code', { className: 'ysp-code', text: ctx.docId })),
            el('span', { text: `認証: ${panelState.email || ''}` })
          ),
          el(
            'div',
            { className: 'ysp-actions' },
            el('button', { type: 'button', className: 'ysp-btn', text: '再読込', onClick: () => handlers.reload() }),
            el('button', { type: 'button', className: 'ysp-btn', text: 'ログアウト', onClick: () => handlers.logout() })
          )
        )
      );
      refs.details.open = wasOpen;
      return;
    }

    // status === 'ready'
    const doc = panelState.data || {};
    const evidenceType = doc.evidenceType || 'news_secondary';
    const evidenceLabel = doc.evidenceLabel || evidenceType;
    const sources = Array.isArray(doc.sources) ? doc.sources : [];
    const unverifiedPoints = Array.isArray(doc.unverifiedPoints) ? doc.unverifiedPoints : [];

    refs.summary.appendChild(
      el('span', {
        className: `ysp-badge ysp-badge-${evidenceType}`,
        text: evidenceLabel,
      })
    );
    refs.summary.appendChild(
      el('span', {
        className: 'ysp-summary-count',
        text: `(参照 ${sources.length}件${unverifiedPoints.length > 0 ? `・未確定 ${unverifiedPoints.length}件` : ''})`,
      })
    );

    if (doc.summary) {
      refs.body.appendChild(
        el(
          'div',
          {},
          el('div', { className: 'ysp-section-label', text: '根拠・情報収集の概要' }),
          el('p', { className: 'ysp-summary-box', text: doc.summary })
        )
      );
    }

    const sourceListEl = el('ul', { className: 'ysp-source-list' });
    if (sources.length === 0) {
      sourceListEl.appendChild(
        el('li', { className: 'ysp-source-item' }, el('span', { className: 'ysp-note', text: '登録された個別参照URLはありません。' }))
      );
    } else {
      for (const src of sources) {
        const kind = (src && src.kind) ? String(src.kind).toLowerCase() : 'news';
        const kindText = KIND_LABELS[kind] || kind;
        const safeHref = parseSafeHttpUrl(src && src.url);
        const itemChildren = [
          el(
            'div',
            { className: 'ysp-source-head' },
            el('span', { className: `ysp-kind-pill ysp-kind-${kind}`, text: kindText }),
            el('span', { className: 'ysp-source-name', text: (src && src.name) || '参照元' })
          ),
        ];
        if (safeHref) {
          itemChildren.push(
            el('a', {
              className: 'ysp-source-link',
              href: safeHref,
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
              text: safeHref,
            })
          );
        }
        if (src && src.note) {
          itemChildren.push(el('p', { className: 'ysp-source-note', text: src.note }));
        }
        sourceListEl.appendChild(el('li', { className: 'ysp-source-item' }, ...itemChildren));
      }
    }
    refs.body.appendChild(
      el('div', {}, el('div', { className: 'ysp-section-label', text: '参照ソース・URL一覧' }), sourceListEl)
    );

    if (unverifiedPoints.length > 0) {
      const uvList = el('ul', { className: 'ysp-unverified-list' });
      for (const pt of unverifiedPoints) {
        uvList.appendChild(el('li', { text: pt }));
      }
      refs.body.appendChild(
        el(
          'div',
          { className: 'ysp-unverified-box' },
          el('div', { className: 'ysp-section-label', text: '⚠️ 執筆時点で未確定・過去実績ベースで記載した点' }),
          uvList
        )
      );
    }

    const opsUrl = 'https://teluis-ops-center.web.app';
    refs.body.appendChild(
      el(
        'div',
        { className: 'ysp-meta-footer' },
        el(
          'div',
          { className: 'ysp-meta-tags' },
          el('span', { text: `作成経路: ${GENERATOR_LABELS[doc.generator] || doc.generator || '不明'}` }),
          el('span', { text: `最終更新: ${doc.updatedAt || doc.createdAt || '-'}` }),
          el('span', {}, 'ID: ', el('code', { className: 'ysp-code', text: ctx.docId }))
        ),
        el(
          'div',
          { className: 'ysp-actions' },
          el('a', {
            className: 'ysp-btn',
            href: opsUrl,
            target: '_blank',
            rel: 'noopener noreferrer nofollow',
            text: '管理センター ↗',
          }),
          el('button', { type: 'button', className: 'ysp-btn', text: '再読込', onClick: () => handlers.reload() }),
          el('button', { type: 'button', className: 'ysp-btn', text: 'ログアウト', onClick: () => handlers.logout() })
        )
      )
    );
    refs.details.open = wasOpen;
  }

  function formatAuthError(err) {
    const code = (err && err.code) || '';
    if (code === 'auth/unauthorized-domain') {
      return `認証エラー (auth/unauthorized-domain): Firebase Auth の承認済みドメインに ${window.location.hostname} が未登録です。`;
    }
    return `認証エラー: ${(err && (err.message || err.code)) || String(err)}`;
  }

  async function init() {
    const ctx = getPageContext();
    if (!ctx) return;

    const article = document.querySelector('article.layout-main');
    if (!article) return;

    window.__yomileeAdminSourcePanelMounted = true;
    injectStyles();

    const host = el('div', { className: 'ysp-host' });
    const details = el('details', { className: 'ysp-panel' });
    const summary = el('summary', { className: 'ysp-summary' });
    const body = el('div', { className: 'ysp-body' });
    details.appendChild(summary);
    details.appendChild(body);
    host.appendChild(details);

    const titleEl = article.querySelector('.title');
    if (titleEl && titleEl.parentNode) {
      titleEl.parentNode.insertBefore(host, titleEl.nextSibling);
    } else {
      article.prepend(host);
    }

    const refs = { host, details, summary, body };
    let currentAuth = null;
    let currentDb = null;

    const handlers = {
      async login(mode) {
        if (!currentAuth) return;
        const provider = new window.firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        if (mode === 'redirect') {
          try {
            await currentAuth.signInWithRedirect(provider);
          } catch (err) {
            renderPanel({ status: 'needs_auth', error: formatAuthError(err) }, ctx, refs, handlers);
          }
          return;
        }
        try {
          await currentAuth.signInWithPopup(provider);
        } catch (err) {
          const isPopupBlocked =
            err &&
            (err.code === 'auth/popup-blocked' ||
              err.code === 'auth/cancelled-popup-request' ||
              err.code === 'auth/operation-not-supported-in-this-environment' ||
              err.code === 'auth/internal-error');
          if (isPopupBlocked) {
            try {
              await currentAuth.signInWithRedirect(provider);
              return;
            } catch (rErr) {
              renderPanel({ status: 'needs_auth', error: formatAuthError(rErr) }, ctx, refs, handlers);
              return;
            }
          }
          renderPanel({ status: 'needs_auth', error: formatAuthError(err) }, ctx, refs, handlers);
        }
      },
      async switchAccount() {
        if (!currentAuth) return;
        await currentAuth.signOut();
        await handlers.login('smart');
      },
      async logout() {
        if (!currentAuth) return;
        await currentAuth.signOut();
      },
      async reload() {
        if (!currentAuth || !currentDb) return;
        await loadSourceDoc(currentAuth.currentUser);
      },
    };

    async function loadSourceDoc(user) {
      if (!user) {
        renderPanel({ status: 'needs_auth' }, ctx, refs, handlers);
        return;
      }
      const email = (user.email || '').toLowerCase().trim();
      if (!ALLOWED_EMAILS.includes(email)) {
        renderPanel({ status: 'unauthorized', email: user.email || '' }, ctx, refs, handlers);
        return;
      }
      renderPanel({ status: 'loading' }, ctx, refs, handlers);
      try {
        const snap = await currentDb.collection('article_sources').doc(ctx.docId).get();
        if (!snap.exists) {
          renderPanel({ status: 'not_found', email: user.email || '' }, ctx, refs, handlers);
          return;
        }
        renderPanel({ status: 'ready', data: snap.data(), email: user.email || '' }, ctx, refs, handlers);
      } catch (err) {
        renderPanel(
          { status: 'error', error: `Firestore読込エラー: ${(err && (err.message || err.code)) || String(err)}` },
          ctx,
          refs,
          handlers
        );
      }
    }

    renderPanel({ status: 'loading' }, ctx, refs, handlers);

    try {
      const fb = await ensureFirebase();
      currentAuth = fb.auth;
      currentDb = fb.db;

      await currentAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
      await currentAuth.getRedirectResult().catch(err => {
        if (err && err.code) {
          renderPanel({ status: 'needs_auth', error: formatAuthError(err) }, ctx, refs, handlers);
        }
      });

      currentAuth.onAuthStateChanged(user => {
        loadSourceDoc(user);
      });
    } catch (err) {
      renderPanel(
        { status: 'error', error: `初期化エラー: ${(err && err.message) || String(err)}` },
        ctx,
        refs,
        handlers
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
