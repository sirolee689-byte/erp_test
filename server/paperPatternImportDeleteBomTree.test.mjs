import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCutKcaa01LikePatternForDelete,
  escapeSqlServerLikeWildcards,
  parsePaperPatternMainKcaa01ForDelete,
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
