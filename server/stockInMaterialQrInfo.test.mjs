import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockInMaterialQrBaseSql,
  buildStockInMaterialQrInventorySql,
  buildStockInMaterialQrRecentInboundSql,
  buildStockInMaterialQrRecentPurchaseSql,
  fetchStockInMaterialQrInfo,
  parseStockInMaterialQrQuery,
  validateStockInMaterialQrQuery,
} from './stockInMaterialQrInfo.js'

describe('stock-in material QR info', () => {
  test('参数解析和校验要求 action、材料编码、入库单号齐全', () => {
    assert.deepEqual(parseStockInMaterialQrQuery({ action: 'stocks', kcaa01: ' A ', kcao01: ' R1 ' }), {
      action: 'stocks',
      materialCode: 'A',
      receiptNo: 'R1',
    })
    assert.equal(validateStockInMaterialQrQuery({ action: 'bad', materialCode: 'A', receiptNo: 'R1' }), '二维码类型不正确')
    assert.equal(validateStockInMaterialQrQuery({ action: 'stocks', materialCode: '', receiptNo: 'R1' }), '二维码参数不完整')
  })

  test('基础 SQL 按入库单号和物料编码读取入库明细并关联物料资料', () => {
    const sqlText = buildStockInMaterialQrBaseSql()
    assert.match(sqlText, /UB_ERP_Stocks_Storage/i)
    assert.match(sqlText, /UB_ERP_Stocks_Storage_list/i)
    assert.match(sqlText, /UB_ERP_Bom_000/i)
    assert.match(sqlText, /UB_ERP_Stocks_colorcode/i)
    assert.match(sqlText, /h\.\[kcan01\] = @receiptNo/i)
    assert.match(sqlText, /l\.\[kcaa01\] = @materialCode/i)
  })

  test('库存 SQL 只统计已审核未删除的入库和出库', () => {
    const sqlText = buildStockInMaterialQrInventorySql()
    assert.match(sqlText, /ih\.\[pass\].*N'1'/is)
    assert.match(sqlText, /oh\.\[pass\].*N'1'/is)
    assert.match(sqlText, /ih\.\[del\]/i)
    assert.match(sqlText, /oh\.\[del\]/i)
    assert.match(sqlText, /N'货仓'/)
    assert.match(sqlText, /N'板房'/)
  })

  test('最近采购和最近入库 SQL 按时间倒序返回', () => {
    assert.match(buildStockInMaterialQrRecentPurchaseSql(), /TOP 10/i)
    assert.match(buildStockInMaterialQrRecentPurchaseSql(), /ORDER BY h\.\[kcaj02\] DESC/i)
    assert.match(buildStockInMaterialQrRecentInboundSql(), /TOP 5/i)
    assert.match(buildStockInMaterialQrRecentInboundSql(), /ORDER BY h\.\[kcan02\] DESC/i)
  })

  test('查询成功时返回页面需要的完整数据结构', async () => {
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
            if (/SELECT TOP 1\s/i.test(sqlText)) {
              return {
                recordset: [{
                  receiptNo: 'R26070204',
                  inboundTime: '2026-07-02 08:24:36',
                  sourceOrderNo: 'ZY-260791',
                  reference: 'PI4168/4170/4171',
                  inboundQty: '1583.0000',
                  materialCode: 'ZY-0065/19-1110TPG',
                  chineseName: '#5 磨光双点牙亮枪铜牙链(双向)',
                  englishName: '#5 METAL ZIPPER(DOUBLE WAYS)',
                  colorCode: '19-1110TPG',
                  colorName: '啡色',
                  unit: 'YD',
                  categoryName: '拉链类',
                }],
              }
            }
            if (/WITH inAgg/i.test(sqlText)) {
              return { recordset: [{ warehouseGroup: '货仓', qty: '2042.0840' }, { warehouseGroup: '板房', qty: 0 }] }
            }
            if (/UB_ERP_Buy_order/i.test(sqlText)) {
              return { recordset: [{ purchaseNo: 'ZY-260791', purchaseDate: '2026-06-03', qty: 1583 }] }
            }
            return { recordset: [{ receiptNo: 'R26070204', inboundTime: '2026-07-02 08:24:36', sourceOrderNo: 'ZY-260791', qty: 1583 }] }
          },
        }
      },
    }
    const result = await fetchStockInMaterialQrInfo(pool, { action: 'stocks', kcaa01: 'ZY-0065/19-1110TPG', kcao01: 'R26070204' })
    assert.equal(result.ok, true)
    assert.equal(result.info.developerName, '廖越锋')
    assert.equal(result.info.materialCode, 'ZY-0065/19-1110TPG')
    assert.equal(result.info.inventory.warehouseQty, '2042.084')
    assert.equal(result.info.inventory.sampleRoomQty, '0')
    assert.equal(result.info.recentPurchases[0].purchaseNo, 'ZY-260791')
    assert.equal(result.info.recentInbounds[0].receiptNo, 'R26070204')
    assert.equal(calls[0].inputs.receiptNo, 'R26070204')
  })

  test('查不到入库明细时返回旧系统提示', async () => {
    const pool = {
      request() {
        return {
          input() { return this },
          async query() { return { recordset: [] } },
        }
      },
    }
    const result = await fetchStockInMaterialQrInfo(pool, { action: 'stocks', kcaa01: 'A', kcao01: 'R1' })
    assert.equal(result.ok, false)
    assert.equal(result.status, 404)
    assert.equal(result.msg, '数据不存在，请返回检查！')
  })
})
