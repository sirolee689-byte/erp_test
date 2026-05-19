import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCutKcaa01LikePatternForDelete,
  escapeSqlServerLikeWildcards,
  mainKcaa01FromPaperPatternCutKcaa01,
  normalizeMainKcaa01ListForDelete,
  parsePaperPatternMainKcaa01ForDelete,
  resolvePaperPatternMainKcaa01ForDeleteFromKcaa01,
} from './paperPatternImportDeleteBomTree.js'

test('escapeSqlServerLikeWildcards', () => {
  assert.equal(escapeSqlServerLikeWildcards('a%b_c[d]'), 'a[%]b[_]c[[]d]')
})

test('parsePaperPatternMainKcaa01ForDelete 正常', () => {
  const r = parsePaperPatternMainKcaa01ForDelete('BAG-PQ2803H1/R-TEST')
  assert.ok(r)
  assert.equal(r.prefix, 'BAG')
  assert.equal(r.styleNo, 'PQ2803H1')
  assert.equal(r.colorNo, 'R-TEST')
  assert.equal(r.mainKcaa01, 'BAG-PQ2803H1/R-TEST')
})

test('parsePaperPatternMainKcaa01ForDelete 颜色段可含斜杠', () => {
  const r = parsePaperPatternMainKcaa01ForDelete('BAG-PQ2803H1/R/EXTRA')
  assert.ok(r)
  assert.equal(r.styleNo, 'PQ2803H1')
  assert.equal(r.colorNo, 'R/EXTRA')
})

test('buildCutKcaa01LikePatternForDelete', () => {
  const p = parsePaperPatternMainKcaa01ForDelete('BAG-PQ2803H1/R-TEST')
  assert.ok(p)
  const like = `${buildCutKcaa01LikePatternForDelete(p)}%`
  assert.equal(like, 'CUT-BAGPQ2803H1/R-TEST<%')
})

test('parsePaperPatternMainKcaa01ForDelete 非法', () => {
  assert.equal(parsePaperPatternMainKcaa01ForDelete(''), null)
  assert.equal(parsePaperPatternMainKcaa01ForDelete('NOHYPHEN'), null)
  assert.equal(parsePaperPatternMainKcaa01ForDelete('BAG-noslash'), null)
})

test('mainKcaa01FromPaperPatternCutKcaa01 反推主 BOM', () => {
  assert.equal(
    mainKcaa01FromPaperPatternCutKcaa01('CUT-BAGPQ3672A1/G-TEST<1-1>'),
    'BAG-PQ3672A1/G-TEST',
  )
  assert.equal(
    mainKcaa01FromPaperPatternCutKcaa01('CUT-BAGPQ3672A1/VE-TEST<2-3>'),
    'BAG-PQ3672A1/VE-TEST',
  )
})

test('resolvePaperPatternMainKcaa01ForDeleteFromKcaa01 主档或 CUT', () => {
  assert.equal(resolvePaperPatternMainKcaa01ForDeleteFromKcaa01('BAG-PQ3672A1/BLU2-TEST'), 'BAG-PQ3672A1/BLU2-TEST')
  assert.equal(
    resolvePaperPatternMainKcaa01ForDeleteFromKcaa01('CUT-BAGPQ3672A1/BLU2-TEST<1-1>'),
    'BAG-PQ3672A1/BLU2-TEST',
  )
})

test('normalizeMainKcaa01ListForDelete 去重', () => {
  const list = normalizeMainKcaa01ListForDelete([
    'BAG-PQ3672A1/G-TEST',
    'BAG-PQ3672A1/VE-TEST',
    'BAG-PQ3672A1/G-TEST',
  ])
  assert.deepEqual(list, ['BAG-PQ3672A1/G-TEST', 'BAG-PQ3672A1/VE-TEST'])
  assert.equal(normalizeMainKcaa01ListForDelete(['invalid']), null)
})
