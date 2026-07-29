import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { resolveOperationAuditPolicy } from './action_map.js'

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url))

function listJavaScriptFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) return listJavaScriptFiles(absolute)
    if (!entry.name.endsWith('.js')) return []
    return [absolute]
  })
}

function materializeExpressPath(routePath) {
  return routePath.replace(/:[A-Za-z0-9_]+/g, '1')
}

test('every statically registered write API has an operation audit policy', () => {
  const unknown = []
  const routePattern = /\b(?:app|router)\.(post|put|delete)\s*\(\s*(['"`])(\/api\/[^'"`$]+)\2/g

  for (const file of listJavaScriptFiles(SERVER_DIR)) {
    const source = fs.readFileSync(file, 'utf8')
    let match
    while ((match = routePattern.exec(source))) {
      const method = match[1].toUpperCase()
      const routePath = materializeExpressPath(match[3])
      const policy = resolveOperationAuditPolicy(method, routePath)
      if (policy.mode === 'unknown') {
        unknown.push(`${method} ${match[3]} (${path.relative(SERVER_DIR, file)})`)
      }
    }
  }

  assert.deepEqual(
    unknown,
    [],
    `以下写接口未标记 central/business/ignore：\n${unknown.join('\n')}`,
  )
})
