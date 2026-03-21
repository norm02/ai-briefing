import Parser from "rss-parser";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

const parser = new Parser({ timeout: 10000 });

/** フィードのsummary/contentが短い場合、記事ページをfetchしてReadabilityで本文抽出 */
async function extractContent(item: Parser.Item, maxLength: number): Promise<string> {
  // rss-parserがHTMLを除去済みのcontentSnippetを優先
  const feedText = item.contentSnippet ?? "";

  if (feedText.length >= 300) {
    // フィードに十分な本文がある（はてなブログ全文配信など）
    return feedText.replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  // 短い or 空 → 記事ページをfetchしてReadabilityで抽出（Zenn・GitHub Releasesなど）
  if (!item.link) return feedText;

  try {
    const res = await fetch(item.link, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-briefing-bot/1.0)" },
    });
    if (!res.ok) return feedText;

    const html = await res.text();
    // CSSパース・JS実行エラーをすべて抑制（Readabilityにはhtml解析のみ必要）
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(html, { url: item.link, virtualConsole, runScripts: "outside-only" });

    const article = new Readability(dom.window.document).parse();

    return (article?.textContent ?? feedText)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  } catch {
    // タイムアウト・ネットワークエラー → フィードのテキストにフォールバック
    return feedText.slice(0, maxLength);
  }
}

export interface FeedEntry {
  title: string;
  link: string;
  content: string;
  source: string;
  pubDate?: string;
}

export interface FeedSource {
  title: string;
  url: string;
  maxLength?: number;
  maxAgeDays?: number; // この日数より古い記事を除外（未指定時は maxAgeDays のデフォルト値を使用）
}

/** 複数フィードから新着エントリを収集して枝切りしたテキストを返す */
export async function fetchNewEntries(
  sources: FeedSource[],
  notifiedUrls: Set<string>,
  options: { maxLength?: number; maxAgeDays?: number } = {}
): Promise<FeedEntry[]> {
  const { maxLength = 400, maxAgeDays = 7 } = options;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  const results: FeedEntry[] = [];

  for (const source of sources) {
    let feed: Parser.Output<Record<string, string>>;
    try {
      feed = await parser.parseURL(source.url);
    } catch (err) {
      console.warn(`[WARN] フィード取得失敗: ${source.title} (${source.url})\n`, err);
      continue;
    }

    const effectiveCutoff = source.maxAgeDays
      ? new Date(Date.now() - source.maxAgeDays * 24 * 60 * 60 * 1000)
      : cutoff;

    const newItems = feed.items.filter((item) => {
      if (!item.link) return false;
      if (notifiedUrls.has(item.link)) return false;

      // 日付チェック（日付が取れない記事は除外しない）
      const dateStr = item.pubDate ?? item.isoDate;
      if (dateStr) {
        const pubDate = new Date(dateStr);
        if (!isNaN(pubDate.getTime()) && pubDate < effectiveCutoff) return false;
      }

      return true;
    });

    // 並列でコンテンツ抽出（各ソース内は並列、ソース間はシーケンシャル）
    const entries = await Promise.all(
      newItems.map(async (item): Promise<FeedEntry> => {
        const content = await extractContent(item, source.maxLength ?? maxLength);
        return {
          title: item.title?.trim() ?? "(タイトルなし)",
          link: item.link ?? "",
          content,
          source: source.title,
          pubDate: item.pubDate ?? item.isoDate,
        };
      })
    );

    results.push(...entries);
  }

  return results;
}
