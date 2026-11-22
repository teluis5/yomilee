/**
 * 旅行アフィリエイトリンク生成ユーティリティ（楽天トラベル / Yahoo!トラベル / じゃらんnet / レンタカー3社）
 */

export const RAKUTEN_AFFILIATE_ID = '59cee293.4a6c5500.59cee294.af50e2ea';
export const RAKUTEN_RENTACAR_AFFILIATE_ID = '59996df7.62348333.59996df9.f8832ab8';
export const RAKUTEN_RENTACAR_AFFILIATE_URL =
  'https://hb.afl.rakuten.co.jp/hgc/59996df7.62348333.59996df9.f8832ab8/?pc=https%3A%2F%2Ftravel.rakuten.co.jp%2Fcars%2F&link_type=hybrid_url&ut=eyJwYWdlIjoidXJsIiwidHlwZSI6Imh5YnJpZF91cmwiLCJjb2wiOjF9';
export const VALUECOMMERCE_SID = '3787762';
export const VC_PID_YAHOO = '892747331';
export const VC_PID_JALAN = '892747339';
export const VC_PID_JALAN_RENTACAR = '892749661';
export const JALAN_RENTACAR_AFFILIATE_URL =
  'https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=3787762&pid=892749661&vc_url=https%3A%2F%2Fwww.jalan.net%2Frentacar%2F%3Fvos%3Dafjlrpvczzzzx00000001';
export const JALAN_RENTACAR_TRACKING_PIXEL =
  'https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=3787762&pid=892749661';
export const VC_PID_BUDGET_RENTACAR = '892749662';
export const BUDGET_RENTACAR_AFFILIATE_URL =
  'https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=3787762&pid=892749662';
export const BUDGET_RENTACAR_TRACKING_PIXEL =
  'https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=3787762&pid=892749662';

// 楽天トラベル レンタカー：主要駅・地区別URLマッピング
export const RAKUTEN_RENTACAR_STATION_MAP: Record<string, string> = {
  '田沢湖': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/akita/tazawa-52159.html',
  '角館': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/akita/kakunodate-52158.html',
  '秋田': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/akita/akita-52151.html',
  '大曲': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/akita/omagari-52156.html',
  '盛岡': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/iwate/morioka-52051.html',
  '八戸': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/aomori/hachinohe-51953.html',
  '新青森': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/aomori/aomori-51951.html',
  '青森': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/aomori/aomori-51951.html',
  '弘前': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/aomori/hirosaki-51952.html',
  '仙台': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/miyagi/sendai-52251.html',
  '山形': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/yamagata/yamagata-52351.html',
  '福島': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/fukushima/fukushima-52451.html',
  '郡山': 'https://cars.travel.rakuten.co.jp/cars/area/tohoku/fukushima/koriyama-52452.html',
  '新潟': 'https://cars.travel.rakuten.co.jp/cars/area/koshinetsu/niigata/niigata-52551.html',
  '越後湯沢': 'https://cars.travel.rakuten.co.jp/cars/area/koshinetsu/niigata/yuzawa-52556.html',
  '長野': 'https://cars.travel.rakuten.co.jp/cars/area/koshinetsu/nagano/nagano-52751.html',
  '富山': 'https://cars.travel.rakuten.co.jp/cars/area/hokuriku/toyama/toyama-52851.html',
  '金沢': 'https://cars.travel.rakuten.co.jp/cars/area/hokuriku/ishikawa/kanazawa-52951.html',
  '福井': 'https://cars.travel.rakuten.co.jp/cars/area/hokuriku/fukui/fukui-53051.html',
  '熱海': 'https://cars.travel.rakuten.co.jp/cars/area/tokai/shizuoka/atami-53256.html',
  '三島': 'https://cars.travel.rakuten.co.jp/cars/area/tokai/shizuoka/mishima-53257.html',
  '静岡': 'https://cars.travel.rakuten.co.jp/cars/area/tokai/shizuoka/shizuoka-53251.html',
};

// 楽天トラベル レンタカー：都道府県別エリアパス
export const RAKUTEN_RENTACAR_PREF_MAP: Record<string, string> = {
  hokkaido: 'hokkaido/hokkaido/',
  aomori: 'tohoku/aomori/',
  iwate: 'tohoku/iwate/',
  miyagi: 'tohoku/miyagi/',
  akita: 'tohoku/akita/',
  yamagata: 'tohoku/yamagata/',
  fukushima: 'tohoku/fukushima/',
  ibaraki: 'kanto/ibaraki/',
  tochigi: 'kanto/tochigi/',
  gunma: 'kanto/gunma/',
  saitama: 'kanto/saitama/',
  chiba: 'kanto/chiba/',
  tokyo: 'kanto/tokyo/',
  kanagawa: 'kanto/kanagawa/',
  niigata: 'koshinetsu/niigata/',
  yamanashi: 'koshinetsu/yamanashi/',
  nagano: 'koshinetsu/nagano/',
  toyama: 'hokuriku/toyama/',
  ishikawa: 'hokuriku/ishikawa/',
  fukui: 'hokuriku/fukui/',
  gifu: 'tokai/gifu/',
  shizuoka: 'tokai/shizuoka/',
  aichi: 'tokai/aichi/',
  mie: 'tokai/mie/',
  shiga: 'kansai/shiga/',
  kyoto: 'kansai/kyoto/',
  osaka: 'kansai/osaka/',
  hyogo: 'kansai/hyogo/',
  nara: 'kansai/nara/',
  wakayama: 'kansai/wakayama/',
  tottori: 'chugoku/tottori/',
  shimane: 'chugoku/shimane/',
  okayama: 'chugoku/okayama/',
  hiroshima: 'chugoku/hiroshima/',
  yamaguchi: 'chugoku/yamaguchi/',
  tokushima: 'shikoku/tokushima/',
  kagawa: 'shikoku/kagawa/',
  ehime: 'shikoku/ehime/',
  kochi: 'shikoku/kochi/',
  fukuoka: 'kyushu/fukuoka/',
  saga: 'kyushu/saga/',
  nagasaki: 'kyushu/nagasaki/',
  kumamoto: 'kyushu/kumamoto/',
  oita: 'kyushu/oita/',
  miyazaki: 'kyushu/miyazaki/',
  kagoshima: 'kyushu/kagoshima/',
  okinawa: 'okinawa/okinawa/',
};

// じゃらんレンタカー：エリア（LRG）別URLマッピング
export const JALAN_RENTACAR_AREA_MAP: Record<string, string> = {
  '田沢湖': 'https://www.jalan.net/rentacar/search/050000/LRG_050200/plan/',
  '角館': 'https://www.jalan.net/rentacar/search/050000/LRG_050200/plan/',
  '大曲': 'https://www.jalan.net/rentacar/search/050000/LRG_050200/plan/',
  '秋田': 'https://www.jalan.net/rentacar/search/050000/LRG_050100/plan/',
  '盛岡': 'https://www.jalan.net/rentacar/search/030000/LRG_030100/plan/',
  '雫石': 'https://www.jalan.net/rentacar/search/030000/LRG_030100/plan/',
  '八戸': 'https://www.jalan.net/rentacar/search/020000/LRG_020400/plan/',
  '青森': 'https://www.jalan.net/rentacar/search/020000/LRG_020100/plan/',
  '新青森': 'https://www.jalan.net/rentacar/search/020000/LRG_020100/plan/',
  '弘前': 'https://www.jalan.net/rentacar/search/020000/LRG_020200/plan/',
  '仙台': 'https://www.jalan.net/rentacar/search/040000/LRG_040100/plan/',
  '熱海': 'https://www.jalan.net/rentacar/search/220000/LRG_220100/plan/',
};

// バジェット・レンタカー：店舗が存在する都道府県一覧（35都道府県）
export const BUDGET_ACTIVE_PREFS = new Set([
  'hokkaido', 'aomori', 'iwate', 'miyagi', 'fukushima',
  'chiba', 'tokyo', 'kanagawa',
  'toyama', 'ishikawa', 'fukui', 'yamanashi', 'nagano', 'gifu', 'shizuoka', 'aichi', 'mie',
  'osaka', 'hyogo',
  'shimane', 'okayama', 'hiroshima', 'yamaguchi',
  'tokushima', 'kagawa', 'ehime', 'kochi',
  'fukuoka', 'saga', 'nagasaki', 'kumamoto', 'oita', 'miyazaki', 'kagoshima', 'okinawa',
]);

// バジェット・レンタカー：主要駅の店舗URL
export const BUDGET_STATION_MAP: Record<string, string> = {
  '盛岡': 'https://www.budgetrentacar.co.jp/shop/iwate/0755/',
};

/**
 * 楽天トラベル レンタカーのアフィリエイトリンクを生成
 * 駅名または都道府県で最適化された公式URLへ誘導
 */
export function buildRakutenRentacarUrl(options?: { station?: string; pref?: string }): string {
  let targetUrl = 'https://travel.rakuten.co.jp/cars/';

  if (options?.station) {
    for (const [key, url] of Object.entries(RAKUTEN_RENTACAR_STATION_MAP)) {
      if (options.station.includes(key)) {
        targetUrl = url;
        break;
      }
    }
  }

  // 駅が見つからず、都道府県が指定されている場合は都道府県エリアへ
  if (targetUrl === 'https://travel.rakuten.co.jp/cars/' && options?.pref) {
    const areaPath = RAKUTEN_RENTACAR_PREF_MAP[options.pref];
    if (areaPath) {
      targetUrl = `https://cars.travel.rakuten.co.jp/cars/area/${areaPath}`;
    }
  }

  return `https://hb.afl.rakuten.co.jp/hgc/${RAKUTEN_RENTACAR_AFFILIATE_ID}/?pc=${encodeURIComponent(targetUrl)}&link_type=hybrid_url&ut=eyJwYWdlIjoidXJsIiwidHlwZSI6Imh5YnJpZF91cmwiLCJjb2wiOjF9`;
}

/**
 * じゃらんレンタカーのアフィリエイトリンクを生成
 * 駅名・エリアまたは都道府県JISコードで最適化された公式URLへ誘導
 */
export function buildJalanRentacarUrl(options?: { station?: string; pref?: string; prefCode?: number }): string {
  let targetUrl = 'https://www.jalan.net/rentacar/?vos=afjlrpvczzzzx00000001';

  if (options?.station) {
    for (const [key, url] of Object.entries(JALAN_RENTACAR_AREA_MAP)) {
      if (options.station.includes(key)) {
        targetUrl = url;
        break;
      }
    }
  }

  // 駅が見つからず、都道府県コードがある場合は都道府県検索へ
  if (targetUrl.includes('vos=afjlrpvczzzzx00000001') && options?.prefCode) {
    const codeStr = String(options.prefCode).padStart(2, '0');
    targetUrl = `https://www.jalan.net/rentacar/search/${codeStr}0000/`;
  }

  return `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${VALUECOMMERCE_SID}&pid=${VC_PID_JALAN_RENTACAR}&vc_url=${encodeURIComponent(targetUrl)}`;
}

/**
 * バジェット・レンタカーのアフィリエイトリンクを生成
 * 店舗が存在しないエリア（秋田県など）の場合は null を返却してボタン非表示化
 */
export function buildBudgetRentacarUrl(options?: { station?: string; pref?: string }): string | null {
  if (!options?.pref && !options?.station) {
    return BUDGET_RENTACAR_AFFILIATE_URL;
  }

  // 駅固有の店舗マッピング確認
  if (options?.station) {
    for (const [key, url] of Object.entries(BUDGET_STATION_MAP)) {
      if (options.station.includes(key)) {
        return `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${VALUECOMMERCE_SID}&pid=${VC_PID_BUDGET_RENTACAR}&vc_url=${encodeURIComponent(url)}`;
      }
    }
  }

  // 都道府県に店舗が存在するか確認
  if (options?.pref) {
    if (!BUDGET_ACTIVE_PREFS.has(options.pref)) {
      // 秋田県など店舗がないエリアは非表示にするため null を返す
      return null;
    }
    const prefUrl = `https://www.budgetrentacar.co.jp/shop/${options.pref}/`;
    return `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${VALUECOMMERCE_SID}&pid=${VC_PID_BUDGET_RENTACAR}&vc_url=${encodeURIComponent(prefUrl)}`;
  }

  return null;
}

/**
 * 楽天トラベルの正規アフィリエイトリンクを生成
 * @param options
 *   - hotelNo: 楽天トラベルの施設番号（例: 67295, 1459）※施設直リンク（最重要）
 *   - areaUrl: エリア検索URL（例: "https://search.travel.rakuten.co.jp/ds/hotellist/Japan-Akita-Semboku-Tazawako"）
 *   - keyword: 検索キーワード（施設番号やエリアURLがない場合のフォールバック）
 */
export function buildRakutenTravelUrl(options: { hotelNo?: string | number; areaUrl?: string; keyword?: string }): string {
  let targetUrl = '';

  if (options.hotelNo) {
    // 施設直リンク（https://travel.rakuten.co.jp/HOTEL/{hotelNo}/{hotelNo}.html）
    targetUrl = `https://travel.rakuten.co.jp/HOTEL/${options.hotelNo}/${options.hotelNo}.html`;
  } else if (options.areaUrl) {
    // 最新のエリア絞り込みURL（search.travel.rakuten.co.jp/ds/hotellist/...）
    targetUrl = options.areaUrl;
  } else if (options.keyword) {
    // キーワード検索正規URL
    targetUrl = `https://kw.travel.rakuten.co.jp/keyword/Search.do?f_keyword=${encodeURIComponent(options.keyword)}`;
  } else {
    targetUrl = 'https://travel.rakuten.co.jp/';
  }

  // 楽天アフィリエイト公式ゲートウェイ経由のURL
  return `https://hb.afl.rakuten.co.jp/hgc/${RAKUTEN_AFFILIATE_ID}/?pc=${encodeURIComponent(targetUrl)}`;
}

/**
 * Yahoo!トラベルのバリューコマースアフィリエイトリンクを生成
 */
export function buildYahooTravelUrl(rawUrl: string): { url: string; trackingPixel: string } {
  return {
    url: `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${VALUECOMMERCE_SID}&pid=${VC_PID_YAHOO}&vc_url=${encodeURIComponent(rawUrl)}`,
    trackingPixel: `https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=${VALUECOMMERCE_SID}&pid=${VC_PID_YAHOO}`
  };
}

/**
 * じゃらんnetのバリューコマースアフィリエイトリンクを生成
 */
export function buildJalanUrl(rawUrl: string): { url: string; trackingPixel: string } {
  return {
    url: `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${VALUECOMMERCE_SID}&pid=${VC_PID_JALAN}&vc_url=${encodeURIComponent(rawUrl)}`,
    trackingPixel: `https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=${VALUECOMMERCE_SID}&pid=${VC_PID_JALAN}`
  };
}

/**
 * 楽天トラベル公式の高画質施設画像URLを取得
 */
export function getRakutenHotelImageUrl(hotelNo: string | number): string {
  return `https://img.travel.rakuten.co.jp/share/HOTEL/${hotelNo}/${hotelNo}.jpg`;
}
