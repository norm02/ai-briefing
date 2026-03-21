import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { GoogleGenAI } from "@google/genai";
import { fetchNewEntries, type FeedSource } from "./fetch-feeds.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// --- 設定読み込み ---
const config = yaml.load(fs.readFileSync(path.join(root, "sources.yml"), "utf-8")) as {
  sources: FeedSource[];
};

// --- 通知済みURLの読み込み ---
const notifiedPath = path.join(root, "notified_urls.txt");
const notifiedUrls = new Set<string>(
  fs.existsSync(notifiedPath)
    ? fs
        .readFileSync(notifiedPath, "utf-8")
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean)
    : []
);

// --- 新着エントリ収集 ---
console.log("フィード収集中...");
const newEntries = await fetchNewEntries(config.sources, notifiedUrls, { maxAgeDays: 7 });


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

const prompt = `以下の記事一覧から、現在の開発チームの関心事である【AI駆動開発（Gemini API/CLI、Antigravityなど）、Web技術（Chromeなど）、自動テスト（Playwrightなど）】に関連する、最も重要で役立つ記事を「最大3つ」厳選してください。

⚠️ 以下のテーマはノイズとなるため**除外**してください:
- エッジデバイス、IoT、ハードウェア、マイコン関連
- 企業間の業務提携、パートナーシップ、ビジネス寄りのニュース

【制約・出力フォーマット】
- 関心事に強く合致する記事が3件未満の場合は、無理に3つ選ばず、該当する有益なものだけを出力してください。
- 各記事はSlack通知用のMarkdown形式にし、「タイトル・URL・なぜ開発に役立つか（1〜2文の日本語要約）」を記載して簡潔にまとめてください。

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

// --- 通知済みURLを追記 ---
const newUrls = newEntries.map((e) => e.link).filter(Boolean);
fs.appendFileSync(notifiedPath, newUrls.join("\n") + "\n", "utf-8");

console.log("完了。");
