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

describe('assist order print route', () => {
  test('GET /api/assist-order/print-data returns batch print documents', async () => {
    const routes = {}
    const app = {
      get(path, handler) {
        routes[`GET ${path}`] = handler
      },
      post() {},
      put() {},
      delete() {},
    }
    const printCalls = []
    const printService = {
      async fetchAssistOrderPrintDocuments(pool, ids, actor, setup) {
        printCalls.push({ pool, ids, actor, setup })
        return [{ header: { assistOrderNo: 'WX26060901' }, pages: [] }]
      },
    }

    registerAssistOrderRoutes(app, { getPool: async () => ({ marker: 'pool' }), printService })
    const handler = routes['GET /api/assist-order/print-data']
    assert.equal(typeof handler, 'function')

    const res = createMockRes()
    await handler(
      { query: { ids: '8,9', rowsPerPage: '12', priceDecimals: '4' }, user: { trueName: 'Zhang San' } },
      res,
    )

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.code, 200)
    assert.equal(res.body.data.list.length, 1)
    assert.deepEqual(printCalls[0].ids, [8, 9])
    assert.equal(printCalls[0].actor.trueName, 'Zhang San')
    assert.deepEqual(printCalls[0].setup, { rowsPerPage: '12', priceDecimals: '4' })
  })
})
