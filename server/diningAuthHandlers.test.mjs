import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createDiningAuthService, readDiningBearerToken } from './diningAuthHandlers.js'

function fakePool(rows, capture = {}) {
  return {
    request() {
      return {
        input(name, _type, value) {
          capture[name] = value
          return this
        },
        async query(statement) {
          capture.statement = statement
          return { recordset: rows }
        },
      }
    },
  }
}

describe('报餐系统独立登录', () => {
  test('正确员工账号返回独立 token，且响应员工资料不含密码', async () => {
    const capture = {}
    const service = createDiningAuthService({
      getPool: async () => fakePool([
        { id: 7, new_code: 'E007', code: 'OLD007', password: '888', name: '测试员工', in_bm: '生产部', meal_type: '员工餐', card_number: 'C7', new_card_number: 'NC7' },
      ], capture),
      createToken: () => 'dining-token',
      now: () => 1000,
    })

    const result = await service.login(' E007 ', '888')
    assert.equal(result.ok, true)
    assert.equal(result.token, 'dining-token')
    assert.deepEqual(result.user, {
      id: 7,
      new_code: 'E007',
      name: '测试员工',
      in_bm: '生产部',
      meal_type: '员工餐',
    })
    assert.equal(Object.hasOwn(result.user, 'password'), false)
    assert.equal(capture.account, 'E007')
    assert.match(capture.statement, /s\.new_code/)
    assert.match(capture.statement, /s\.del[\s\S]*N'0'/)
    assert.match(capture.statement, /s\.pass[\s\S]*N'1'/)
    assert.match(capture.statement, /\[ERP_UB\]\.dbo\.\[UB_ERP_Hr_staff\]/)
    assert.deepEqual(service.getEmployee('dining-token'), {
      id: 7,
      new_code: 'E007',
      name: '测试员工',
      in_bm: '生产部',
      meal_type: '员工餐',
      code: 'OLD007',
      card_number: 'C7',
      new_card_number: 'NC7',
    })
  })

  test('错误密码、无在职已审核记录和重复工号均拒绝登录', async () => {
    const row = { id: 1, new_code: 'E001', password: 'right' }
    const wrong = createDiningAuthService({ getPool: async () => fakePool([row]) })
    assert.deepEqual(await wrong.login('E001', 'wrong'), {
      ok: false,
      status: 401,
      msg: '密码错误',
    })

    const missing = createDiningAuthService({ getPool: async () => fakePool([]) })
    assert.equal((await missing.login('E404', '888')).status, 401)

    const duplicate = createDiningAuthService({ getPool: async () => fakePool([row, { ...row, id: 2 }]) })
    assert.equal((await duplicate.login('E001', 'right')).status, 500)
  })

  test('会话八小时内有效，过期及退出后失效', async () => {
    let clock = 1000
    const service = createDiningAuthService({
      getPool: async () => fakePool([{ id: 1, new_code: 'E001', password: '888' }]),
      createToken: () => 'meal-session',
      now: () => clock,
      tokenTtlMs: 100,
    })
    await service.login('E001', '888')
    assert.equal(service.getSession('meal-session')?.new_code, 'E001')
    clock = 1100
    assert.equal(service.getSession('meal-session'), null)

    clock = 1200
    await service.login('E001', '888')
    service.logout('meal-session')
    assert.equal(service.getSession('meal-session'), null)
  })

  test('报餐 token 只从 Bearer 请求头读取', () => {
    assert.equal(readDiningBearerToken({ headers: { authorization: 'Bearer dining-123' } }), 'dining-123')
    assert.equal(readDiningBearerToken({ headers: { authorization: 'erp-token' } }), '')
  })
})
