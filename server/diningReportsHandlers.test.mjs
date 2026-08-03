import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDiningReportsService,
  formatDiningReportEmployeeName,
  validateDailyOrderDate,
  validateDateRange,
  validateMonthlyOrderMonth,
} from './diningReportsHandlers.js'

test('每天订餐情况表按员工合并午晚餐并返回人数统计', async () => {
  let statement = ''
  const request = {
    input() { return this },
    async query(sqlText) {
      statement = sqlText
      return {
        recordset: [
          { identity_key: 'UID:7', employee_code: 'E007', department: '办公室', employee_name: '张三', has_lunch: 1, has_dinner: 1 },
          { identity_key: 'UID:8', employee_code: 'E008', department: '生产部', employee_name: '李四', has_lunch: 1, has_dinner: 0 },
        ],
      }
    },
  }
  const service = createDiningReportsService({
    getPool: async () => ({ request: () => request }),
    tables: { meals: '[MEALS]', staff: '[STAFF]' },
  })

  const result = await service.listDailyOrders({ date: '2026-08-03' })

  assert.match(statement, /dis_dtime/)
  assert.match(statement, /dis_lx/)
  assert.match(statement, /GROUP BY[\s\S]*identity_key/i)
  assert.deepEqual(result.summary, { totalPeople: 2, lunchPeople: 2, dinnerPeople: 1 })
  assert.deepEqual(result.rows[0], {
    sequence: 1,
    employeeCode: 'E007',
    department: '办公室',
    employeeName: '张三',
    hasLunch: true,
    hasDinner: true,
  })
})

test('每天订餐情况表只接受真实日历日期', () => {
  assert.equal(validateDailyOrderDate('2026-08-03'), '2026-08-03')
  assert.throws(() => validateDailyOrderDate('2026-02-30'), /查询日期无效/)
})

test('报表员工名称只在报餐日期晚于离职日期时追加离职标记', () => {
  assert.equal(formatDiningReportEmployeeName('张三', 0), '张三')
  assert.equal(formatDiningReportEmployeeName('张三', 1), '张三（已离职）')
  assert.equal(formatDiningReportEmployeeName('', 1), '')
})

test('月报餐统计表按人天餐合并，并补齐所选月的全部日期', async () => {
  let statement = ''
  const request = {
    input() { return this },
    async query(sqlText) {
      statement = sqlText
      return {
        recordset: [
          { meal_date: '2026-02-01', lunch_total: 3, lunch_management: 1, dinner_total: 2, dinner_management: 0 },
          { meal_date: '2026-02-03', lunch_total: 1, lunch_management: 0, dinner_total: 1, dinner_management: 1 },
        ],
      }
    },
  }
  const service = createDiningReportsService({
    getPool: async () => ({ request: () => request }),
    tables: { meals: '[MEALS]', staff: '[STAFF]' },
  })

  const result = await service.listMonthlyOrders({ month: '2026-02' })

  assert.match(statement, /dis_meal_type/)
  assert.match(statement, /GROUP BY v\.identity_key, v\.meal_date, v\.meal_type/)
  assert.match(statement, /LEFT JOIN \[STAFF\] s/)
  assert.doesNotMatch(statement, /s\.del|s\.pass/)
  assert.equal(result.rows.length, 28)
  assert.deepEqual(result.rows[0], {
    date: '2026-02-01', lunchTotal: 3, lunchEmployee: 2, lunchManagement: 1,
    dinnerTotal: 2, dinnerEmployee: 2, dinnerManagement: 0,
  })
  assert.deepEqual(result.rows[1], {
    date: '2026-02-02', lunchTotal: 0, lunchEmployee: 0, lunchManagement: 0,
    dinnerTotal: 0, dinnerEmployee: 0, dinnerManagement: 0,
  })
})

test('月报餐统计表只接受真实月份', () => {
  assert.equal(validateMonthlyOrderMonth('2026-08'), '2026-08')
  assert.throws(() => validateMonthlyOrderMonth('2026-00'), /统计月份无效/)
  assert.throws(() => validateMonthlyOrderMonth('2026-13'), /统计月份无效/)
  assert.throws(() => validateMonthlyOrderMonth('2026-8'), /统计月份无效/)
})

test('missed swipe report merges old order rows and only returns missed meals', async () => {
  let statement = ''
  const request = {
    input() { return this },
    async query(sqlText) {
      statement = sqlText
      return {
        recordset: [
          { department: '办公室', employee_code: 'E001', employee_name: '张三', new_card_number: 'NEW001', card_number: 'OLD001', position: '文员', meal_type: '2', meal_date: '2026-07-14', has_swiped: 0 },
          { department: '生产部', employee_code: 'E002', employee_name: '李四', new_card_number: '', card_number: 'OLD002', position: '组长', meal_type: '3', meal_date: '2026-07-14', has_swiped: 1 },
        ],
      }
    },
  }
  const service = createDiningReportsService({
    getPool: async () => ({ request: () => request }),
    tables: { meals: '[MEALS]', mealLogs: '[MEAL_LOGS]', staff: '[STAFF]' },
  })
  const result = await service.listMissedSwipes({ startDate: '2026-07-01', endDate: '2026-07-31', department: '' })

  assert.match(statement, /FROM \[MEALS\]/)
  assert.match(statement, /FROM \[MEAL_LOGS\]/)
  assert.match(statement, /GROUP BY v\.identity_key, v\.meal_date, v\.meal_type/)
  assert.match(statement, /ORDER BY department ASC, meal_date ASC/)
  assert.deepEqual(result.summary, { totalPeople: 2, swipedPeople: 1, missedPeople: 1 })
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].employeeCode, 'E001')
  assert.equal(result.rows[0].cardNumber, 'NEW001')
  assert.equal(result.rows[0].mealType, '午餐')
})

test('missed swipe report validates the date range', () => {
  assert.deepEqual(validateDateRange('2026-07-01', '2026-07-31'), { startDate: '2026-07-01', endDate: '2026-07-31' })
  assert.throws(() => validateDateRange('2026-07-31', '2026-07-01'), /开始日期不能晚于结束日期/)
  assert.throws(() => validateDateRange('2026-02-30', '2026-03-01'), /查询日期无效/)
})

test('消费汇总以在职已审核员工为完整名单并计算19列数据', async () => {
  const statements = []
  const request = {
    input() { return this },
    async query(sqlText) {
      statements.push(sqlText)
      if (sqlText.includes('FROM [MEALS] m')) {
        return {
          recordset: [
            { id: 1, uid: '7', user_new_code: 'E007', user_code: 'OLD007', new_card_number: 'NEW007', card_number: 'OLD007', bm: '办公室', utruename: '张三', uname: '', dis_dtime: '2026-07-01', dis_lx: '2' },
            { id: 2, uid: '7', user_new_code: 'E007', user_code: 'OLD007', new_card_number: 'NEW007', card_number: 'OLD007', bm: '办公室', utruename: '张三', uname: '', dis_dtime: '2026-07-01', dis_lx: '2' },
            { id: 3, uid: '7', user_new_code: 'E007', user_code: 'OLD007', new_card_number: 'NEW007', card_number: 'OLD007', bm: '办公室', utruename: '张三', uname: '', dis_dtime: '2026-07-02', dis_lx: '2' },
            { id: 4, uid: '7', user_new_code: 'E007', user_code: 'OLD007', new_card_number: 'NEW007', card_number: 'OLD007', bm: '办公室', utruename: '张三', uname: '', dis_dtime: '2026-07-03', dis_lx: '2' },
            { id: 5, uid: '7', user_new_code: 'E007', user_code: 'OLD007', new_card_number: 'NEW007', card_number: 'OLD007', bm: '办公室', utruename: '张三', uname: '', dis_dtime: '2026-07-04', dis_lx: '3' },
          ],
        }
      }
      if (sqlText.includes('FROM [STAFF]')) {
        return { recordset: [
          { id: '7', code: 'OLD007', new_code: 'E007', name: '张三', in_bm: '办公室', card_number: 'OLD007', new_card_number: 'NEW007' },
          { id: '8', code: 'OLD008', new_code: '', name: '李四', in_bm: '办公室', card_number: 'OLD008', new_card_number: '' },
        ] }
      }
      return {
        recordset: [
          { uid: '7', employee_id: 'OLD007', new_card_id: 'NEW007', card_id: 'OLD007', dtime: '2026-07-01', meal_type: '2', bl: '0' },
          { uid: '7', employee_id: 'OLD007', new_card_id: 'NEW007', card_id: 'OLD007', dtime: '2026-07-01', meal_type: '2', bl: '0' },
          { uid: '7', employee_id: 'OLD007', new_card_id: 'NEW007', card_id: 'OLD007', dtime: '2026-07-02', meal_type: '2', bl: '0' },
          { uid: '7', employee_id: 'OLD007', new_card_id: 'NEW007', card_id: 'OLD007', dtime: '2026-07-04', meal_type: '3', bl: '1' },
        ],
      }
    },
  }
  const service = createDiningReportsService({
    getPool: async () => ({ request: () => request }),
    tables: { meals: '[MEALS]', mealLogs: '[MEAL_LOGS]', staff: '[STAFF]' },
  })

  const result = await service.listConsumptionSummary({ startDate: '2026-07-01', endDate: '2026-07-31', department: '' })

  assert.equal(statements.length, 3)
  assert.match(statements[0], /FROM \[MEALS\] m/)
  assert.match(statements[1], /FROM \[STAFF\]/)
  assert.match(statements[1], /del, N'0'.*= N'0'/s)
  assert.match(statements[1], /pass, N''.*= N'1'/s)
  assert.match(statements[2], /FROM \[MEAL_LOGS\]/)
  assert.deepEqual(result.rows, [
    {
      sequence: 1,
      employeeCode: 'E007', employeeName: '张三',
      lunchOrders: 3, lunchSwipes: 2, lunchSupplements: 0,
      lunchAmount: 10, lunchMissedAmount: 5,
      dinnerOrders: 1, dinnerSwipes: 1, dinnerSupplements: 1,
      dinnerAmount: 5, dinnerMissedAmount: 0,
      orderedMissed: 1, orderedSwiped: 3, supplementTotal: 1,
      orderTotal: 4, subsidyAmount: 15, deductionAmount: 20,
    },
    {
      sequence: 2,
      employeeCode: 'OLD008', employeeName: '李四',
      lunchOrders: 0, lunchSwipes: 0, lunchSupplements: 0,
      lunchAmount: 0, lunchMissedAmount: 0,
      dinnerOrders: 0, dinnerSwipes: 0, dinnerSupplements: 0,
      dinnerAmount: 0, dinnerMissedAmount: 0,
      orderedMissed: 0, orderedSwiped: 0, supplementTotal: 0,
      orderTotal: 0, subsidyAmount: 0, deductionAmount: 0,
    },
  ])
})
