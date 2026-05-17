import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendBomPartsPaperPatternAuditColumns,
  PAPER_PATTERN_BOM_PARTS_PASS_DEFAULT,
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
