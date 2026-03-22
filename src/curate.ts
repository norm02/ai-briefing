import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import 'dotenv/config'
import yaml from "js-yaml";
import { GoogleGenAI } from "@google/genai";
import { fetchNewEntries, type FeedSource } from "./fetch-feeds.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// --- 設定読み込み ---
const config = yaml.load(fs.readFileSync(path.join(root, "sources.yml"), "utf-8")) as {
  sources: FeedSource[];
};

// --- 処理済みURLの読み込み ---
const processedPath = path.join(root, "processed_urls.txt");
const processedUrls = new Set<string>(
  fs.existsSync(processedPath)
    ? fs
      .readFileSync(processedPath, "utf-8")
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean)
    : []
);

// --- 新着エントリ収集 ---
console.log("フィード収集中...");
const newEntries = await fetchNewEntries(config.sources, processedUrls, { maxAgeDays: 7 });


if (newEntries.length === 0) {
  console.log("新着記事なし。終了します。");
  process.exit(0);
}

console.log(`${newEntries.length}件の新着記事を取得`);

// --- Gemini でキュレーション ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const entriesText = newEntries
  .map((e) => `[${e.source}] ${e.title}\nURL: ${e.link}\n${e.content}`)
  .join("\n\n---\n\n");

const prompt = `
以下の記事一覧から、Webエンジニア（AI駆動開発・自動テスト重視）の業務に最も役立つ重要な記事を「最大5つ」厳選してください。

# 優先評価基準（上から順に高評価とする）
1. 【最優先の技術テーマ】
   - AI駆動開発: Gemini CLI, Antigravity, MCP/CLIツール
   - Web技術: Chrome, Chromium
   - 自動テスト: Playwright, Playwright CLI, Playwright MCP
2. 【一次情報の厳守・優遇】
   - ツール提供元の公式ブログ、公式技術ドキュメント、GitHubリポジトリ（Release notesなど）等の「一次情報」を最も高く評価してください。
   - 企業のテックブログやニュースサイト等の二次情報・三次情報は、非常に有益な場合に限り選定対象としてください。
3. 【その他の技術テーマ】
   - 上記1に該当しないその他の開発ツールや一般的な技術記事は、優先度を下げてください。

# 除外基準（以下のノイズは絶対に含めないこと）
- 企業間の業務提携、パートナーシップ、ビジネス・資金調達寄りのニュース

# 制約・出力フォーマット
- 関心事や優先基準に強く合致する記事が5件未満の場合は、無理に5つ選ばず、該当する有益なものだけを出力してください。
- 各記事はSlack通知に最適なMarkdown形式で出力してください。
- 以下のフォーマットに従い、簡潔にまとめてください。

【出力フォーマット】
• *[記事のタイトル](URL)*
  *なぜ開発に役立つか:* （1〜2文の日本語要約。日々の開発や自動テスト、AIツール連携にどう活きるかを具体的に記載）

記事一覧:
${entriesText}`;

const response = await ai.models.generateContent({
  model: "gemini-3.1-flash-lite-preview",
  contents: prompt,
});

const summary = response.text ?? "";
console.log("Gemini応答:\n", summary);

// --- summary.txt に書き出し（GitHub Actions側でSlack通知に使用）---
fs.writeFileSync(path.join(root, "summary.txt"), summary, "utf-8");

// --- 処理済みURLを追記 ---
const newUrls = newEntries.map((e) => e.link).filter(Boolean);
fs.appendFileSync(processedPath, newUrls.join("\n") + "\n", "utf-8");

console.log("完了。");
process.exit(0);
