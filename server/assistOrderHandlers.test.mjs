import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { registerAssistOrderRoutes } from './assistOrderHandlers.js'

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

describe('assistOrderHandlers', () => {
  test('GET /api/assist-order/list returns paged list data', async () => {
    /** @type {Record<string, Function>} */
    const routes = {}
    const app = {
      get(path, handler) {
        routes[`GET ${path}`] = handler
      },
      post(path, handler) {
        routes[`POST ${path}`] = handler
      },
      put(path, handler) {
        routes[`PUT ${path}`] = handler
      },
      delete(path, handler) {
        routes[`DELETE ${path}`] = handler
      },
    }
    const requests = []
    const pool = {
      request() {
        const inputs = {}
        const req = {
          input(name, _type, value) {
            inputs[name] = value
            return req
          },
          async query(sqlText) {
            requests.push({ sqlText, inputs: { ...inputs } })
            if (/COUNT\(1\)\s+AS\s+total/i.test(sqlText)) {
              return { recordset: [{ total: 1 }] }
            }
            return {
              recordset: [
                {
                  id: 8,
                  assistOrderNo: 'WX26060901',
                  assistDate: new Date('2026-06-09T00:00:00Z'),
                  assistType: '0',
                  referenceNo: '',
                  supplierCode: 'SUP-01',
                  supplierName: '测试外协商',
                  taxIncluded: '1',
                  currencyCode: 'RMB',
                  deliveryDate: new Date('2026-06-20T00:00:00Z'),
                  remark: 'remark',
                  notes: 'notes',
                  pass: '1',
                  closed: '0',
                  del: '0',
                  systemCode: 'SYS-8',
                  rn: 1,
                },
              ],
            }
          },
        }
        return req
      },
    }

    registerAssistOrderRoutes(app, { getPool: async () => pool })

    const handler = routes['GET /api/assist-order/list']
    assert.equal(typeof handler, 'function')

    const res = createMockRes()
    await handler({ query: { page: '2', pageSize: '5' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.code, 200)
    assert.equal(res.body.data.total, 1)
    assert.equal(res.body.data.list.length, 1)
    assert.equal(res.body.data.list[0].id, 8)
    assert.equal(res.body.data.list[0].assistOrderNo, 'WX26060901')
    assert.equal(res.body.data.list[0].rn, undefined)

    const listRequest = requests.find((r) => /ROW_NUMBER\(\)/i.test(r.sqlText))
    assert.ok(listRequest, 'list query should use ROW_NUMBER')
    assert.equal(listRequest.inputs.startRow, 6)
    assert.equal(listRequest.inputs.endRow, 10)
    assert.equal(listRequest.inputs.pass, '1')
  })

  test('GET /api/assist-order/:id returns header, lines, and fees', async () => {
    /** @type {Record<string, Function>} */
    const routes = {}
    const app = {
      get(path, handler) {
        routes[`GET ${path}`] = handler
      },
      post(path, handler) {
        routes[`POST ${path}`] = handler
      },
      put(path, handler) {
        routes[`PUT ${path}`] = handler
      },
      delete(path, handler) {
        routes[`DELETE ${path}`] = handler
      },
    }
    const pool = {
      request() {
        const inputs = {}
        const req = {
          input(name, _type, value) {
            inputs[name] = value
            return req
          },
          async query(sqlText) {
            if (/FROM\s+dbo\.\[UB_ERP_assist_order\]\s+AS\s+h/i.test(sqlText)) {
              return {
                recordset: [
                  {
                    id: 8,
                    assistOrderNo: 'WX26060901',
                    supplierName: '测试外协商',
                    pass: '1',
                    del: '0',
                  },
                ],
              }
            }
            if (/FROM\s+dbo\.\[UB_ERP_assist_order_list\]/i.test(sqlText)) {
              return {
                recordset: [
                  {
                    seq: 1,
                    piNo: 'PI-001',
                    kcaa01: 'MAT-001',
                    kcaa02: '材料',
                    wxak03: 12,
                    wxak04: 1.2345,
                    wxak041: 1.394,
                    wxak05: 14.81,
                    wxak051: 16.73,
                    tax: 0.13,
                    deliveryDate: '2026-06-20',
                    referenceNo: 'REF-1',
                    remark: 'line remark',
                  },
                ],
              }
            }
            if (/FROM\s+dbo\.\[UB_ERP_assist_order_money\]/i.test(sqlText)) {
              return {
                recordset: [
                  {
                    seq: 1,
                    feeCode: 'FEE-001',
                    feeName: '运费',
                    money: 20,
                    tax: 0,
                    remark: 'fee remark',
                  },
                ],
              }
            }
            return { recordset: [] }
          },
        }
        return req
      },
    }

    registerAssistOrderRoutes(app, { getPool: async () => pool })
    const handler = routes['GET /api/assist-order/:id']
    assert.equal(typeof handler, 'function')

    const res = createMockRes()
    await handler({ params: { id: '8' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.code, 200)
    assert.equal(res.body.data.header.id, 8)
    assert.equal(res.body.data.header.assistOrderNo, 'WX26060901')
    assert.equal(res.body.data.lines.length, 1)
    assert.equal(res.body.data.lines[0].kcaa01, 'MAT-001')
    assert.equal(res.body.data.fees.length, 1)
    assert.equal(res.body.data.fees[0].feeCode, 'FEE-001')
  })

  test('GET /api/assist-order/suggest-doc-no returns save-date based suggestion', async () => {
    const routes = {}
    const app = {
      get(path, handler) {
        routes[`GET ${path}`] = handler
      },
      post() {},
      put() {},
    }
    const pool = {
      request() {
        const req = {
          input() {
            return req
          },
          async query() {
            return { recordset: [{ assistOrderNo: 'WX26060901' }, { assistOrderNo: 'WX26060902' }] }
          },
        }
        return req
      },
    }

    registerAssistOrderRoutes(app, { getPool: async () => pool })
    const handler = routes['GET /api/assist-order/suggest-doc-no']
    assert.equal(typeof handler, 'function')

    const res = createMockRes()
    await handler({ query: { saveDate: '2026-06-09' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.code, 200)
    assert.equal(res.body.data.suggested, 'WX26060903')
  })

  test('POST /api/assist-order saves header and returns final order number', async () => {
    const routes = {}
    const app = {
      get(path, handler) {
        routes[`GET ${path}`] = handler
      },
      post(path, handler) {
        routes[`POST ${path}`] = handler
      },
      put(path, handler) {
        routes[`PUT ${path}`] = handler
      },
    }
    const saveCalls = []
    const saveService = {
      async createAssistOrder(opts) {
        saveCalls.push(opts)
        return { ok: true, id: 18, assistOrderNo: 'WX26060904', changedOrderNo: true }
      },
    }

    registerAssistOrderRoutes(app, { getPool: async () => ({}), saveService })
    const handler = routes['POST /api/assist-order']
    assert.equal(typeof handler, 'function')

    const res = createMockRes()
    await handler(
      {
        body: {
          header: {
            assistOrderNo: 'WX26060903',
            assistDate: '2026-06-09',
            assistType: '1',
            referenceNo: 'PI-001',
            supplierCode: 'S001',
            taxIncluded: '1',
            currencyCode: 'RMB',
            decimalPlaces: 4,
          },
        },
      },
      res,
    )

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.code, 200)
    assert.equal(res.body.data.id, 18)
    assert.equal(res.body.data.assistOrderNo, 'WX26060904')
    assert.equal(res.body.data.changedOrderNo, true)
    assert.equal(saveCalls[0].body.header.supplierCode, 'S001')
  })

  test('PUT /api/assist-order/:id relays audited or closed save rejection', async () => {
    const routes = {}
    const app = {
      get(path, handler) {
        routes[`GET ${path}`] = handler
      },
      post(path, handler) {
        routes[`POST ${path}`] = handler
      },
      put(path, handler) {
        routes[`PUT ${path}`] = handler
      },
    }
    const saveService = {
      async updateAssistOrder() {
        return { ok: false, status: 400, msg: '已审核或已结案单据不能保存修改' }
      },
    }

    registerAssistOrderRoutes(app, { getPool: async () => ({}), saveService })
    const handler = routes['PUT /api/assist-order/:id']
    assert.equal(typeof handler, 'function')

    const res = createMockRes()
    await handler(
      {
        params: { id: '8' },
        body: {
          header: {
            assistDate: '2026-06-09',
            assistType: '0',
            supplierCode: 'S001',
            taxIncluded: '1',
            currencyCode: 'RMB',
          },
        },
      },
      res,
    )

    assert.equal(res.statusCode, 400)
    assert.equal(res.body.code, 400)
    assert.match(res.body.msg, /已审核|已结案/)
  })
  test('GET /api/assist-order/material-options reads audited active bom_000 rows for other assist orders', async () => {
    const routes = {}
    const app = {
      get(path, handler) {
        routes[`GET ${path}`] = handler
      },
      post() {},
      put() {},
    }
    let capturedSql = ''
    const pool = {
      request() {
        const req = {
          input() {
            return req
          },
          async query(sqlText) {
            capturedSql = sqlText
            return {
              recordset: [
                {
                  source: 'bom_000',
                  piNo: '',
                  product: '',
                  orderQty: null,
                  kcaa01: 'MAT-001',
                  kcaa02: 'Material A',
                  kcaa03: 'Spec A',
                  kcaa04: 'PCS',
                  kcaa05: 'FEE',
                  isOutsource: 1,
                },
              ],
            }
          },
        }
        return req
      },
    }

    registerAssistOrderRoutes(app, { getPool: async () => pool })
    const handler = routes['GET /api/assist-order/material-options']
    assert.equal(typeof handler, 'function')

    const res = createMockRes()
    await handler({ query: { assistType: '0', keyword: 'MAT' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.code, 200)
    assert.equal(res.body.data.list[0].kcaa01, 'MAT-001')
    assert.equal(res.body.data.list[0].isSelectable, true)
    assert.match(capturedSql, /FROM\s+dbo\.\[bom_000\]\s+AS\s+src/i)
    assert.match(capturedSql, /src\.\[pass\]/i)
    assert.match(capturedSql, /src\.\[del\]/i)
  })

  test('GET /api/assist-order/fee-options reads audited active bom_000 fee rows', async () => {
    const routes = {}
    const app = {
      get(path, handler) {
        routes[`GET ${path}`] = handler
      },
      post() {},
      put() {},
    }
    let capturedSql = ''
    const pool = {
      request() {
        const req = {
          input() {
            return req
          },
          async query(sqlText) {
            capturedSql = sqlText
            return { recordset: [{ feeCode: 'FEE-01', feeName: 'Freight', kcaa05: 'FEE' }] }
          },
        }
        return req
      },
    }

    registerAssistOrderRoutes(app, { getPool: async () => pool })
    const handler = routes['GET /api/assist-order/fee-options']
    assert.equal(typeof handler, 'function')

    const res = createMockRes()
    await handler({ query: { keyword: 'FEE' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.code, 200)
    assert.equal(res.body.data.list[0].feeCode, 'FEE-01')
    assert.match(capturedSql, /src\.\[kcaa05\].*N'FEE'/is)
    assert.match(capturedSql, /src\.\[pass\]/i)
    assert.match(capturedSql, /src\.\[del\]/i)
  })

  test('POST /api/assist-order/:id/audit applies lifecycle action', async () => {
    const routes = {}
    const app = {
      get(path, handler) {
        routes[`GET ${path}`] = handler
      },
      post(path, handler) {
        routes[`POST ${path}`] = handler
      },
      put() {},
      delete() {},
    }
    const lifecycleCalls = []
    const lifecycleService = {
      async applyAssistOrderLifecycleAction(opts) {
        lifecycleCalls.push(opts)
        return { ok: true, msg: '审核成功', id: 8, assistOrderNo: 'WX26060901' }
      },
    }

    registerAssistOrderRoutes(app, { getPool: async () => ({}), lifecycleService })
    const handler = routes['POST /api/assist-order/:id/audit']
    assert.equal(typeof handler, 'function')

    const res = createMockRes()
    await handler({ params: { id: '8' }, user: { trueName: '张三' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.code, 200)
    assert.equal(res.body.msg, '审核成功')
    assert.equal(lifecycleCalls[0].id, 8)
    assert.equal(lifecycleCalls[0].action, 'audit')
    assert.equal(lifecycleCalls[0].actor.trueName, '张三')
  })
  test('POST /api/assist-order/:id/audit resolves audit triplet before lifecycle action', async () => {
    const routes = {}
    const app = {
      get(path, handler) {
        routes[`GET ${path}`] = handler
      },
      post(path, handler) {
        routes[`POST ${path}`] = handler
      },
      put() {},
      delete() {},
    }
    const lifecycleCalls = []
    const lifecycleService = {
      async applyAssistOrderLifecycleAction(opts) {
        lifecycleCalls.push(opts)
        return { ok: true, msg: 'ok', id: 8, assistOrderNo: 'WX26060901' }
      },
    }
    const pool = {
      request() {
        const req = {
          input() {
            return req
          },
          async query(sqlText) {
            if (/INFORMATION_SCHEMA\.COLUMNS/i.test(sqlText)) {
              return {
                recordset: [
                  { n: 'UserID' },
                  { n: 'usercode' },
                  { n: 'username' },
                  { n: 'truename' },
                ],
              }
            }
            if (/FROM\s+Sys_Users\s+AS\s+u/i.test(sqlText)) {
              return { recordset: [{ userId: 42, userName: 'u01', truename: 'operator01' }] }
            }
            return { recordset: [] }
          },
        }
        return req
      },
    }

    registerAssistOrderRoutes(app, { getPool: async () => pool, lifecycleService })
    const handler = routes['POST /api/assist-order/:id/audit']
    assert.equal(typeof handler, 'function')

    const res = createMockRes()
    await handler({ params: { id: '8' }, user: { userId: 42, userCode: 'admin' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(lifecycleCalls[0].actor.uidInt, 42)
    assert.equal(lifecycleCalls[0].actor.uname, 'u01')
    assert.equal(lifecycleCalls[0].actor.utruename, 'operator01')
  })
})
