/**
 * sources.yml の各フィードURLが取得可能か検証するスクリプト
 * 使い方: npx tsx scripts/verify-sources.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import Parser from "rss-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const config = yaml.load(fs.readFileSync(path.join(root, "sources.yml"), "utf-8")) as {
  sources: { title: string; url: string }[];
};

const parser = new Parser({ timeout: 10000 });

console.log(`\n📋 sources.yml の検証 (${config.sources.length}件)\n`);
console.log("─".repeat(60));

let ok = 0;
let ng = 0;

for (const source of config.sources) {
  try {
    const feed = await parser.parseURL(source.url);
    const count = feed.items.length;
    console.log(`✅ ${source.title}`);
    console.log(`   ${count}件 | 最新: ${feed.items[0]?.title?.slice(0, 50) ?? "(なし)"}`);
    ok++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ ${source.title}`);
    console.log(`   エラー: ${msg.slice(0, 80)}`);
    ng++;
  }
  console.log(`   URL: ${source.url}`);
  console.log();
}

console.log("─".repeat(60));
console.log(`結果: ✅ ${ok}件成功 / ❌ ${ng}件失敗`);
if (ng > 0) process.exit(1);
