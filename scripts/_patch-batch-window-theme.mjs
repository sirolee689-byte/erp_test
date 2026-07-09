/**
 * 批量选单窗：把写死的浅色底/边框/表头映射到皮肤 CSS 变量（暗黑/豆沙绿可读）。
 * 打印页（print.vue / label-print.vue）不在此脚本范围。
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

const files = [
  'src/views/inventory/daily/stock-out/assist-issue-batch-window.vue',
  'src/views/inventory/daily/stock-out/assist-return-batch-window.vue',
  'src/views/inventory/daily/stock-out/purchase-return-batch-window.vue',
  'src/views/inventory/daily/stock-out/production-issue-batch-window.vue',
  'src/views/inventory/daily/stock-out/finished-goods-batch-window.vue',
  'src/views/inventory/daily/stock-out/batch-add-window.vue',
  'src/views/inventory/daily/stock-in/surplus-batch-window.vue',
  'src/views/inventory/daily/stock-in/other-batch-window.vue',
  'src/views/inventory/daily/stock-in/batch-add-window.vue',
  'src/views/inventory/daily/stock-in/assist-return-batch-window.vue',
  'src/views/supply-chain/daily/purchase-order/batch-add-window.vue',
  'src/views/supply-chain/daily/outsourcing-order/batch-add-window.vue',
  'src/views/inventory/daily/stock-in/assist-return-batch-window.vue',

/** 按顺序替换；先长模式后短模式，避免互相干扰 */
const replacements = [
  // 窗口大底
  [/background:\s*#f5f7fa\b/g, 'background: var(--erp-app-bg, #f5f7fa)'],
  [/background:\s*#f4f6f8\b/g, 'background: var(--erp-app-bg, #f4f6f8)'],
  // 面板/表格区白面（含 sticky 列）
  [/background:\s*#fff\b/g, 'background: var(--erp-surface, #fff)'],
  // 次要文字
  [/color:\s*#606266\b/g, 'color: var(--el-text-color-regular)'],
  // 表格边框
  [/border:\s*1px solid #ebeef5\b/g, 'border: 1px solid var(--el-border-color-lighter)'],
  [/border-bottom:\s*1px solid #e3e7ec\b/g, 'border-bottom: 1px solid var(--el-border-color-lighter)'],
  [/border-right:\s*1px solid #e8ebef\b/g, 'border-right: 1px solid var(--el-border-color-lighter)'],
  [/border:\s*1px solid #d8dde3\b/g, 'border: 1px solid var(--el-border-color)'],
  [/border:\s*1px solid #d3d8de\b/g, 'border: 1px solid var(--el-border-color)'],
  // 表头填充
  [/background:\s*#f5f7fa\b/g, 'background: var(--el-fill-color-light, #f5f7fa)'],
  [/background:\s*#f8fafc\b/g, 'background: var(--el-fill-color-light, #f8fafc)'],
  // 表头文字（采购/外协批量窗）
  [/color:\s*#374151\b/g, 'color: var(--el-text-color-primary)'],
  // 选中行浅绿底 → 语义色浅底（暗黑下仍可读）
  [/background:\s*#f0f9eb\b/g, 'background: var(--el-color-success-light-9, #f0f9eb)'],
  // 灰按钮底
  [/background:\s*#f4f4f5\b/g, 'background: var(--el-fill-color-light, #f4f4f5)'],
  [/border-color:\s*#c0c4cc\b/g, 'border-color: var(--el-border-color)'],
  [/color:\s*#111827\b/g, 'color: var(--el-text-color-primary)'],
]

let changed = 0
for (const rel of files) {
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) {
    console.warn('skip missing:', rel)
    continue
  }
  let text = fs.readFileSync(abs, 'utf8')
  const before = text
  for (const [re, to] of replacements) {
    text = text.replace(re, to)
  }
  if (text !== before) {
    fs.writeFileSync(abs, text, 'utf8')
    changed++
    console.log('patched:', rel)
  }
}
console.log(`done, ${changed} file(s) updated`)

