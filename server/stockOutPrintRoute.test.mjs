import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { invalidateSysUsersColumnsMeta } from './sysUsersDb.js'
import { registerStockOutRoutes } from './stockOutHandlers.js'

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
  return {
    request() {
      const inputs = {}
      return {
        input(name, _type, value) {
          inputs[name] = value
          return this
        },
        async query(sqlText) {
          if (/INFORMATION_SCHEMA\.COLUMNS/i.test(sqlText) && /New_UB_ERP_User/i.test(sqlText)) {
            return { recordset: [{ n: 'UserID' }, { n: 'usercode' }, { n: 'username' }, { n: 'truename' }] }
          }
          if (/FROM dbo\.\[New_UB_ERP_User\]/i.test(sqlText)) {
            return { recordset: [{ userId: 7, userName: 'stockout01', truename: '出库制表员' }] }
          }
          if (/UB_ERP_System_Head/i.test(sqlText)) return { recordset: [{ logo: '' }] }
          if (/FROM dbo\.\[UB_ERP_Stocks_out\]/i.test(sqlText)) {
            return { recordset: [{ systemcode: inputs.systemcode, kcap01: 'C0001', kcap03: '0', pass: '0', del: '0' }] }
          }
          return { recordset: [{ id: 1, kcaq01: 'C0001', kcaa01: 'M001', kcaq03: 1 }] }
        },
      }
    },
  }
}

describe('stock-out print route', () => {
  test('resolves New_UB_ERP_User.truename for makerName when the token has no true name', async () => {
    invalidateSysUsersColumnsMeta()
    const routes = {}
    const app = {
      get(path, handler) { routes[`GET ${path}`] = handler },
      post() {},
      put() {},
      delete() {},
    }
    const pool = createPool()
    registerStockOutRoutes(app, { getPool: async () => pool })

    const res = createMockRes()
    await routes['GET /api/stock-out/print-data'](
      { query: { p_sum: 'S1', print_cn: '2' }, user: { userCode: 'stockout01', auditTruename: '', utruename: '' } },
      res,
    )

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.code, 200)
    assert.equal(res.body.data.list[0].makerName, '出库制表员')
  })
})
