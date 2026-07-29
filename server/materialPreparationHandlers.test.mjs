import assert from 'node:assert/strict'
import test from 'node:test'
import { __materialPreparationForTest as subject } from './materialPreparationHandlers.js'

test('材料备料表要求至少一个PI并支持中英文逗号去重', () => {
  assert.equal(subject.validateReportQuery(subject.parseReportQuery({ piNos: '' })), 'PI号不能为空')
  assert.deepEqual(
    subject.parseReportQuery({ mode: 'material-by-component', piNos: 'PI-1，PI-2,PI-1' }),
    { mode: 'material-by-component', piNos: ['PI-1', 'PI-2'] },
  )
})

test('未知模式回落到物料单分PI', () => {
  assert.equal(subject.parseReportQuery({ mode: 'unknown', piNos: 'PI-1' }).mode, 'material-by-pi')
})

test('PI候选默认每页10条且只按PI条件生成搜索', () => {
  assert.deepEqual(subject.parsePiOptionsQuery({}), { keyword: '', page: 1, pageSize: 10 })
  const sqlText = subject.buildPiOptionsSql('PI-41')
  assert.match(sqlText, /xsaj01/)
  assert.match(sqlText, /LIKE @keyword/)
  assert.equal((sqlText.match(/LIKE @keyword/g) ?? []).length, 1)
  assert.match(sqlText, /xsaj01[^\n]*\)\)\) LIKE @keyword/)
  assert.match(sqlText, /pass/)
  assert.match(sqlText, /ROW_NUMBER\(\)/)
})

test('物料单SQL使用PI BOM并按kcac06乘temp，不重复乘销售数量', () => {
  const sqlText = subject.buildMaterialReportSql('material-by-component', ['PI-1', 'PI-2'])
  assert.match(sqlText, /#selectedPi/)
  assert.match(sqlText, /UB_ERP_Bom_pi_cost/)
  assert.match(sqlText, /kcac06/)
  assert.match(sqlText, /temp/)
  assert.match(sqlText, /isok/)
  assert.match(sqlText, /kcaa12/)
  assert.match(sqlText, /componentCode/)
  assert.doesNotMatch(sqlText, /xsak03/)
  assert.doesNotMatch(sqlText, /STRING_SPLIT/)
})

test('出库单SQL取已审核有效出库及kcaq03，不限制出库类别', () => {
  const sqlText = subject.buildOutboundReportSql('outbound-by-pi', ['PI-1'])
  assert.match(sqlText, /UB_ERP_Stocks_out/)
  assert.match(sqlText, /UB_ERP_Stocks_out_list/)
  assert.match(sqlText, /h\.\[kcap04\] = p\.piNo OR h\.\[kcap08\] = p\.piNo/)
  assert.match(sqlText, /kcaq03/)
  assert.match(sqlText, /h\.\[pass\]/)
  assert.match(sqlText, /l\.\[kcaa12\]/)
  assert.doesNotMatch(sqlText, /kcap03\s+IN/i)
  assert.doesNotMatch(sqlText, /UB_ERP_Stocks_acc/)
})

test('分配件按需求比例分摊并由最后一项承接尾差', () => {
  const rows = subject.allocateOutboundComponentRows(
    [{ piNo: 'PI-1', materialCode: 'M-1', quantity: 1, materialName: '材料' }],
    [
      { piNo: 'PI-1', materialCode: 'M-1', componentCode: 'A', componentName: '配件A', quantity: 1 },
      { piNo: 'PI-1', materialCode: 'M-1', componentCode: 'B', componentName: '配件B', quantity: 1 },
      { piNo: 'PI-1', materialCode: 'M-1', componentCode: 'C', componentName: '配件C', quantity: 1 },
    ],
  )
  assert.deepEqual(rows.map((row) => row.quantity), [0.333333, 0.333333, 0.333334])
  assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), 1)
})

test('找不到有效BOM需求时进入未匹配配件且不丢数量', () => {
  const rows = subject.allocateOutboundComponentRows(
    [{ piNo: 'PI-1', materialCode: 'M-2', quantity: 7.25 }],
    [{ piNo: 'PI-1', materialCode: 'M-2', componentCode: 'A', quantity: 0 }],
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].componentName, '未匹配配件')
  assert.equal(rows[0].quantity, 7.25)
})

test('物料单分配件按产品材料和top_kcaa02汇总动态配件数量', () => {
  const sqlText = subject.buildMaterialReportSql('material-by-component', ['PI-1'])
  assert.match(sqlText, /c\.\[pq\].*AS productCode/s)
  assert.match(sqlText, /c\.\[top_kcaa02\].*AS componentName/s)
  assert.match(sqlText, /c\.\[kcaa01\].*AS materialCode/s)
  assert.match(sqlText, /SUM\(/)
  assert.match(sqlText, /d\.piNo, d\.productCode, d\.componentName/)
  assert.doesNotMatch(sqlText, /c\.\[top_kcaa01\].*AS componentCode/s)
})
