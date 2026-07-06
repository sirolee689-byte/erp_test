import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildBuyOrderPrintDetailLinesSql,
  fetchBuyOrderPrintDocuments,
  normalizeBuyOrderPrintLanguage,
  normalizeBuyOrderPrintMode,
  parseBuyOrderPrintNos,
} from './buyOrderPrintData.js'

function createPool({ headers = {}, lines = {}, fees = {} } = {}) {
  const queries = []
  return {
    queries,
    request() {
      const inputs = {}
      return {
        input(name, _type, value) {
          inputs[name] = value
          return this
        },
        async query(sqlText) {
          queries.push({ sqlText, inputs: { ...inputs } })
          if (/UB_ERP_System_Head/i.test(sqlText)) return { recordset: [{ logo: '<img src="/logo.png" />', info: '<p>采购单抬头</p>' }] }
          if (/FROM dbo\.\[UB_ERP_Buy_order\]/i.test(sqlText)) {
            const header = headers[inputs.orderNo]
            return { recordset: header ? [header] : [] }
          }
          if (/FROM dbo\.\[UB_ERP_Buy_order_list\]/i.test(sqlText)) {
            return { recordset: lines[inputs.orderNo] ?? [] }
          }
          if (/FROM dbo\.\[UB_ERP_Buy_order_money\]/i.test(sqlText)) {
            return { recordset: fees[inputs.orderNo] ?? [] }
          }
          return { recordset: [] }
        },
      }
    },
  }
}

const headerA = {
  id: 1,
  buyOrderNo: 'ZY-1',
  supplierCode: 'S01',
  supplierName: '供应商A',
  currencyName: '人民币',
  pass: '1',
}

const headerB = {
  id: 2,
  buyOrderNo: 'ZY-2',
  supplierCode: 'S01',
  supplierName: '供应商A',
  currencyName: '人民币',
  pass: '1',
}

const headerOther = {
  id: 3,
  buyOrderNo: 'ZY-3',
  supplierCode: 'S02',
  supplierName: '供应商B',
  currencyName: '人民币',
  pass: '1',
}

function materialLine(orderNo, qty, amountInc = qty * 11.3) {
  return {
    id: `${orderNo}-${qty}`,
    kcak01: orderNo,
    kcaa01: 'MB-001',
    kcaa02: '中文材料',
    kcaa02_en: 'English Material',
    kcaa03: 'SPEC',
    kcaa04: 'PC',
    kcaa25: 'PC',
    kcaa11: '580',
    colorName: '黑色',
    kcak03: qty,
    kcak04: 10,
    kcak041: 11.3,
    kcak05: qty * 10,
    kcak051: amountInc,
    tax: 0.13,
    delivery_date: '2026-07-10',
  }
}

describe('buy-order print data', () => {
  test('parse and normalize print params', () => {
    assert.deepEqual(parseBuyOrderPrintNos(' ZY-1, ,ZY-2 '), ['ZY-1', 'ZY-2'])
    assert.equal(normalizeBuyOrderPrintMode('2'), '2')
    assert.equal(normalizeBuyOrderPrintMode('x'), '1')
    assert.equal(normalizeBuyOrderPrintLanguage('2'), '2')
    assert.equal(normalizeBuyOrderPrintLanguage('x'), '1')
  })

  test('empty p_sum returns user-facing selection error', async () => {
    const result = await fetchBuyOrderPrintDocuments({ request() { throw new Error('should not query') } }, { pSum: '' })
    assert.equal(result.ok, false)
    assert.equal(result.msg, '请选择需要打印的单据')
  })

  test('detail line SQL uses purchase-order line table and SQL Server 2008 compatible syntax', () => {
    const sqlText = buildBuyOrderPrintDetailLinesSql()
    assert.match(sqlText, /UB_ERP_Buy_order_list/i)
    assert.match(sqlText, /kcak01/i)
    assert.doesNotMatch(sqlText, /TRY_CONVERT|TRY_CAST|OFFSET\s+FETCH|FORMAT\(|IIF\(|CONCAT\(/i)
  })

  test('detail print returns one document per selected order and keeps p_sum order', async () => {
    const pool = createPool({
      headers: { 'ZY-1': headerA, 'ZY-2': headerB },
      lines: { 'ZY-1': [materialLine('ZY-1', 1)], 'ZY-2': [materialLine('ZY-2', 2)] },
    })
    const result = await fetchBuyOrderPrintDocuments(pool, {
      pSum: 'ZY-2,ZY-1',
      printMode: '1',
      language: '2',
      actor: { trueName: '不会使用', utruename: '也不会使用', truename: '管理员' },
    })
    assert.equal(result.ok, true)
    assert.deepEqual(result.list.map((doc) => doc.header.buyOrderNo), ['ZY-2', 'ZY-1'])
    assert.equal(result.list[0].lines[0].materialName, 'English Material')
    assert.equal(result.list[0].makerName, '管理员')
    assert.equal(result.printConfig.logoSrc, '/logo.png')
    assert.equal(result.printConfig.headerHtml, '<p>采购单抬头</p>')
  })

  test('detail print reads tax from physical Tax column when lowercase tax is absent', async () => {
    const line = materialLine('ZY-1', 1)
    line.Tax = 0.13
    delete line.tax
    const pool = createPool({
      headers: { 'ZY-1': headerA },
      lines: { 'ZY-1': [line] },
    })
    const result = await fetchBuyOrderPrintDocuments(pool, { pSum: 'ZY-1' })
    assert.equal(result.ok, true)
    assert.equal(result.list[0].lines[0].tax, 0.13)
  })

  test('maker name only uses login truename', async () => {
    const pool = createPool({
      headers: { 'ZY-1': headerA },
      lines: { 'ZY-1': [materialLine('ZY-1', 1)] },
    })
    const result = await fetchBuyOrderPrintDocuments(pool, {
      pSum: 'ZY-1',
      actor: { trueName: '不会使用', utruename: '也不会使用' },
    })
    assert.equal(result.ok, true)
    assert.equal(result.list[0].makerName, '')
  })

  test('summary print rejects multiple suppliers', async () => {
    const pool = createPool({
      headers: { 'ZY-1': headerA, 'ZY-3': headerOther },
      lines: { 'ZY-1': [materialLine('ZY-1', 1)], 'ZY-3': [materialLine('ZY-3', 1)] },
    })
    const result = await fetchBuyOrderPrintDocuments(pool, { pSum: 'ZY-1,ZY-3', printMode: '2' })
    assert.equal(result.ok, false)
    assert.equal(result.msg, '多张汇总打印，客户必须一致！')
  })

  test('summary print groups same material price tax and delivery date', async () => {
    const pool = createPool({
      headers: { 'ZY-1': headerA, 'ZY-2': headerB },
      lines: { 'ZY-1': [materialLine('ZY-1', 2)], 'ZY-2': [materialLine('ZY-2', 3)] },
    })
    const result = await fetchBuyOrderPrintDocuments(pool, { pSum: 'ZY-1,ZY-2', printMode: '2' })
    assert.equal(result.ok, true)
    assert.equal(result.list.length, 1)
    assert.equal(result.list[0].documentType, 'summary')
    assert.equal(result.list[0].lines.length, 1)
    assert.equal(result.list[0].lines[0].quantity, 5)
    assert.equal(result.list[0].lines[0].taxExcludedAmount, 50)
    assert.equal(result.list[0].totals.taxIncludedAmount, 56.5)
  })

  test('price fields are omitted without price permission', async () => {
    const pool = createPool({
      headers: { 'ZY-1': headerA },
      lines: { 'ZY-1': [materialLine('ZY-1', 1)] },
    })
    const result = await fetchBuyOrderPrintDocuments(pool, { pSum: 'ZY-1', hasPricePermission: false })
    assert.equal(result.ok, true)
    assert.equal(result.list[0].hasPricePermission, false)
    assert.equal(Object.hasOwn(result.list[0].lines[0], 'taxIncludedPrice'), false)
    assert.equal(Object.hasOwn(result.list[0].totals, 'taxIncludedAmount'), false)
  })
})
