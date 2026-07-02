import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockInLabelHeaderSql,
  buildStockInLabelItems,
  buildStockInLabelLinesSql,
  fetchStockInLabelPrintDocuments,
  parseStockInLabelReceiptNos,
} from './stockInLabelPrintData.js'

describe('stock-in label print data', () => {
  test('parseStockInLabelReceiptNos splits p_sumbq and removes empty values', () => {
    assert.deepEqual(parseStockInLabelReceiptNos(' R001,,R002 '), ['R001', 'R002'])
  })

  test('empty p_sumbq returns old-system error code', async () => {
    const result = await fetchStockInLabelPrintDocuments({ request() { throw new Error('should not query') } }, { pSumbq: '' })
    assert.equal(result.ok, false)
    assert.equal(result.msg, 'Error,Code:208')
  })

  test('header SQL only allows approved undeleted stock-in receipts', () => {
    const sqlText = buildStockInLabelHeaderSql()
    assert.match(sqlText, /UB_ERP_Stocks_Storage/i)
    assert.match(sqlText, /\[kcan01\].*?@receiptNo/is)
    assert.match(sqlText, /\[pass\].*?N'1'/is)
    assert.match(sqlText, /\[del\]/i)
  })

  test('line SQL reads undeleted lines by receipt no and joins color table', () => {
    const sqlText = buildStockInLabelLinesSql()
    assert.match(sqlText, /UB_ERP_Stocks_Storage_list/i)
    assert.match(sqlText, /UB_ERP_Stocks_colorcode/i)
    assert.match(sqlText, /l\.\[kcao01\].*?@receiptNo/is)
    assert.match(sqlText, /c\.\[code\].*?l\.\[kcaa11\]/is)
    assert.match(sqlText, /ORDER BY ISNULL\(l\.\[seq\], l\.\[id\]\), l\.\[id\]/i)
  })

  test('buildStockInLabelItems creates one label per line with color fallback', () => {
    const labels = buildStockInLabelItems({
      header: { kcan01: 'R26070201', kcan02: '2026-07-02 08:24:36', kcan07: '张三' },
      lines: [
        { id: 1, kcaa01: 'ZS-0034/CFL', kcaa02_en: '#5 zipper slider', kcaa11: 'CFL', colorName: '亮枪色', kcao03: 11400, kcan04: 'ZY-1' },
        { id: 2, kcaa01: 'ZS-0021/BLUE', kcaa02: '拉链头', kcaa11: 'BLUE', colorName: '', kcao03: '6.00' },
      ],
    })
    assert.equal(labels.length, 2)
    assert.equal(labels[0].nameLabel, 'Name: #5 zipper slider')
    assert.equal(labels[0].colorText, '亮枪色/CFL')
    assert.equal(labels[0].quantityText, '11400')
    assert.equal(labels[0].sourceOrderNo, 'ZY-1')
    assert.equal(labels[0].handlerName, '张三')
    assert.equal(labels[0].qrContent, '/view.asp?action=stocks&kcaa01=ZS-0034%2FCFL&kcao01=R26070201')
    assert.equal(labels[0].legacyQrContent, 'view.asp?action=stocks&kcaa01=ZS-0034%2FCFL&kcao01=R26070201')
    assert.equal(labels[1].nameLabel, 'R26070201 拉链头')
    assert.equal(labels[1].colorText, 'BLUE/BLUE')
    assert.equal(labels[1].quantityText, '6')
  })

  test('fetchStockInLabelPrintDocuments keeps receipt order and rejects missing approved receipt', async () => {
    const seen = []
    const pool = {
      request() {
        const inputs = {}
        return {
          input(name, _type, value) {
            inputs[name] = value
            return this
          },
          async query(sqlText) {
            seen.push({ sqlText, inputs: { ...inputs } })
            if (/UB_ERP_Stocks_Storage\]/i.test(sqlText) && /TOP 1/i.test(sqlText)) {
              if (inputs.receiptNo === 'BAD') return { recordset: [] }
              return { recordset: [{ kcan01: inputs.receiptNo, pass: '1', del: '0', kcan02: '2026-07-02 08:24:36' }] }
            }
            return {
              recordset: [
                { id: 1, kcaa01: `${inputs.receiptNo}-A`, kcaa02: '材料A', kcaa11: 'CFL', colorName: '亮枪色', kcao03: 1 },
                { id: 2, kcaa01: `${inputs.receiptNo}-B`, kcaa02: '材料B', kcaa11: 'RED', colorName: '', kcao03: 2 },
              ],
            }
          },
        }
      },
    }

    const ok = await fetchStockInLabelPrintDocuments(pool, { pSumbq: 'R001,R002' })
    assert.equal(ok.ok, true)
    assert.deepEqual(ok.list.map((doc) => doc.header.kcan01), ['R001', 'R002'])
    assert.equal(ok.labels.length, 4)
    assert.equal(seen[0].inputs.receiptNo, 'R001')

    const missing = await fetchStockInLabelPrintDocuments(pool, { pSumbq: 'BAD' })
    assert.equal(missing.ok, false)
    assert.equal(missing.status, 404)
    assert.equal(missing.msg, '数据不存在，请返回检查！')
  })
})
