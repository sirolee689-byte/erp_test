import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { invalidateSysUsersColumnsMeta } from './sysUsersDb.js'
import { registerBuyOrderRoutes } from './buyOrderHandlers.js'

function createMockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

function createPool() {
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
          if (/INFORMATION_SCHEMA\.COLUMNS/i.test(sqlText) && /New_UB_ERP_User/i.test(sqlText)) {
            return {
              recordset: [
                { n: 'UserID', maxLen: null },
                { n: 'usercode', maxLen: 80 },
                { n: 'username', maxLen: 100 },
                { n: 'truename', maxLen: 100 },
              ],
            }
          }
          if (/FROM dbo\.\[New_UB_ERP_User\]/i.test(sqlText)) {
            return { recordset: [{ userId: 7, userName: 'buyer01', truename: '采购员张三' }] }
          }
          if (/UB_ERP_System_Head/i.test(sqlText)) {
            return { recordset: [{ logo: '', info: '<p>采购单表头</p>' }] }
          }
          if (/FROM dbo\.\[UB_ERP_Buy_order\]/i.test(sqlText)) {
            return {
              recordset: [
                {
                  id: 1,
                  buyOrderNo: inputs.orderNo,
                  supplierCode: 'S01',
                  supplierName: '供应商A',
                  currencyName: '人民币',
                  pass: '1',
                },
              ],
            }
          }
          if (/FROM dbo\.\[UB_ERP_Buy_order_list\]/i.test(sqlText)) {
            return {
              recordset: [
                {
                  id: 1,
                  kcak01: inputs.orderNo,
                  kcaa01: 'MB-001',
                  kcaa02: '材料',
                  kcaa25: 'PC',
                  kcak03: 1,
                  kcak041: 2,
                  kcak051: 2,
                  tax: 0.13,
                },
              ],
            }
          }
          if (/FROM dbo\.\[UB_ERP_Buy_order_money\]/i.test(sqlText)) {
            return { recordset: [] }
          }
          return { recordset: [] }
        },
      }
    },
  }
}

describe('buy-order print route', () => {
  test('GET /api/buy-order/print-data resolves New_UB_ERP_User.truename for makerName', async () => {
    invalidateSysUsersColumnsMeta()
    const routes = {}
    const app = {
      get(path, handler) {
        routes[`GET ${path}`] = handler
      },
      post() {},
      put() {},
      delete() {},
    }
    const pool = createPool()
    registerBuyOrderRoutes(app, { getPool: async () => pool })

    const handler = routes['GET /api/buy-order/print-data']
    assert.equal(typeof handler, 'function')

    const res = createMockRes()
    await handler(
      {
        query: { p_sum: 'ZY-260852', print_mx: '1', print_cn: '1' },
        user: { userCode: 'buyer01', auditTruename: '', utruename: '' },
      },
      res,
    )

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.code, 200)
    assert.equal(res.body.data.list[0].makerName, '采购员张三')
  })
})
