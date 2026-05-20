import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendBomPartsPaperPatternAuditColumns,
  bom000SqlColumnToNvarchar,
  bomPartsAppendPrefetchedKcaaAssignment,
  bomPartStrictNumericFromText,
  PAPER_PATTERN_BOM_PARTS_PASS_DEFAULT,
  resolveKcaaForPrefetchedBomPartsUpdate,
} from './bomPartsLinePersist.js'

test('appendBomPartsPaperPatternAuditColumns 列存在时写入审计字段', () => {
  const partColset = new Set(['uid', 'uname', 'utruename', 'addtime', 'kcac01'])
  const inputs = new Map()
  const q = {
    input(name, _type, value) {
      inputs.set(name, value)
    },
  }
  const { insCols, insVals } = appendBomPartsPaperPatternAuditColumns(
    partColset,
    q,
    'kcac01, kcaa01',
    '@kcac01, @kcaa01',
    {
      actor: { uidInt: 7, uname: 'admin', utruename: '管理员' },
      addtime: '2026-05-17 12:00:00',
    },
  )
  assert.match(insCols, /uid/)
  assert.match(insCols, /uname/)
  assert.match(insCols, /utruename/)
  assert.match(insCols, /addtime/)
  assert.equal(inputs.get('pp_audit_uid'), 7)
  assert.equal(inputs.get('pp_audit_uname'), 'admin')
  assert.equal(inputs.get('pp_audit_utruename'), '管理员')
  assert.equal(inputs.get('pp_audit_addtime'), '2026-05-17 12:00:00')
  assert.match(insVals, /@pp_audit_uid/)
})

test('PAPER_PATTERN_BOM_PARTS_PASS_DEFAULT', () => {
  assert.equal(PAPER_PATTERN_BOM_PARTS_PASS_DEFAULT, '1')
})

test('bom000SqlColumnToNvarchar 先 CONVERT 再 ISNULL，避免数值列 NULL 时 8114', () => {
  const s = bom000SqlColumnToNvarchar('b', 'kcaa12', 500)
  assert.match(s, /ISNULL\(CONVERT\(nvarchar\(500\), b\.\[kcaa12\]\), N''\)/)
  assert.doesNotMatch(s, /CONVERT\(nvarchar\(500\), ISNULL/)
})

test('bomPartStrictNumericFromText', () => {
  assert.equal(bomPartStrictNumericFromText(''), null)
  assert.equal(bomPartStrictNumericFromText('张'), null)
  assert.equal(bomPartStrictNumericFromText('0.06'), 0.06)
})

test('bomPartsAppendPrefetchedKcaaAssignment 数值列跳过非数字', () => {
  const setParts = []
  const q = { input() {} }
  bomPartsAppendPrefetchedKcaaAssignment(q, setParts, 'kcaa14', '张', 'numeric')
  assert.equal(setParts.length, 0)
  bomPartsAppendPrefetchedKcaaAssignment(q, setParts, 'kcaa14', '1', 'numeric')
  assert.equal(setParts.length, 1)
})

test('resolveKcaaForPrefetchedBomPartsUpdate 与 OUTER APPLY 规则一致', () => {
  const sync = { kcaa01: 'LA-1/A', kcaa02: '名', kcaa05: '库内扩展' }
  const raw = { kcaa01: 'LA-1/A', kcaa02: '请求名', kcaa04: 'YD' }
  assert.equal(resolveKcaaForPrefetchedBomPartsUpdate('kcaa01', sync, raw), 'LA-1/A')
  assert.equal(resolveKcaaForPrefetchedBomPartsUpdate('kcaa02', sync, raw), '名')
  assert.equal(resolveKcaaForPrefetchedBomPartsUpdate('kcaa04', sync, raw), 'YD')
  assert.equal(resolveKcaaForPrefetchedBomPartsUpdate('kcaa05', sync, raw), '库内扩展')
  assert.equal(resolveKcaaForPrefetchedBomPartsUpdate('kcaa05', undefined, raw), '')
})
