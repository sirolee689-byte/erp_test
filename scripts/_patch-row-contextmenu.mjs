/**
 * 批量为主列表 el-table 接入右键「在新标签页中打开」
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const SKIP_FILES = new Set([
  'src/views/inv/bom/index.vue',
  'src/views/inv/bom/BomLinkedDetailDialog.vue',
  'src/views/inventory/basic/pi-bom-data/PiBomEditorPanel.vue',
  'src/views/supply-chain/daily/outsourcing-order/AssistOrderEditForm.vue',
  'src/views/production/analysis/report-stats/index.vue',
])

const COMPOSABLE_IMPORT = "import { useErpListRowContextMenu } from '@/composables/useErpListRowContextMenu'"
const SETUP_LINE = 'const { onErpListRowContextMenu } = useErpListRowContextMenu()'

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

function rel(p) {
  return path.relative(root, p).replace(/\\/g, '/')
}

function isMainListTable(attrs) {
  if (attrs.includes('erp-list-table')) return true
  if (attrs.includes('ErpTableActions') || attrs.includes('erp-col-actions')) return false
  if (!attrs.includes(':data=') && !attrs.includes(' v-bind:data')) return false
  if (attrs.includes('type="expand"')) return false
  return attrs.includes('border') && attrs.includes('stripe')
}

function patchFile(filePath) {
  const relPath = rel(filePath)
  if (SKIP_FILES.has(relPath)) return { relPath, status: 'skip-listed' }

  let content = fs.readFileSync(filePath, 'utf8')
  if (!content.includes('<el-table') || !content.includes('ErpTableActions')) {
    return { relPath, status: 'no-main-list' }
  }
  if (content.includes('onErpListRowContextMenu')) {
    return { relPath, status: 'already' }
  }

  const tableRe = /<el-table\b([^>]*)>/g
  let tablePatched = false
  let seenMain = false
  content = content.replace(tableRe, (match, attrs) => {
    if (attrs.includes('@row-contextmenu')) return match
    if (!isMainListTable(attrs)) return match
    if (seenMain) return match
    seenMain = true
    tablePatched = true
    return `<el-table${attrs} @row-contextmenu="onErpListRowContextMenu">`
  })

  if (!tablePatched) {
    return { relPath, status: 'table-not-patched' }
  }

  if (!content.includes(COMPOSABLE_IMPORT)) {
    if (!/<script setup>/.test(content)) return { relPath, status: 'no-script-setup' }
    content = content.replace(/<script setup>\s*\n/, `<script setup>\n${COMPOSABLE_IMPORT}\n`)
  }

  if (!content.includes(SETUP_LINE)) {
    const defineOptionsRe = /defineOptions\(\{[^}]+\}\)\s*\n/
    if (defineOptionsRe.test(content)) {
      content = content.replace(defineOptionsRe, (m) => `${m}${SETUP_LINE}\n`)
    } else {
      content = content.replace(
        /<script setup>\s*\n(?:import[^\n]+\n)*/,
        (m) => `${m}${SETUP_LINE}\n`,
      )
    }
  }

  fs.writeFileSync(filePath, content, 'utf8')
  return { relPath, status: 'patched' }
}

const vueFiles = walk(path.join(root, 'src/views'))
const results = vueFiles.map(patchFile)
const patched = results.filter((r) => r.status === 'patched')
console.log(`Patched ${patched.length} files:`)
for (const r of patched) console.log(`  ${r.relPath}`)

const odd = results.filter((r) => r.status === 'table-not-patched')
if (odd.length) {
  console.log('\nNeeds manual review:')
  for (const r of odd) console.log(`  ${r.relPath}: ${r.status}`)
}
