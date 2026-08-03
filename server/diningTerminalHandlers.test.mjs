import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  createDiningTerminalRepository,
  createDiningTerminalService,
  DiningTerminalError,
  normalizeDiningTerminalPagination,
  resolveDiningTerminalMeal,
} from './diningTerminalHandlers.js'

const machine = { id: 1, ip: '192.168.1.50', px: '1', name: '测试窗口' }
const baseConfig = {
  closed: '0',
  two1: '10:30',
  two2: '13:30',
  three1: '16:30',
  three2: '18:30',
}

function serviceWith(repository, options = {}) {
  return createDiningTerminalService({
    databaseName: options.databaseName || 'UB_ERP_V2.0',
    testMode: options.testMode ?? true,
    repository,
    now: options.now || (() => new Date('2026-08-03T04:00:00.000Z')),
  })
}

describe('饭堂刷卡餐别与终端授权', () => {
  test('只自动识别午餐和晚餐时段', () => {
    assert.equal(resolveDiningTerminalMeal(baseConfig, '12:00:00')?.code, '2')
    assert.equal(resolveDiningTerminalMeal(baseConfig, '17:00:00')?.code, '3')
    assert.equal(resolveDiningTerminalMeal(baseConfig, '08:00:00'), null)
  })

  test('终端IP不存在时拒绝使用', async () => {
    const service = serviceWith({ async loadContext() { return { machine: null, config: baseConfig } } })
    await assert.rejects(
      () => service.context('192.168.1.99'),
      (error) => error instanceof DiningTerminalError && error.status === 403,
    )
  })

  test('正式库即使收到手动日期和餐别也拒绝', async () => {
    const repository = {
      async loadContext() { return { machine, config: baseConfig } },
      async processSwipe() { throw new Error('不应写库') },
    }
    const service = serviceWith(repository, { databaseName: 'ERP_UB', testMode: false })
    await assert.rejects(
      () => service.swipe(machine.ip, { cardNumber: '1234567890', date: '2026-08-03', mealType: 'lunch' }),
      (error) => error instanceof DiningTerminalError && error.status === 400,
    )
  })
})

describe('刷卡记录分页与人数统计', () => {
  test('分页只接受10、20、50条并把非法页码归一为第一页', () => {
    assert.deepEqual(normalizeDiningTerminalPagination({ page: '2', pageSize: '20' }), { page: 2, pageSize: 20 })
    assert.deepEqual(normalizeDiningTerminalPagination({ page: '0', pageSize: '99' }), { page: 1, pageSize: 10 })
  })

  test('测试日期餐别与分页参数一并传给当前窗口仓储', async () => {
    let received = null
    const repository = {
      async loadContext() { return { machine, config: baseConfig } },
      async listRecent(input) {
        received = input
        return {
          rows: [],
          pagination: { page: input.page, pageSize: input.pageSize, total: 0, totalPages: 0 },
          summary: { expected: 0, swiped: 0, pending: 0, supplement: 0 },
        }
      },
    }
    const result = await serviceWith(repository).recent(machine.ip, {
      date: '2026-08-04',
      mealType: 'lunch',
      page: '3',
      pageSize: '50',
    })
    assert.deepEqual(received, {
      ip: machine.ip,
      date: '2026-08-04',
      mealType: '2',
      page: 3,
      pageSize: 50,
    })
    assert.equal(result.pagination.page, 3)
  })

  test('仓储使用ROW_NUMBER分页，列表限当前IP而统计覆盖全部窗口', async () => {
    let statement = ''
    const inputs = {}
    const repository = createDiningTerminalRepository({
      getPool: async () => ({
        request() {
          return {
            input(name, _type, value) { inputs[name] = value; return this },
            async query(sqlText) {
              statement = sqlText
              return {
                recordsets: [
                  [{ id: 9, employee_name: '张三', meal_type: '2', edible_time_text: '2026-08-04 12:01:02', dtime: '2026-08-04', bc_info: '0' }],
                  [{ total_count: 21 }],
                  [{ expected_count: 30, swiped_count: 18, pending_count: 12, supplement_count: 2 }],
                  [{ uid: '17', employee_name: '李四' }],
                ],
              }
            },
          }
        },
      }),
      tables: {
        meals: '[UB_ERP_V2.0].dbo.[UB_ERP_Dining_meal]',
        mealLogs: '[UB_ERP_V2.0].dbo.[UB_ERP_Dining_meal_log]',
      },
    })
    const result = await repository.listRecent({
      ip: machine.ip,
      date: '2026-08-04',
      mealType: '2',
      page: 2,
      pageSize: 10,
    })

    assert.match(statement, /ROW_NUMBER\(\) OVER/)
    assert.doesNotMatch(statement, /\bOFFSET\b/i)
    assert.match(statement, /WHERE ip = @ip/)
    assert.match(statement, /FROM \[UB_ERP_V2\.0\]\.dbo\.\[UB_ERP_Dining_meal_log\][\s\S]*WHERE dtime = @date/)
    assert.equal(inputs.startRow, 11)
    assert.equal(inputs.endRow, 20)
    assert.equal(result.rows[0].employeeName, '张三')
    assert.deepEqual(result.pagination, { page: 2, pageSize: 10, total: 21, totalPages: 3 })
    assert.deepEqual(result.summary, { expected: 30, swiped: 18, pending: 12, supplement: 2 })
    assert.deepEqual(result.pendingRows, [{ uid: '17', employeeName: '李四' }])
  })

  test('没有刷卡和报餐数据时返回空分页及零统计', async () => {
    const repository = createDiningTerminalRepository({
      getPool: async () => ({
        request() {
          return {
            input() { return this },
            async query() {
              return { recordsets: [[], [{ total_count: 0 }], [{}], []] }
            },
          }
        },
      }),
      tables: { meals: '[DiningMeal]', mealLogs: '[DiningMealLog]' },
    })
    const result = await repository.listRecent({
      ip: machine.ip,
      date: '2026-08-04',
      mealType: '2',
      page: 1,
      pageSize: 10,
    })
    assert.deepEqual(result.rows, [])
    assert.deepEqual(result.pagination, { page: 1, pageSize: 10, total: 0, totalPages: 0 })
    assert.deepEqual(result.summary, { expected: 0, swiped: 0, pending: 0, supplement: 0 })
    assert.deepEqual(result.pendingRows, [])
  })
})

describe('新旧报餐共用刷卡规则', () => {
  test('测试库允许手动日期餐别，并把 closed 规则交给仓储', async () => {
    let saved = null
    const repository = {
      async loadContext() { return { machine, config: { ...baseConfig, closed: '1' } } },
      async processSwipe(input) {
        saved = input
        return { status: 'supplement_success', employee: { name: '测试员工' } }
      },
    }
    const service = serviceWith(repository)
    const result = await service.swipe(machine.ip, {
      cardNumber: '1234567890',
      date: '2026-08-09',
      mealType: 'dinner',
    })
    assert.equal(saved.date, '2026-08-09')
    assert.equal(saved.meal.code, '3')
    assert.equal(saved.allowUnreported, true)
    assert.equal(result.manual, true)
    assert.equal(result.mealLabel, '晚餐')
  })

  test('卡号必须保持旧读卡器的10位规则', async () => {
    const service = serviceWith({ async loadContext() { return { machine, config: baseConfig } } })
    await assert.rejects(
      () => service.swipe(machine.ip, { cardNumber: '123' }),
      (error) => error instanceof DiningTerminalError && error.status === 400,
    )
  })

  test('旧系统多道菜只产生一条正常刷卡流水', async () => {
    const statements = []
    let queryIndex = 0
    const transaction = {
      async begin() {},
      async commit() {},
      async rollback() {},
      request() {
        const values = {}
        return {
          input(name, _type, value) { values[name] = value; return this },
          async query(statement) {
            statements.push({ statement, values })
            queryIndex += 1
            if (queryIndex === 1) return { recordset: [{ id: 7, code: 'OLD007', new_code: 'E007', name: '测试员工', in_bm: '生产部', meal_type: '员工餐' }] }
            if (queryIndex === 2) return { recordset: [{ lock_result: 0 }] }
            if (queryIndex === 3) return { recordset: [
              { dis_content: '菜式一', meal_from: '旧系统' },
              { dis_content: '菜式二', meal_from: '旧系统' },
            ] }
            if (queryIndex === 4) return { recordset: [] }
            return { recordset: [{ id: 99, edible_time: new Date('2026-08-03T04:00:00.000Z') }] }
          },
        }
      },
    }
    const repository = createDiningTerminalRepository({
      getPool: async () => ({}),
      transactionFactory: () => transaction,
      tables: {
        staff: '[UB_ERP_V2.0].dbo.[UB_ERP_Hr_staff]',
        meals: '[UB_ERP_V2.0].dbo.[UB_ERP_Dining_meal]',
        mealLogs: '[UB_ERP_V2.0].dbo.[UB_ERP_Dining_meal_log]',
      },
    })
    const result = await repository.processSwipe({
      cardNumber: '1234567890',
      date: '2026-08-03',
      meal: { code: '2', label: '午餐' },
      ip: machine.ip,
      now: new Date('2026-08-03T04:00:00.000Z'),
      nowText: '2026-08-03 12:00:00',
      allowUnreported: false,
    })

    assert.equal(result.status, 'success')
    assert.deepEqual(result.contents, ['菜式一', '菜式二'])
    assert.equal(statements.filter((item) => /INSERT INTO/.test(item.statement)).length, 1)
    assert.match(statements[1].statement, /sp_getapplock/)
    const mealQuery = statements[2].statement
    assert.match(mealQuery, /del[\s\S]*N'0'/)
    assert.match(mealQuery, /pass[\s\S]*N'1'/)
    const insert = statements[4]
    assert.equal(insert.values.bcInfo, '0')
    assert.equal(insert.values.edibleTimeText, '2026-08-03 12:00:00')
    assert.match(insert.statement, /CONVERT\(datetime, @edibleTimeText, 120\)/)
    assert.equal(insert.values.employeeCode, 'OLD007')
    assert.match(insert.statement, /UB_ERP_Dining_meal_log/)
  })
})
