#!/usr/bin/env node
// 为经文页面生成「干净排版」的 PDF（用于站点下载 + 推 Kindle）。
//
// 原理：Chromium 的 page.pdf() 默认使用 print media，配合 custom.scss 里的
// @media print 规则，会自动去掉侧栏 / 页眉 / 目录等界面元素，只保留正文。
//
// 用法：
//   node scripts/gen-pdf.mjs SN1.1              # 按名字模糊匹配 public 下的 html
//   node scripts/gen-pdf.mjs SN1.1 SN1.2        # 一次多篇
//   node scripts/gen-pdf.mjs                    # 不带参数 = 处理 public 下全部经文页
//
// 前置：先 `npx quartz build`（生成 public/*.html）。
// 输出：content/<同路径>/pdf/<名字>.pdf，构建时由 Plugin.Assets() 复制进站点。

import { chromium } from "playwright"
import { fileURLToPath, pathToFileURL } from "node:url"
import { readdirSync, statSync, mkdirSync } from "node:fs"
import path from "node:path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const PUBLIC = path.join(ROOT, "public")
const CONTENT = path.join(ROOT, "content")

// 递归列出 public 下所有经文 html（排除目录页 index.html、404、tags）
function listSuttaHtml(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === "tags" || name === "static") continue
      out.push(...listSuttaHtml(full))
    } else if (name.endsWith(".html") && name !== "index.html" && name !== "404.html") {
      out.push(full)
    }
  }
  return out
}

// 从 html 文件路径推导输出 pdf 路径与短名。
// 统一放在 content/pdf/ 扁平目录：文件名（如 SN1.1）全局唯一，
// 且 Quartz 的 markdownLinkResolution="shortest" 会把经文里的
// [下载](pdf/SN1.1.pdf) 解析到站点根 /pdf/SN1.1.pdf，正好对应此处。
function outputFor(htmlPath, shortName) {
  const rel = path.relative(PUBLIC, htmlPath) // 相应部/SN01-.../SN1.1-....html
  const base = shortName || path.basename(rel, ".html").split("-")[0] // SN1.1
  const outDir = path.join(CONTENT, "pdf")
  return { outDir, outFile: path.join(outDir, `${base}.pdf`), base }
}

function resolveTargets(args) {
  const all = listSuttaHtml(PUBLIC)
  if (args.length === 0) return all.map((h) => ({ html: h, short: null }))
  const targets = []
  for (const arg of args) {
    // 精确按「<经号>-」前缀匹配，避免 SN1.1 误配 SN1.10
    const matches = all.filter((h) => {
      const b = path.basename(h, ".html")
      return b === arg || b.startsWith(arg + "-")
    })
    if (matches.length === 0) {
      console.error(`⚠️  找不到匹配 "${arg}" 的 html，跳过`)
      continue
    }
    for (const m of matches) targets.push({ html: m, short: arg })
  }
  return targets
}

async function main() {
  const args = process.argv.slice(2)
  const targets = resolveTargets(args)
  if (targets.length === 0) {
    console.error("没有可处理的页面。先运行 `npx quartz build`。")
    process.exit(1)
  }

  const browser = await chromium.launch()
  const page = await browser.newPage()

  for (const { html, short } of targets) {
    const { outDir, outFile, base } = outputFor(html, short)
    mkdirSync(outDir, { recursive: true })
    await page.goto(pathToFileURL(html).href, { waitUntil: "networkidle" })
    // 等字体加载，避免 PDF 里字形回退
    await page.evaluate(() => document.fonts?.ready).catch(() => {})
    await page.pdf({
      path: outFile,
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    })
    console.log(`✅ ${base}  →  ${path.relative(ROOT, outFile)}`)
  }

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
