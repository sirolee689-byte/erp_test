import test from 'node:test'
import assert from 'node:assert/strict'
import {
  __productionIssueStatsForTest as api,
} from './productionIssueStatsHandlers.js'

const {
  parseReportQuery,
  parsePiList,
  validateReportQuery,
  buildReportWhereSql,
  buildProductionIssueStatsReportSql,
  buildProductionIssueSummarySql,
  buildPiScopeCteSql,
  buildPiOptionsKeywordSql,
  serializeReportRow,
  serializeSummarySections,
  choosesLabel,
} = api

test('明细：出库侧强制 pass=1 且 kcap03 限定生产领用类型', () => {
  const q = parseReportQuery({
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    warehouseCode: '001',
    chooses: '2',
  })
  const whereSql = buildReportWhereSql(q)
  assert.match(whereSql, /h\.\[pass\][\s\S]*= N'1'/i)
  assert.match(whereSql, /kcap03[\s\S]*IN \(N'2', N'4', N'7', N'8'\)/i)
  assert.match(whereSql, /h\.\[kcap02\] >= @startDate/i)
  assert.match(whereSql, /h\.\[kcap02\] <= @endDate/i)
})

test('明细：chooses=1 未填 PI 时使用 pi_scope CTE', () => {
  const q = parseReportQuery({
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    warehouseCode: '001',
    chooses: '1',
  })
  const sql = buildProductionIssueStatsReportSql(q)
  assert.match(sql, /WITH[\s\S]*pi_scope AS/i)
  assert.match(sql, /\[xsaj02\] >= @startDate/i)
  assert.match(sql, /IN \(SELECT piNo FROM pi_scope\)/i)
  assert.doesNotMatch(sql, /h\.\[kcap02\] >= @startDate/i)
})

test('明细：chooses=1 手填 PI 时直接 IN 参数', () => {
  const q = parseReportQuery({
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    warehouseCode: '001',
    chooses: '1',
    piPoNos: 'PI-001,PI-002',
  })
  const whereSql = buildReportWhereSql(q)
  assert.match(whereSql, /@pi0/)
  assert.match(whereSql, /@pi1/)
  assert.doesNotMatch(whereSql, /pi_scope/i)
  const sql = buildProductionIssueStatsReportSql(q)
  assert.doesNotMatch(sql, /WITH[\s\S]*pi_scope/i)
})

test('明细：chooses=2 手填 PI 追加 kcap08 条件', () => {
  const q = parseReportQuery({
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    warehouseCode: '001',
    chooses: '2',
    piPoNos: 'PI-100',
  })
  const whereSql = buildReportWhereSql(q)
  assert.match(whereSql, /h\.\[kcap02\] >= @startDate/i)
  assert.match(whereSql, /@pi0/)
})

test('PI 列表解析支持中英文逗号并去重', () => {
  const list = parsePiList('A,B，B,C')
  assert.deepEqual(list, ['A', 'B', 'C'])
})

test('必填校验：汇总不要求统计标准，明细要求统计标准', () => {
  assert.match(validateReportQuery(parseReportQuery({})), /开始日期/)
  assert.match(
    validateReportQuery(parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03' })),
    /仓库/
  )
  assert.match(
    validateReportQuery(parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
      viewMode: 'detail',
    })),
    /统计标准/
  )
  assert.equal(
    validateReportQuery(parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
      viewMode: 'summary',
    })),
    ''
  )
})

test('明细序列化：退料为 0，实领等于领用', () => {
  const row = serializeReportRow({ outboundNo: 'OUT-1', lineId: 9, issueQty: 12.5 }, 0)
  assert.equal(row.returnQty, 0)
  assert.equal(row.netQty, 12.5)
  assert.equal(row.issueQty, 12.5)
  assert.equal(row.remark, '')
})

test('choosesLabel 文案', () => {
  assert.equal(choosesLabel('1'), '销售订单 PI 时间')
  assert.equal(choosesLabel('2'), '出库单时间')
})

test('buildPiScopeCteSql 含销售订单日期、已审、未删除和手填 PI 条件', () => {
  const cte = buildPiScopeCteSql(parseReportQuery({
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    warehouseCode: '001',
    piPoNos: 'PI-1',
  }))
  assert.match(cte, /UB_ERP_Sales_order/i)
  assert.match(cte, /xsaj02/i)
  assert.match(cte, /pass[\s\S]*= N'1'/i)
  assert.match(cte, /del/i)
  assert.match(cte, /@pi0/)
})

test('PI 候选弹窗 keyword 只按 PI 号模糊查询', () => {
  const keywordSql = buildPiOptionsKeywordSql(true)
  assert.match(keywordSql, /xsaj01/i)
  assert.doesNotMatch(keywordSql, /xsaj06/i)
  assert.doesNotMatch(keywordSql, /xsaj05/i)
})

test('汇总：预算从 pi_cost 乘销售订单明细数量', () => {
  const q = parseReportQuery({
    viewMode: 'summary',
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    warehouseCode: '001',
  })
  const sql = buildProductionIssueSummarySql(q)
  assert.match(sql, /UB_ERP_Bom_pi_cost/i)
  assert.match(sql, /UB_ERP_Sales_order_list/i)
  assert.match(sql, /kcac06[\s\S]*\*[\s\S]*xsak03/i)
  assert.match(sql, /c\.\[pq\][\s\S]*sl\.\[kcaa01\]/i)
})

test('汇总：领用数量包含未审核出库且按仓库、日期、PI、物料过滤', () => {
  const q = parseReportQuery({
    viewMode: 'summary',
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    warehouseCode: '001',
    materialCode: 'BP-',
  })
  const sql = buildProductionIssueSummarySql(q)
  assert.match(sql, /h\.\[pass\][\s\S]*IN \(N'0', N'1'\)/i)
  assert.match(sql, /h\.\[kcap02\] >= @startDate/i)
  assert.match(sql, /h\.\[kcap02\] <= @endDate/i)
  assert.match(sql, /h\.\[kcap06\][\s\S]*= @warehouseCode/i)
  assert.match(sql, /h\.\[kcap08\][\s\S]*LIKE N'PI%'/i)
  assert.match(sql, /l\.\[kcaa01\][\s\S]*LIKE @materialPrefix/i)
})

test('汇总：退料数量按旧口径不加日期范围', () => {
  const q = parseReportQuery({
    viewMode: 'summary',
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    warehouseCode: '001',
  })
  const sql = buildProductionIssueSummarySql(q)
  const returnPart = sql.split('return_qty AS')[1]
  assert.match(returnPart, /UB_ERP_Stocks_Storage/i)
  assert.match(returnPart, /kcan03[\s\S]*IN \(N'3', N'5'\)/i)
  assert.match(returnPart, /h\.\[pass\][\s\S]*= N'1'/i)
  assert.match(returnPart, /h\.\[kcan06\][\s\S]*= @warehouseCode/i)
  assert.doesNotMatch(returnPart, /kcan02[\s\S]*@startDate/i)
  assert.doesNotMatch(returnPart, /kcan02[\s\S]*@endDate/i)
})

test('汇总：未领数量按预算-领用-退料，不按预算-实领', () => {
  const q = parseReportQuery({
    viewMode: 'summary',
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    warehouseCode: '001',
  })
  const sql = buildProductionIssueSummarySql(q)
  assert.match(sql, /b\.yssum - ISNULL\(i\.lysum, 0\) - ISNULL\(r\.tlsum, 0\) END AS wlsim/i)
})

test('汇总：只显示未领时追加 wlsim > 0 过滤', () => {
  const q = parseReportQuery({
    viewMode: 'summary',
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    warehouseCode: '001',
    onlyUnissued: '1',
  })
  const sql = buildProductionIssueSummarySql(q)
  assert.match(sql, /WHERE CASE WHEN b\.yssum = 0 THEN 0 ELSE b\.yssum - ISNULL\(i\.lysum, 0\) - ISNULL\(r\.tlsum, 0\) END > 0/i)
})

test('汇总序列化：按 PI 分段并清理英文逗号备注', () => {
  const sections = serializeSummarySections([
    {
      piNo: 'PI-1',
      poNo: 'PO-1',
      salesDate: new Date('2026-07-01T00:00:00'),
      materialCode: 'M-1',
      materialName: '材料',
      materialSpec: '规格',
      unit: 'Y',
      yssum: 10,
      lysum: 3,
      tlsum: 1,
      slsum: 2,
      wlsim: 6,
      describeText: '备注1,备注2',
    },
  ])
  assert.equal(sections.length, 1)
  assert.equal(sections[0].piNo, 'PI-1')
  assert.equal(sections[0].rows[0].netQty, 2)
  assert.equal(sections[0].rows[0].unissuedQty, 6)
  assert.equal(sections[0].rows[0].remark, '备注1；备注2')
})
