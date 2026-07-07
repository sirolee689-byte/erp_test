import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const serverDir = path.join(root, 'server')

const requireLine = /^const \{ clampErpPageSize, ERP_MAX_PAGE_SIZE \} = require\('\.\/erpPagination'\)\r?\n/
const requireLineBom = /^const \{ clampErpPageSize, ERP_MAX_PAGE_SIZE \} = require\('\.\/erpPagination'\)\r?\n/

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full)
    else if (name.endsWith('.js')) fixFile(full)
  }
}

function fixFile(file) {
  let text = fs.readFileSync(file, 'utf8')
  const rel = path.relative(serverDir, file).replace(/\\/g, '/')
  const importPath = rel.startsWith('bom/') ? '../erpPagination.js' : './erpPagination.js'
  const importLine = `import { clampErpPageSize, ERP_MAX_PAGE_SIZE } from '${importPath}'\n`

  if (!requireLine.test(text) && !text.includes("require('./erpPagination')")) return

  text = text.replace(requireLine, importLine)
  text = text.replace(requireLineBom, importLine)
  fs.writeFileSync(file, text)
  console.log('fixed import:', rel)
}

walk(serverDir)
