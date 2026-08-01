import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildDiningDateWindow,
  createDiningMealRepository,
  createDiningMealService,
  DiningMealError,
} from './diningMealHandlers.js'

const employee = {
  id: 7,
  new_code: 'E007',
  code: 'OLD007',
  name: '测试员工',
  in_bm: '生产部',
  meal_type: '员工餐',
  card_number: 'C7',
  new_card_number: 'NC7',
}

describe('员工报餐日期与状态', () => {
  test('返回明天起 30 天，并把旧系统多道菜合并为一个餐次状态', async () => {
    const repository = {
      async getCutoffTime() { return '13:30:00' },
      async listActiveMeals() {
        return [
          { meal_date: '2026-08-01', meal_type: '2', record_count: 3 },
          { meal_date: '2026-08-03', meal_type: '3', record_count: 1 },
        ]
      },
    }
    const service = createDiningMealService({
      repository,
      now: () => new Date('2026-07-31T05:29:59.000Z'),
    })

    const result = await service.list(employee)
    assert.equal(result.start, '2026-08-01')
    assert.equal(result.end, '2026-08-30')
    assert.equal(result.dates.length, 30)
    assert.deepEqual(result.dates[0].lunch, { selected: true, recordCount: 3 })
    assert.deepEqual(result.dates[0].dinner, { selected: false, recordCount: 0 })
    assert.equal(result.dates[0].canEdit, true)
  })

  test('前一天 13:30 起锁定次日，但更远日期仍可填写', () => {
    const window = buildDiningDateWindow(new Date('2026-07-31T05:30:00.000Z'), '13:30')
    assert.equal(window.dates[0].date, '2026-08-01')
    assert.equal(window.dates[0].canEdit, false)
    assert.equal(window.dates[1].date, '2026-08-02')
    assert.equal(window.dates[1].canEdit, true)
  })
})

describe('旧库兼容写入语句', () => {
  test('新提交只写一条统一餐，并沿用旧系统首个菜式 ID 规则', async () => {
    const statements = []
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
            if (/SELECT TOP \(1\) id\s+FROM \[ERP_UB\]\.dbo\.\[UB_ERP_Dining_meal\]/.test(statement)) return { recordset: [] }
            if (/INNER JOIN \[ERP_UB\]\.dbo\.\[UB_ERP_Dining_dishes\]/.test(statement)) return { recordset: [] }
            if (/SELECT TOP \(1\) d\.systemcode/.test(statement)) return { recordset: [{ systemcode: 'Dishes-OLD' }] }
            if (/OUTPUT INSERTED\.id/.test(statement)) return { recordset: [{ id: 10, systemcode: 'Dishes-OLD', dcode: 'Dining-2-CODE' }] }
            if (/SELECT TOP \(1\) i\.id/.test(statement)) return { recordset: [{ id: 5 }] }
            return { recordset: [], rowsAffected: [1] }
          },
        }
      },
    }
    const repository = createDiningMealRepository({
      getPool: async () => ({}),
      transactionFactory: () => transaction,
      createCode: (prefix) => `${prefix}CODE`,
    })

    const result = await repository.setMeal({
      employee,
      date: '2026-08-02',
      meal: { code: '2', label: '午餐', compatibilityContent: '午餐（统一餐）' },
      selected: true,
      nowText: '2026-07-31 12:00:00',
      ip: '192.168.1.8',
    })

    assert.deepEqual(result, { changed: true, selected: true })
    const mealInsert = statements.find((item) => /INSERT INTO \[ERP_UB\]\.dbo\.\[UB_ERP_Dining_meal\]/.test(item.statement))
    assert.ok(mealInsert)
    assert.equal(mealInsert.values.dishId, '5')
    assert.equal(mealInsert.values.content, '午餐（统一餐）')
    assert.equal(mealInsert.values.mealType, '2')
    assert.equal(mealInsert.values.employeeId, '7')
    assert.match(mealInsert.statement, /N'0', N'1'/)
  })

  test('取消会把同一员工同日同餐的所有有效旧菜式行一起软删除', async () => {
    let updateStatement = ''
    const transaction = {
      async begin() {},
      async commit() {},
      async rollback() {},
      request() {
        return {
          input() { return this },
          async query(statement) { updateStatement = statement; return { rowsAffected: [3] } },
        }
      },
    }
    const repository = createDiningMealRepository({
      getPool: async () => ({}),
      transactionFactory: () => transaction,
    })

    const result = await repository.setMeal({
      employee,
      date: '2026-08-02',
      meal: { code: '3', label: '晚餐', compatibilityContent: '晚餐（统一餐）' },
      selected: false,
      nowText: '2026-07-31 12:00:00',
      ip: '',
    })

    assert.deepEqual(result, { changed: true, selected: false })
    assert.match(updateStatement, /SET del = N'1'/)
    assert.match(updateStatement, /dis_dtime[\s\S]*@date/)
    assert.match(updateStatement, /dis_lx[\s\S]*@mealType/)
    assert.doesNotMatch(updateStatement, /TOP \(1\)/)
  })
})

describe('员工正式提交与取消报餐', () => {
  test('把午餐提交交给旧库兼容仓储，操作人只能来自会话', async () => {
    let saved = null
    const repository = {
      async getCutoffTime() { return '13:30:00' },
      async setMeal(input) {
        saved = input
        return { changed: true, selected: true }
      },
    }
    const service = createDiningMealService({
      repository,
      now: () => new Date('2026-07-31T04:00:00.000Z'),
    })

    const result = await service.change(employee, {
      date: '2026-08-01',
      mealType: 'lunch',
      selected: true,
      employeeId: 999,
    }, '192.168.1.8')

    assert.deepEqual(result, { changed: true, selected: true })
    assert.equal(saved.employee.id, 7)
    assert.equal(saved.meal.code, '2')
    assert.equal(saved.meal.compatibilityContent, '午餐（统一餐）')
    assert.equal(saved.selected, true)
    assert.equal(saved.ip, '192.168.1.8')
  })

  test('取消晚餐使用同一餐次入口，仓储负责取消该员工全部旧菜式行', async () => {
    let saved = null
    const repository = {
      async getCutoffTime() { return '13:30:00' },
      async setMeal(input) {
        saved = input
        return { changed: true, selected: false }
      },
    }
    const service = createDiningMealService({
      repository,
      now: () => new Date('2026-07-31T04:00:00.000Z'),
    })

    await service.change(employee, { date: '2026-08-02', mealType: 'dinner', selected: false })
    assert.equal(saved.meal.code, '3')
    assert.equal(saved.selected, false)
  })

  test('拒绝超出一个月范围、无效餐次和已截止日期', async () => {
    const repository = {
      async getCutoffTime() { return '13:30:00' },
      async setMeal() { throw new Error('不应写库') },
    }
    const service = createDiningMealService({
      repository,
      now: () => new Date('2026-07-31T05:30:00.000Z'),
    })

    await assert.rejects(
      () => service.change(employee, { date: '2026-08-31', mealType: 'lunch', selected: true }),
      (error) => error instanceof DiningMealError && error.status === 400,
    )
    await assert.rejects(
      () => service.change(employee, { date: '2026-08-02', mealType: 'breakfast', selected: true }),
      (error) => error instanceof DiningMealError && error.status === 400,
    )
    await assert.rejects(
      () => service.change(employee, { date: '2026-08-01', mealType: 'lunch', selected: true }),
      (error) => error instanceof DiningMealError && error.status === 409,
    )
  })
})
