/**
 * 为主数据列表批量接入 useErpDeepLinkOpen（edit / view）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

/** @type {Array<{ file: string, mode: 'edit' | 'view', fn: string }>} */
const TARGETS = [
  { file: 'src/views/supply-chain/basic/suppliers/index.vue', mode: 'edit', fn: 'openEditDialog' },
  { file: 'src/views/inventory/basic/color-code/index.vue', mode: 'edit', fn: 'openEditDialog' },
  { file: 'src/views/inventory/basic/material-category/index.vue', mode: 'edit', fn: 'openEditDialog' },
  { file: 'src/views/inventory/basic/workshop-dept/index.vue', mode: 'edit', fn: 'openEditDialog' },
  { file: 'src/views/inventory/basic/unit-conversion/index.vue', mode: 'edit', fn: 'openEditDialog' },
  { file: 'src/views/supply-chain/basic/payment-methods/index.vue', mode: 'edit', fn: 'openEditDialog' },
  { file: 'src/views/system/role/index.vue', mode: 'edit', fn: 'openEditDialog' },
  { file: 'src/views/hr/files/department/index.vue', mode: 'edit', fn: 'openEditDialog' },
  { file: 'src/views/supply-chain/basic/customers/index.vue', mode: 'view', fn: 'openViewDialog' },
  { file: 'src/views/hr/files/employee-files/index.vue', mode: 'view', fn: 'openView' },
  { file: 'src/views/hr/dormitory/room-management/index.vue', mode: 'view', fn: 'openViewDetail' },
  { file: 'src/views/supply-chain/daily/purchase-quote/index.vue', mode: 'view', fn: 'openView' },
  { file: 'src/views/supply-chain/daily/outsourcing-quote/index.vue', mode: 'view', fn: 'openView' },
]

const IMPORT_LINE = "import { useErpDeepLinkOpen } from '@/composables/useErpDeepLinkOpen'"

for (const { file, mode, fn } of TARGETS) {
  const full = path.join(root, file)
  let content = fs.readFileSync(full, 'utf8')
  if (content.includes('useErpDeepLinkOpen(')) {
    console.log(`skip ${file}`)
    continue
  }
  if (!content.includes(IMPORT_LINE)) {
    content = content.replace(
      /import \{ useErpListRowContextMenu \}[^\n]+\n/,
      (m) => `${m}${IMPORT_LINE}\n`,
    )
  }

  const block = `
useErpDeepLinkOpen({
  handlers: {
    ${mode}: async (recordId) => {
      const id = Number(recordId)
      if (!Number.isFinite(id) || id <= 0) return
      await ${fn}({ id })
    },
  },
})
`

  const fnRe = new RegExp(`((?:async )?function ${fn}\\([^)]*\\)\\s*\\{[\\s\\S]*?^\\})`, 'm')
  if (!fnRe.test(content)) {
    console.warn(`no fn ${fn} in ${file}`)
    continue
  }
  content = content.replace(fnRe, `$1${block}`)
  fs.writeFileSync(full, content, 'utf8')
  console.log(`patched ${file}`)
}

// operator uses UserID
const operatorFile = path.join(root, 'src/views/system/operator/index.vue')
let op = fs.readFileSync(operatorFile, 'utf8')
if (!op.includes('useErpDeepLinkOpen(')) {
  op = op.replace(
    /import \{ useErpListRowContextMenu \}[^\n]+\n/,
    (m) => `${m}${IMPORT_LINE}\n`,
  )
  op = op.replace(
    /((?:async )?function openViewDialog\(row\) \{[\s\S]*?^\})/m,
    `$1
useErpDeepLinkOpen({
  handlers: {
    view: async (recordId) => {
      const id = Number(recordId)
      if (!Number.isFinite(id) || id <= 0) return
      await openViewDialog({ UserID: id })
    },
  },
})
`,
  )
  fs.writeFileSync(operatorFile, op, 'utf8')
  console.log('patched operator')
}
