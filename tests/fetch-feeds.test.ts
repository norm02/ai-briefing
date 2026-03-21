/**
 * fetch-feeds.ts のフィルタリングロジックのユニットテスト
 * 使い方: npx tsx --test tests/fetch-feeds.test.ts
 *
 * Node.js 標準テストランナー (node:test) を使用（外部ライブラリ不要）
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ---- テスト対象のロジックをインラインで再実装（純粋関数として切り出し） ----
// fetch-feeds.ts の newItems フィルター部分と同じ判定ロジック

interface MockItem {
  link?: string;
  pubDate?: string;
  isoDate?: string;
  title?: string;
}

function filterItems(
  items: MockItem[],
  notifiedUrls: Set<string>,
  cutoffDate: Date
): MockItem[] {
  return items.filter((item) => {
    if (!item.link) return false;
    if (notifiedUrls.has(item.link)) return false;

    const dateStr = item.pubDate ?? item.isoDate;
    if (dateStr) {
      const pubDate = new Date(dateStr);
      if (!isNaN(pubDate.getTime()) && pubDate < cutoffDate) return false;
    }

    return true;
  });
}

// ---- テストデータ ----
const NOW = new Date("2026-03-21T10:00:00+09:00");
const cutoff7days = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);

const mockItems: MockItem[] = [
  {
    title: "新鮮な記事（今日）",
    link: "https://example.com/today",
    pubDate: "Fri, 21 Mar 2026 09:00:00 +0900",
  },
  {
    title: "3日前の記事",
    link: "https://example.com/3days-ago",
    pubDate: "Tue, 18 Mar 2026 09:00:00 +0900",
  },
  {
    title: "ちょうど7日前（境界値）",
    link: "https://example.com/7days-ago",
    pubDate: "Fri, 14 Mar 2026 10:00:00 +0900",  // cutoffとほぼ同時刻
  },
  {
    title: "8日前の古い記事",
    link: "https://example.com/8days-ago",
    pubDate: "Thu, 13 Mar 2026 09:00:00 +0900",
  },
  {
    title: "1月の古い記事",
    link: "https://example.com/january",
    pubDate: "Mon, 10 Jan 2026 09:00:00 +0900",
  },
  {
    title: "日付なし記事（除外しない）",
    link: "https://example.com/no-date",
    // pubDate なし
  },
  {
    title: "通知済み記事",
    link: "https://example.com/already-notified",
    pubDate: "Fri, 21 Mar 2026 08:00:00 +0900",
  },
  {
    title: "リンクなし記事",
    // link なし
    pubDate: "Fri, 21 Mar 2026 07:00:00 +0900",
  },
];

// ---- テスト ----
describe("filterItems: 重複除外のテスト", () => {
  test("通知済みURLは除外される", () => {
    const notified = new Set(["https://example.com/already-notified"]);
    const result = filterItems(mockItems, notified, new Date(0)); // 日付フィルターなし
    assert.equal(
      result.some((i) => i.link === "https://example.com/already-notified"),
      false,
      "通知済みURLが含まれている"
    );
  });

  test("通知済みでないURLは通過する", () => {
    const notified = new Set(["https://example.com/already-notified"]);
    const result = filterItems(mockItems, notified, new Date(0));
    assert.equal(
      result.some((i) => i.link === "https://example.com/today"),
      true,
      "新鮮な記事が除外されている"
    );
  });
});

describe("filterItems: 日付フィルターのテスト", () => {
  const notified = new Set<string>();

  test("7日以内の記事は通過する", () => {
    const result = filterItems(mockItems, notified, cutoff7days);
    assert.equal(
      result.some((i) => i.link === "https://example.com/today"),
      true,
      "今日の記事が除外されている"
    );
    assert.equal(
      result.some((i) => i.link === "https://example.com/3days-ago"),
      true,
      "3日前の記事が除外されている"
    );
  });

  test("8日以上前の記事は除外される", () => {
    const result = filterItems(mockItems, notified, cutoff7days);
    assert.equal(
      result.some((i) => i.link === "https://example.com/8days-ago"),
      false,
      "8日前の記事が通過している"
    );
    assert.equal(
      result.some((i) => i.link === "https://example.com/january"),
      false,
      "1月の記事が通過している"
    );
  });

  test("日付なしの記事は除外しない", () => {
    const result = filterItems(mockItems, notified, cutoff7days);
    assert.equal(
      result.some((i) => i.link === "https://example.com/no-date"),
      true,
      "日付なし記事が除外されている"
    );
  });

  test("linkなしの記事は除外される", () => {
    const result = filterItems(mockItems, notified, cutoff7days);
    assert.equal(
      result.some((i) => i.link === undefined),
      false,
      "linkなし記事が通過している"
    );
  });
});

describe("filterItems: 重複除外 + 日付フィルターの組み合わせ", () => {
  test("通知済み かつ 新鮮な記事でも除外される", () => {
    // 今日の記事を通知済みにする
    const notified = new Set(["https://example.com/today"]);
    const result = filterItems(mockItems, notified, cutoff7days);
    assert.equal(
      result.some((i) => i.link === "https://example.com/today"),
      false,
      "通知済みの今日の記事が除外されていない"
    );
  });

  test("最終的に残るべき記事の確認", () => {
    const notified = new Set(["https://example.com/already-notified"]);
    const result = filterItems(mockItems, notified, cutoff7days);
    const links = result.map((i) => i.link);

    // 残るべきもの: today, 3days-ago, no-date, (7days-agoは微妙なので検証しない)
    assert.ok(links.some(l => l === "https://example.com/today"), "today が含まれていない");
    assert.ok(links.some(l => l === "https://example.com/3days-ago"), "3days-ago が含まれていない");
    assert.ok(links.some(l => l === "https://example.com/no-date"), "no-date が含まれていない");

    // 除外されるべきもの
    assert.ok(!links.some(l => l === "https://example.com/8days-ago"), "8days-ago が除外されていない");
    assert.ok(!links.some(l => l === "https://example.com/january"), "january が除外されていない");
    assert.ok(!links.some(l => l === "https://example.com/already-notified"), "already-notified が除外されていない");
  });
});
