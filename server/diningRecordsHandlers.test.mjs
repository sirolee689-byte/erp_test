import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  DiningRecordsError,
  buildDiningRecordRows,
  createDiningRecordsService,
  normalizeDiningConsumptionQuery,
  normalizeDiningPeopleQuery,
  normalizeOneClickMonth,
  normalizeSupplementReviewQuery,
  normalizeSupplementStaffQuery,
  recentThreeMonthRange,
  validateDiningSupplementPayload,
  validateDiningPeopleCancelKey,
} from './diningRecordsHandlers.js'

describe('饭堂报餐管理汇总', () => {
  test('按已准备月份倒序展示，并兼容旧系统一人多条报餐记录', () => {
    const rows = buildDiningRecordRows({
      reportMonths: [{ month_key: '202608', enabled: '1' }],
      blocks: [{ start_date: '2026-08-31', end_date: '2026-08-31', report_status: 'allowed', remark: '月底加班', enabled: '1', del: '0' }],
      mealStats: [
        { report_date: '2026-08-31', meal_type: '2', quantity: 3, people_count: 2 },
        { report_date: '2026-08-31', meal_type: '3', quantity: 5, people_count: 4 },
      ],
    })
    assert.equal(rows[0].date, '2026-08-31')
    assert.equal(rows[0].weekday, '一')
    assert.deepEqual(rows[0], {
      date: '2026-08-31', weekday: '一', totalQuantity: 8,
      lunchQuantity: 3, lunchPeople: 2, dinnerQuantity: 5, dinnerPeople: 4,
      remark: '特殊日期：可报餐（月底加班）',
    })
  })
})

test('最近三个月固定为当前月及前两个月', () => {
  assert.deepEqual(recentThreeMonthRange(new Date('2026-08-01T04:00:00.000Z')), {
    startDate: '2026-06-01', endDate: '2026-08-31', startMonth: '202606', endMonth: '202608',
  })
})

test('报餐人记录分页参数默认10条并受全站上限约束', () => {
  assert.deepEqual(normalizeDiningPeopleQuery({}), { keyword: '', page: 1, pageSize: 10 })
  assert.deepEqual(normalizeDiningPeopleQuery({ keyword: ' 张三 ', page: '2', pageSize: '20' }), { keyword: '张三', page: 2, pageSize: 20 })
  assert.equal(normalizeDiningPeopleQuery({ pageSize: '9999' }).pageSize, 1000)
})

test('取消报餐业务键只接受有效日期和午晚餐', () => {
  assert.deepEqual(validateDiningPeopleCancelKey({ uid: '7', date: '2026-08-04', mealType: '2' }), { uid: '7', date: '2026-08-04', mealType: '2' })
  assert.throws(() => validateDiningPeopleCancelKey({ uid: '7', date: '2026-02-30', mealType: '2' }), DiningRecordsError)
  assert.throws(() => validateDiningPeopleCancelKey({ uid: '7', date: '2026-08-04', mealType: '4' }), DiningRecordsError)
})

test('报餐人记录使用ROW_NUMBER分页并返回取消原因', async () => {
  let statement = ''
  const request = {
    input() { return this },
    async query(sqlText) {
      statement = sqlText
      return { recordset: [{
        total_count: 12, uid: '7', report_date: '2026-08-04', report_time: '2026-08-01 09:30:00',
        employee_code: 'E007', meal_type: '2', employee_name: '测试员工', card_number: 'NC7', has_swiped: 1, can_cancel: 0,
      }] }
    },
  }
  const service = createDiningRecordsService({
    getPool: async () => ({ request: () => request }),
    now: () => new Date('2026-08-01T04:00:00.000Z'),
    tables: {
      meals: '[MEALS]', mealLogs: '[LOGS]', staff: '[STAFF]', reportMonths: '[MONTHS]', reportBlocks: '[BLOCKS]',
    },
  })
  const result = await service.listPeople({ keyword: 'E007', page: 2, pageSize: 10 })
  assert.match(statement, /ROW_NUMBER\(\) OVER/)
  assert.match(statement, /COUNT\(1\) OVER \(\)/)
  assert.match(statement, /GROUP BY[\s\S]*uid/)
  assert.doesNotMatch(statement, /OFFSET\s+/i)
  assert.equal(result.pagination.total, 12)
  assert.equal(result.pagination.totalPages, 2)
  assert.equal(result.rows[0].mealTypeName, '午餐')
  assert.equal(result.rows[0].cancelReason, '已刷卡，不能取消报餐')
})

function createCancelTransaction({ swipeRows = [], affected = 2 } = {}) {
  const statements = []
  let queryIndex = 0
  return {
    statements,
    committed: false,
    rolledBack: false,
    async begin() {},
    request() {
      return {
        input() { return this },
        query: async (statement) => {
          statements.push(statement)
          queryIndex += 1
          if (queryIndex === 1) return { recordset: [{ lock_result: 0 }] }
          if (queryIndex === 2) return { recordset: swipeRows }
          return { rowsAffected: [affected] }
        },
      }
    },
    async commit() { this.committed = true },
    async rollback() { this.rolledBack = true },
  }
}

test('取消报餐复用刷卡锁并软删除同餐全部有效行', async () => {
  const transaction = createCancelTransaction({ affected: 3 })
  const service = createDiningRecordsService({
    getPool: async () => ({}),
    transactionFactory: () => transaction,
    now: () => new Date('2026-08-01T04:00:00.000Z'),
    tables: { meals: '[MEALS]', mealLogs: '[LOGS]' },
  })
  assert.deepEqual(await service.cancelPeopleMeal({ uid: '7', date: '2026-08-04', mealType: '2' }), { affected: 3 })
  assert.match(transaction.statements[0], /sp_getapplock/)
  assert.match(transaction.statements[2], /SET del = N'1'/)
  assert.match(transaction.statements[2], /pass[\s\S]*= N'1'/)
  assert.equal(transaction.committed, true)
})

test('已经刷卡或历史日期不能取消报餐', async () => {
  const transaction = createCancelTransaction({ swipeRows: [{ id: 1 }] })
  const service = createDiningRecordsService({
    getPool: async () => ({}), transactionFactory: () => transaction,
    now: () => new Date('2026-08-01T04:00:00.000Z'), tables: { meals: '[MEALS]', mealLogs: '[LOGS]' },
  })
  await assert.rejects(
    () => service.cancelPeopleMeal({ uid: '7', date: '2026-08-04', mealType: '2' }),
    (error) => error.status === 409 && /已经刷卡/.test(error.message),
  )
  assert.equal(transaction.rolledBack, true)
  await assert.rejects(
    () => service.cancelPeopleMeal({ uid: '7', date: '2026-07-31', mealType: '2' }),
    (error) => error.status === 409 && /历史日期/.test(error.message),
  )
})

test('补录人员分页默认20条，补录日期及人数由服务端校验', () => {
  assert.deepEqual(normalizeSupplementStaffQuery({}), { keyword: '', page: 1, pageSize: 20 })
  assert.deepEqual(normalizeSupplementStaffQuery({ keyword: ' 张三 ', page: '2', pageSize: '50' }), {
    keyword: '张三', page: 2, pageSize: 50,
  })
  assert.deepEqual(validateDiningSupplementPayload({
    openedAt: '2026-08-01 10:30:00', date: '2026-07-31', mealType: '2', remark: '测试', staffIds: [8, 7, 8],
  }, '2026-08-01'), {
    openedAt: '2026-08-01 10:30:00', date: '2026-07-31', mealType: '2', remark: '测试', staffIds: [8, 7],
  })
  assert.throws(() => validateDiningSupplementPayload({
    openedAt: '2026-08-01 10:30:00', date: '2026-08-02', mealType: '2', staffIds: [1],
  }, '2026-08-01'), /不能晚于今天/)
  assert.throws(() => validateDiningSupplementPayload({
    openedAt: '2026-08-01 10:30:00', date: '2026-08-01', mealType: '4', staffIds: [1],
  }, '2026-08-01'), /午餐或晚餐/)
  assert.throws(() => validateDiningSupplementPayload({
    openedAt: '2026-08-01 10:30:00', date: '2026-08-01', mealType: '2', staffIds: [],
  }, '2026-08-01'), /至少添加/)
  assert.throws(() => validateDiningSupplementPayload({
    openedAt: '2026-08-01 10:30:00', date: '2026-08-01', mealType: '2', remark: '字'.repeat(501), staffIds: [1],
  }, '2026-08-01'), /500字/)
  assert.throws(() => validateDiningSupplementPayload({
    openedAt: '2026-08-01 10:30:00', date: '2026-08-01', mealType: '2', staffIds: Array.from({ length: 501 }, (_, index) => index + 1),
  }, '2026-08-01'), /最多添加500人/)
})

test('补录审核列表默认每页10条并清理搜索关键字', () => {
  assert.deepEqual(normalizeSupplementReviewQuery({}), { keyword: '', page: 1, pageSize: 10 })
  assert.deepEqual(normalizeSupplementReviewQuery({ keyword: ' 陈细凤 ', page: '2', pageSize: '20' }), {
    keyword: '陈细凤', page: 2, pageSize: 20,
  })
})

test('补录审核列表按逻辑批次分页并可通过人员资料搜索', async () => {
  let statement = ''
  const request = {
    input() { return this },
    async query(sqlText) {
      statement = sqlText
      return { recordset: [{
        row_no: 11, total_count: 9371, anchor_id: 916383, batch_code: 'BL-260801173116-94D325C6',
        supplement_date: '2026-07-29', meal_type: '2', operator_name: '超级管理员',
        added_at: '2026-08-01 17:27:53', people_count: 1, min_del: 1, max_del: 1,
      }] }
    },
  }
  const service = createDiningRecordsService({
    getPool: async () => ({ request: () => request }),
    tables: { mealLogs: '[LOGS]' },
  })
  const result = await service.listSupplementReviews({ keyword: '陈细凤', page: 2, pageSize: 10 })
  assert.match(statement, /GROUP BY[\s\S]*blsystemcode[\s\S]*dtime[\s\S]*meal_type[\s\S]*bluser[\s\S]*addtime/i)
  assert.match(statement, /employee_name LIKE N'%' \+ @keyword/)
  assert.match(statement, /new_card_id LIKE N'%' \+ @keyword/)
  assert.match(statement, /ROW_NUMBER\(\) OVER/)
  assert.match(statement, /COUNT\(1\) OVER \(\)/)
  assert.doesNotMatch(statement, /OFFSET\s+/i)
  assert.equal(result.pagination.total, 9371)
  assert.equal(result.rows[0].status, 'pending')
  assert.equal(result.rows[0].mealTypeName, '午餐')
  assert.equal(result.rows[0].addedAt, '2026-08-01 17:27:53')
})

test('补录审核明细通过代表行定位逻辑批次并优先显示新卡', async () => {
  let statement = ''
  const request = {
    input() { return this },
    async query(sqlText) {
      statement = sqlText
      return { recordset: [{ id: 916383, employee_name: '陈细凤', new_card_id: 'NEW-1', card_id: 'OLD-1' }] }
    },
  }
  const service = createDiningRecordsService({
    getPool: async () => ({ request: () => request }),
    tables: { mealLogs: '[LOGS]' },
  })
  const result = await service.getSupplementReviewDetails(916383)
  assert.match(statement, /WHERE id=@anchorId/)
  assert.match(statement, /blsystemcode[\s\S]*dtime[\s\S]*meal_type[\s\S]*bluser[\s\S]*addtime/i)
  assert.deepEqual(result.rows, [{ id: 916383, employeeName: '陈细凤', cardNumber: 'NEW-1' }])
  await assert.rejects(() => service.getSupplementReviewDetails(0), /补录批次无效/)
})

function createSupplementReviewTransaction({ state = '1', conflicts = [], affected = 2, skipConflict = false } = {}) {
  const statements = []
  let queryIndex = 0
  return {
    statements,
    committed: false,
    rolledBack: false,
    async begin() {},
    request() {
      return {
        input() { return this },
        async query(statement) {
          statements.push(statement)
          queryIndex += 1
          if (queryIndex === 1) return { recordset: [
            { id: 101, uid: '7', employee_name: '甲', del: state, batch_code: 'BL-1', supplement_date: '2026-07-29', meal_type: '2', operator_name: '管理员', added_at: '2026-08-01 10:00:00' },
            { id: 102, uid: '8', employee_name: '乙', del: state, batch_code: 'BL-1', supplement_date: '2026-07-29', meal_type: '2', operator_name: '管理员', added_at: '2026-08-01 10:00:00' },
          ] }
          if (queryIndex === 2) return { recordset: [{ locked: 1 }] }
          if (queryIndex === 3 && !skipConflict) return { recordset: conflicts }
          return { rowsAffected: [affected] }
        },
      }
    },
    async commit() { this.committed = true },
    async rollback() { this.rolledBack = true },
  }
}

test('补录审核按员工升序取得刷卡锁并整批转为正式流水', async () => {
  const transaction = createSupplementReviewTransaction()
  const service = createDiningRecordsService({
    getPool: async () => ({}), transactionFactory: () => transaction,
    tables: { mealLogs: '[LOGS]' },
  })
  const result = await service.auditSupplementReview(102)
  assert.match(transaction.statements[0], /UPDLOCK,HOLDLOCK/)
  assert.match(transaction.statements[1], /sp_getapplock/)
  assert.match(transaction.statements[1], /ORDER BY uid/)
  assert.match(transaction.statements[2], /existing\.del=N'0'/)
  assert.match(transaction.statements[3], /SET del=@targetState/)
  assert.equal(result.peopleCount, 2)
  assert.equal(result.status, 'approved')
  assert.equal(transaction.committed, true)
})

test('补录审核发现其他正式流水时整批回滚并返回冲突人员', async () => {
  const transaction = createSupplementReviewTransaction({ conflicts: [{ uid: '8', employee_name: '乙' }] })
  const service = createDiningRecordsService({
    getPool: async () => ({}), transactionFactory: () => transaction,
    tables: { mealLogs: '[LOGS]' },
  })
  await assert.rejects(
    () => service.auditSupplementReview(102),
    (error) => error.status === 409 && error.conflicts?.[0]?.employeeName === '乙',
  )
  assert.equal(transaction.statements.length, 3)
  assert.equal(transaction.rolledBack, true)
})

test('补录反审整批恢复待审核且不要求填写原因', async () => {
  const transaction = createSupplementReviewTransaction({ state: '0', skipConflict: true })
  const service = createDiningRecordsService({
    getPool: async () => ({}), transactionFactory: () => transaction,
    tables: { mealLogs: '[LOGS]' },
  })
  const result = await service.unauditSupplementReview(102)
  assert.match(transaction.statements[2], /SET del=@targetState/)
  assert.equal(result.status, 'pending')
  assert.equal(transaction.committed, true)
})

test('补录初始化使用服务器时间和登录人真实姓名', () => {
  const service = createDiningRecordsService({
    now: () => new Date('2026-08-01T02:30:45.000Z'),
    tables: { staff: '[STAFF]', mealLogs: '[LOGS]' },
  })
  assert.deepEqual(service.getSupplementInit({ utruename: '管理员' }), {
    openedAt: '2026-08-01 10:30:45', today: '2026-08-01', operatorName: '管理员', maxStaff: 500,
  })
  assert.throws(() => service.getSupplementInit({}), /未设置真实姓名/)
})

test('补录人员选择使用ROW_NUMBER服务端分页并优先显示新卡', async () => {
  let statement = ''
  const request = {
    input() { return this },
    async query(sqlText) {
      statement = sqlText
      return { recordset: [{
        total_count: 21, id: 7, employee_code: 'E007', employee_name: '测试员工',
        new_card_number: 'NEW7', card_number: 'OLD7', employee_meal_type: '正式员工',
      }] }
    },
  }
  const service = createDiningRecordsService({
    getPool: async () => ({ request: () => request }),
    tables: { staff: '[STAFF]' },
  })
  const result = await service.listSupplementStaff({ keyword: '测试', page: 2, pageSize: 20 })
  assert.match(statement, /ROW_NUMBER\(\) OVER/)
  assert.match(statement, /COUNT\(1\) OVER \(\)/)
  assert.match(statement, /s\.del=N'0'/)
  assert.match(statement, /s\.pass=N'1'/)
  assert.match(statement, /s\.new_code LIKE N'%' \+ @keyword/)
  assert.match(statement, /s\.code LIKE N'%' \+ @keyword/)
  assert.doesNotMatch(statement, /OFFSET\s+/i)
  assert.equal(result.total, 21)
  assert.equal(result.list[0].cardNumber, 'NEW7')
})

test('一键补录月份只接受YYYY-MM，并按实际月份取得首末日期', () => {
  assert.deepEqual(normalizeOneClickMonth('2026-02'), {
    month: '2026-02', startDate: '2026-02-01', endDate: '2026-02-28',
  })
  assert.deepEqual(normalizeOneClickMonth('2024-02'), {
    month: '2024-02', startDate: '2024-02-01', endDate: '2024-02-29',
  })
  assert.throws(() => normalizeOneClickMonth('2026-13'), DiningRecordsError)
})

test('一键补录预览合并旧系统同餐多菜，并只返回已过结束时间的未刷卡餐次', async () => {
  const statements = []
  let queryIndex = 0
  const request = {
    input() { return this },
    async query(statement) {
      statements.push(statement)
      queryIndex += 1
      if (queryIndex === 1) return { recordset: [{ id: 7, code: 'E007', new_code: 'NE007', name: '测试员工', in_bm: '办公室', card_number: 'OLD7', new_card_number: 'NEW7' }] }
      if (queryIndex === 2) return { recordset: [{ two2: '13:30', three2: '18:30' }] }
      return { recordset: [{ meal_date: '2026-08-01', meal_type: '2' }, { meal_date: '2026-08-01', meal_type: '3' }] }
    },
  }
  const service = createDiningRecordsService({
    getPool: async () => ({ request: () => request }),
    now: () => new Date('2026-08-01T06:00:00.000Z'),
    tables: { staff: '[STAFF]', config: '[CONFIG]', meals: '[MEALS]', mealLogs: '[LOGS]' },
  })
  const result = await service.listOneClickSupplementPreview({ staffId: 7, month: '2026-08' })
  assert.equal(result.employee.employeeCode, 'NE007')
  assert.equal(result.employee.department, '办公室')
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].mealType, '2')
  assert.match(statements[2], /SELECT DISTINCT/)
  assert.match(statements[2], /m\.del=N'0' AND m\.pass=N'1'/)
  assert.match(statements[2], /NOT EXISTS \(SELECT 1 FROM \[LOGS\] l/)
  assert.match(statements[2], /p\.bl=N'1' AND p\.del=N'1'/)
})

function createSupplementTransaction({ insertedRows = [{ id: 7, employee_name: '测试员工' }], skippedRows = [{ id: 8, employee_name: '重复员工', reason: '已存在有效刷卡' }] } = {}) {
  const statements = []
  const inputs = []
  let queryIndex = 0
  return {
    statements,
    inputs,
    committed: false,
    rolledBack: false,
    async begin() {},
    request() {
      const params = {}
      return {
        input(name, _type, value) { params[name] = value; return this },
        query: async (statement) => {
          statements.push(statement)
          inputs.push(params)
          queryIndex += 1
          if (queryIndex === 1) return { recordset: [{ locked: 1 }] }
          return { recordsets: [insertedRows, skippedRows] }
        },
      }
    },
    async commit() { this.committed = true },
    async rollback() { this.rolledBack = true },
  }
}

test('保存补录按员工升序锁定并整批写为待审核', async () => {
  const transaction = createSupplementTransaction()
  const service = createDiningRecordsService({
    getPool: async () => ({}),
    transactionFactory: () => transaction,
    now: () => new Date('2026-08-01T04:00:00.000Z'),
    tables: { mealLogs: '[LOGS]', staff: '[STAFF]' },
  })
  const result = await service.createSupplement({
    openedAt: '2026-08-01 10:30:00', mealType: '3', date: '2026-07-31', remark: '测试补录', staffIds: [8, 7],
  }, { utruename: '管理员', ip: '192.168.1.10' })
  assert.match(transaction.statements[0], /sp_getapplock/)
  assert.match(transaction.statements[0], /SELECT id FROM @Selected ORDER BY id/)
  assert.match(transaction.statements[1], /INSERT INTO \[LOGS\]/)
  assert.match(transaction.statements[1], /N'消费成功',N'1',[\s\S]*N'1'/)
  assert.match(transaction.statements[1], /s\.del=N'0' AND s\.pass=N'1'/)
  assert.equal(transaction.inputs[1].operatorName, '管理员')
  assert.equal(transaction.inputs[1].ip, '192.168.1.10')
  assert.equal(transaction.inputs[1].openedAt, '2026-08-01 10:30:00')
  assert.match(result.batchCode, /^BL-260801120000-[0-9A-F]{8}$/)
  assert.equal(result.insertedCount, 1)
  assert.equal(result.skippedCount, 1)
  assert.equal(transaction.committed, true)
})

test('全部重复时不返回空批次号', async () => {
  const transaction = createSupplementTransaction({
    insertedRows: [],
    skippedRows: [{ id: 7, employee_name: '重复员工', reason: '已有待审核补录' }],
  })
  const service = createDiningRecordsService({
    getPool: async () => ({}), transactionFactory: () => transaction,
    now: () => new Date('2026-08-01T04:00:00.000Z'), tables: { mealLogs: '[LOGS]', staff: '[STAFF]' },
  })
  const result = await service.createSupplement({
    openedAt: '2026-08-01 10:30:00', mealType: '2', date: '2026-08-01', staffIds: [7],
  }, { utruename: '管理员', ip: '127.0.0.1' })
  assert.equal(result.batchCode, '')
  assert.equal(result.insertedCount, 0)
  assert.equal(result.skippedCount, 1)
})

test('消费记录搜索参数缺省日期时回落到三月窗，并校验餐别', () => {
  const fallback = recentThreeMonthRange(new Date('2026-08-01T04:00:00.000Z'))
  assert.deepEqual(normalizeDiningConsumptionQuery({}, fallback), {
    startDate: '2026-06-01',
    endDate: '2026-08-31',
    employee: '',
    mealType: '',
    cardNumber: '',
    page: 1,
    pageSize: 10,
  })
  assert.deepEqual(
    normalizeDiningConsumptionQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      employee: ' 张三 ',
      mealType: '2',
      cardNumber: '123',
      page: '2',
      pageSize: '20',
    }, fallback),
    {
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      employee: '张三',
      mealType: '2',
      cardNumber: '123',
      page: 2,
      pageSize: 20,
    },
  )
  assert.throws(() => normalizeDiningConsumptionQuery({ mealType: '1' }, fallback), DiningRecordsError)
  assert.throws(
    () => normalizeDiningConsumptionQuery({ startDate: '2026-08-10', endDate: '2026-08-01' }, fallback),
    DiningRecordsError,
  )
})

test('消费记录搜索只读正式流水并按员工餐别卡号过滤', async () => {
  let statement = ''
  const request = {
    input() { return this },
    async query(sqlText) {
      statement = sqlText
      return {
        recordset: [{
          total_count: 2,
          id: 88,
          consume_date: '2026-08-01',
          edible_time_text: '2026-08-01 12:01:00',
          employee_code: 'E008',
          employee_name: '消费员工',
          card_number: 'NC88',
          meal_type: '2',
          source_flag: '1',
          bluser: '管理员',
          remark_text: '后台补录',
        }],
      }
    },
  }
  const service = createDiningRecordsService({
    getPool: async () => ({ request: () => request }),
    now: () => new Date('2026-08-01T04:00:00.000Z'),
    tables: { mealLogs: '[LOGS]' },
  })
  const result = await service.listConsumptions({
    startDate: '2026-07-01',
    endDate: '2026-08-01',
    employee: '消费',
    mealType: '2',
    cardNumber: 'NC',
    page: 1,
    pageSize: 10,
  })
  assert.match(statement, /ISNULL\(l\.del, N'0'\)\)\) = N'0'/)
  assert.match(statement, /employee_id[\s\S]*employee_name/)
  assert.match(statement, /card_id[\s\S]*new_card_id/)
  assert.match(statement, /ROW_NUMBER\(\) OVER/)
  assert.doesNotMatch(statement, /OFFSET\s+/i)
  assert.equal(result.pagination.total, 2)
  assert.equal(result.rows[0].source, 'supplement')
  assert.equal(result.rows[0].sourceLabel, '补录')
  assert.equal(result.rows[0].operatorName, '管理员')
  assert.equal(result.rows[0].mealTypeName, '午餐')
  assert.deepEqual(result.range, { startDate: '2026-07-01', endDate: '2026-08-01' })
})
