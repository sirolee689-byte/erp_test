import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildAssistOrderWarehouseInboundSql,
  buildAssistOrderWarehouseOutboundSql,
  fetchAssistOrderWarehouseRecords,
} from './assistOrderExpandDetail.js'

describe('assistOrderExpandDetail warehouse records', () => {
  test('inbound and outbound SQL keep the external-order warehouse filters and aggregate by document', () => {
    const inboundSql = buildAssistOrderWarehouseInboundSql('@ino0', '@imc0')
    const outboundSql = buildAssistOrderWarehouseOutboundSql('@ono0', '@omc0')

    assert.match(inboundSql, /UB_ERP_Stocks_Storage/i)
    assert.match(inboundSql, /UB_ERP_Stocks_Storage_list/i)
    assert.match(inboundSql, /h\.\[pass\]\s*=\s*1/i)
    assert.match(inboundSql, /h\.\[del\]\s*=\s*0/i)
    assert.match(inboundSql, /h\.\[kcan03\]\s*=\s*2/i)
    assert.match(inboundSql, /h\.\[kcan04\].*IN\s*\(@ino0\)/is)
    assert.match(inboundSql, /SUM\(ISNULL\(l\.\[kcao03\], 0\)\)/i)
    assert.match(inboundSql, /SUM\(ISNULL\(l\.\[kcao031\], 0\)\)/i)
    assert.doesNotMatch(inboundSql, /OFFSET|TRY_CONVERT|TRY_CAST/i)

    assert.match(outboundSql, /UB_ERP_Stocks_out/i)
    assert.match(outboundSql, /UB_ERP_Stocks_out_list/i)
    assert.match(outboundSql, /h\.\[pass\]\s*=\s*1/i)
    assert.match(outboundSql, /h\.\[del\]\s*=\s*0/i)
    assert.match(outboundSql, /h\.\[kcap03\]\s*=\s*2/i)
    assert.match(outboundSql, /h\.\[kcap04\].*IN\s*\(@ono0\)/is)
    assert.match(outboundSql, /SUM\(ISNULL\(l\.\[kcaq03\], 0\)\)/i)
    assert.doesNotMatch(outboundSql, /OFFSET|TRY_CONVERT|TRY_CAST/i)
  })

  test('groups multiple warehouse documents by external order and material code', async () => {
    const calls = []
    const pool = {
      request() {
        const inputs = {}
        return {
          input(name, _type, value) {
            inputs[name] = value
            return this
          },
          async query(sqlText) {
            calls.push({ sqlText, inputs: { ...inputs } })
            if (/UB_ERP_Stocks_Storage\]/i.test(sqlText)) {
              return { recordset: [
                { orderNo: 'WX1', materialCode: 'MAT1', documentNo: 'R1', quantity: 3 },
                { orderNo: 'WX1', materialCode: 'MAT1', documentNo: 'R2', quantity: 5 },
              ] }
            }
            return { recordset: [{ orderNo: 'WX1', materialCode: 'MAT1', documentNo: 'C1', quantity: 2 }] }
          },
        }
      },
    }

    const result = await fetchAssistOrderWarehouseRecords(pool, { orderNos: ['WX1'], materialCodes: ['MAT1'] })
    assert.equal(result.inboundByKey.get('WX1\u0000MAT1').length, 2)
    assert.equal(result.outboundByKey.get('WX1\u0000MAT1').length, 1)
    assert.deepEqual(calls[0].inputs, { ino0: 'WX1', imc0: 'MAT1' })
    assert.deepEqual(calls[1].inputs, { ono0: 'WX1', omc0: 'MAT1' })
  })
})
