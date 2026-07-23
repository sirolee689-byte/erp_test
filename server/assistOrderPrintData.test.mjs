import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildAssistOrderPrintDocument, normalizePrintSetup } from './assistOrderPrintData.js'

describe('assist order print data', () => {
  test('builds paged wxgs=0 documents with fee rows and tax-included totals', () => {
    const setup = normalizePrintSetup({ rowsPerPage: 3, priceDecimals: 4 })
    const doc = buildAssistOrderPrintDocument({
      header: {
        assistOrderNo: 'WX26060901',
        assistDate: '2026-06-09',
        referenceNo: 'PI-001',
        supplierCode: 'S001',
        supplierName: '加工商A',
        supplierShortName: '加工A',
        payFor: '月结',
        address: '深圳',
        contact: '张三',
        tel: '13800000000',
        currencyName: '人民币',
        taxIncluded: '1',
        remark: '备注',
      },
      lines: [
        { kcaa01: 'M001', kcaa02: '材料1', kcaa03: '规格1', product: 'P1', kcaa11: 'C01', colorName: '红色', kcaa10: 'G1', kcaa04: 'PCS', wxak03: 2, wxak04: 10, wxak041: 11.3, wxak05: 20, wxak051: 22.6, tax: 0.13, deliveryDate: '2026-06-20' },
        { kcaa01: 'M002', kcaa02: '材料2', kcaa03: '规格2', product: 'P2', wxak03: 3, wxak04: 5, wxak041: 5.65, wxak05: 15, wxak051: 16.95, tax: 0.13 },
        { kcaa01: 'M003', kcaa02: '材料3', wxak03: 4, wxak04: 2, wxak041: 2.26, wxak05: 8, wxak051: 9.04, tax: 0.13 },
      ],
      fees: [
        { feeCode: 'F01', feeName: '运费', money: 12.5 },
      ],
      makerName: '测试用户',
    }, setup)

    assert.equal(doc.wxgs, 0)
    assert.equal(doc.showDescribeColumn, false)
    assert.equal(doc.pages.length, 2)
    assert.equal(doc.pages[0].rows.length, 3)
    assert.equal(doc.pages[1].rows.length, 1)
    assert.equal(doc.pages[0].rows[0].price, '11.3000')
    assert.equal(doc.pages[0].rows[0].amount, '22.60')
    assert.equal(doc.pages[1].rows[0].type, 'fee')
    assert.equal(doc.pages[1].rows[0].amount, '12.50')
    assert.equal(doc.totals.quantity, '9.00')
    assert.equal(doc.totals.amount, '61.09')
    assert.equal(doc.contractTerms.length, 12)
    assert.equal(
      doc.contractTerms[0],
      '乙方要按甲方提供正确及标准样板生产。未得甲方书面同意不能随便改变动物料及做法。',
    )
    assert.equal(
      doc.contractTerms[8],
      '如乙方未能按期交货，而没有合理解释，甲方有权扣加工费每天5%',
    )
    assert.equal(
      doc.contractTerms[11],
      '甲方拥有由其支付模具费（或制版费）的模具归属权，模具在生产期间交由乙方保管，必要时，甲方有权拿回模具；乙方需无条件配合完整交还模具。',
    )
    assert.equal(doc.signature.makerName, '测试用户')
    assert.equal(doc.pages[0].pageTotal, 2)
    assert.equal(doc.pages[0].rows[0].describe, '')
  })

  test('wxgs=1 includes material describe and fee remark as outsourcing content', () => {
    const doc = buildAssistOrderPrintDocument({
      header: { assistOrderNo: 'WX26060902', taxIncluded: '2' },
      lines: [{ kcaa01: 'M001', wxak03: 1, wxak04: 10, wxak05: 10, describe: '车缝加工' }],
      fees: [{ feeCode: 'F01', feeName: '运费', money: 2, remark: '送货费' }],
    }, { wxgs: '1' })

    assert.equal(doc.wxgs, 1)
    assert.equal(doc.showDescribeColumn, true)
    assert.equal(doc.pages[0].rows[0].describe, '车缝加工')
    assert.equal(doc.pages[0].rows[1].describe, '送货费')
    assert.equal(doc.totals.amount, '12.00')
  })

  test('uses the external-order defaults when the current print page has no setup', () => {
    assert.deepEqual(normalizePrintSetup({}), { rowsPerPage: 12, priceDecimals: 2 })
    assert.deepEqual(normalizePrintSetup({ rowsPerPage: 8, priceDecimals: 4 }), { rowsPerPage: 8, priceDecimals: 4 })
  })
})
