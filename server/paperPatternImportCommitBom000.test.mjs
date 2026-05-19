import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendBom000PaperPatternAuditColumns,
  formatPaperPatternCutKcaa03,
  normalizeFactoryStyleForBomPathDisplay,
  PAPER_PATTERN_BOM000_PASS_DEFAULT,
  PAPER_PATTERN_BOM000_PASS_MAIN,
  resolveCutsResolvedForColor,
} from './paperPatternImportCommitBom000.js'

test('formatPaperPatternCutKcaa03 四位小数与乘号', () => {
  assert.equal(formatPaperPatternCutKcaa03('4.4489', '4.7390'), '4.4489*4.7390')
  assert.equal(formatPaperPatternCutKcaa03(4.4491, 4.7394), '4.4491*4.7394')
})

test('formatPaperPatternCutKcaa03 非法为空按 0', () => {
  assert.equal(formatPaperPatternCutKcaa03('x', ''), '0.0000*0.0000')
  assert.equal(formatPaperPatternCutKcaa03('', null), '0.0000*0.0000')
})

test('normalizeFactoryStyleForBomPathDisplay 保留横线、去星与空白', () => {
  assert.equal(normalizeFactoryStyleForBomPathDisplay('PQ-2803H1'), 'PQ-2803H1')
  assert.equal(normalizeFactoryStyleForBomPathDisplay(' PQ-*2803H1 '), 'PQ-2803H1')
})

test('PAPER_PATTERN_BOM000_PASS_DEFAULT', () => {
  assert.equal(PAPER_PATTERN_BOM000_PASS_DEFAULT, '1')
})

test('PAPER_PATTERN_BOM000_PASS_MAIN', () => {
  assert.equal(PAPER_PATTERN_BOM000_PASS_MAIN, '0')
})

test('resolveCutsResolvedForColor 按色生成 CUT 编码', () => {
  const rows = resolveCutsResolvedForColor(
    [{ cutSeq: '1-1', cutName: '前幅', length: '1', width: '2' }],
    { importTypeFlag5: 'BAG', styleNo: 'PQ3672A1', colorNo: 'G-TEST' },
  )
  assert.equal(rows[0].cutCode, 'CUT-BAGPQ3672A1/G-TEST<1-1>')
  const rows2 = resolveCutsResolvedForColor(
    [{ cutSeq: '1-1', cutName: '前幅' }],
    { importTypeFlag5: 'BAG', styleNo: 'PQ3672A1', colorNo: 'VE-TEST' },
  )
  assert.equal(rows2[0].cutCode, 'CUT-BAGPQ3672A1/VE-TEST<1-1>')
})

test('appendBom000PaperPatternAuditColumns 列存在时写入审计字段', () => {
  const colset = new Set(['uid', 'uname', 'utruename', 'addtime', 'edittime', 'ip'])
  const cols = []
  const vals = []
  const inputs = new Map()
  const ins = {
    input(name, _type, value) {
      inputs.set(name, value)
    },
  }
  appendBom000PaperPatternAuditColumns(colset, ins, cols, vals, {
    actor: { uidInt: 42, uname: 'u01', utruename: '张三' },
    addtime: '2026-05-17 10:00:00',
    ip: '127.0.0.1',
  })
  assert.deepEqual(cols, ['uid', 'uname', 'utruename', 'addtime', 'edittime', 'ip'])
  assert.equal(inputs.get('ins_uid'), 42)
  assert.equal(inputs.get('ins_uname'), 'u01')
  assert.equal(inputs.get('ins_utruename'), '张三')
  assert.equal(inputs.get('ins_addtime'), '2026-05-17 10:00:00')
  assert.equal(inputs.get('ins_edittime'), '2026-05-17 10:00:00')
  assert.equal(inputs.get('ins_ip'), '127.0.0.1')
})
