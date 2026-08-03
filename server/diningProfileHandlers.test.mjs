import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  addDiningProfileDays,
  createDiningProfileRepository,
  createDiningProfileService,
  normalizeDiningProfilePage,
  normalizeDiningProfileScope,
  resolveDiningProfileStatus,
} from './diningProfileHandlers.js'

process.env.DINING_DB_DATABASE = 'UB_ERP_V2.0'

describe('个人用餐记录状态', () => {
  test('近期范围按当天前23天至未来7天计算，范围与页码输入可规范化', () => {
    assert.equal(addDiningProfileDays('2026-08-01', -23), '2026-07-09')
    assert.equal(addDiningProfileDays('2026-08-01', 7), '2026-08-08')
    assert.equal(normalizeDiningProfileScope('all'), 'all')
    assert.equal(normalizeDiningProfileScope('other'), 'recent')
    assert.equal(normalizeDiningProfilePage('3'), 3)
    assert.equal(normalizeDiningProfilePage('0'), 1)
  })

  test('已打卡、餐后漏卡、未来未打卡均按饭堂餐别结束时间判定', () => {
    const ends = { lunch: '13:30:00', dinner: '18:30:00' }
    assert.equal(resolveDiningProfileStatus({ meal_date: '2026-08-01', meal_type: '2', normal_swiped: 1 }, '2026-08-01 13:31:00', ends), 'swiped')
    assert.equal(resolveDiningProfileStatus({ meal_date: '2026-08-01', meal_type: '3' }, '2026-08-01 18:30:00', ends), 'missed')
    assert.equal(resolveDiningProfileStatus({ meal_date: '2026-08-02', meal_type: '2' }, '2026-08-01 18:30:00', ends), 'pending')
    assert.equal(resolveDiningProfileStatus({ meal_date: '2026-08-01', meal_type: '3', supplement_swiped: 1 }, '2026-08-01 18:30:00', ends), 'swiped')
  })

  test('服务把午餐晚餐合并成一天一行，并补齐近期未报餐日期', async () => {
    const repository = {
      async getMealEnds() { return { lunch: '13:30:00', dinner: '18:30:00' } },
      async listRecentRecords(input) {
        assert.equal(input.employeeId, 7)
        assert.equal(input.start, '2026-07-09')
        assert.equal(input.end, '2026-08-08')
        return [
          { meal_date: '2026-08-01', meal_type: '2', reported: 1, normal_swiped: 1, swipe_time: '2026-08-01 12:01:02' },
          { meal_date: '2026-07-31', meal_type: '3', reported: 1, normal_swiped: 0, supplement_swiped: 0, swipe_time: '' },
          { meal_date: '2026-08-02', meal_type: '3', reported: 0, normal_swiped: 0, supplement_swiped: 1, swipe_time: '2026-08-02 18:01:02' },
        ]
      },
    }
    const service = createDiningProfileService({ repository, now: () => new Date('2026-08-01T11:00:00.000Z') })
    const result = await service.list({ id: 7 }, { page: 1 })
    assert.equal(result.pagination.pageSize, 10)
    assert.equal(result.pagination.total, 31)
    assert.equal(result.pagination.totalPages, 4)
    const july31 = result.rows.find((row) => row.date === '2026-07-31')
    assert.deepEqual(july31?.dinner, { reportLabel: '已报餐', status: 'missed', statusLabel: '漏卡', swipeTime: '' })
    const july30 = result.rows.find((row) => row.date === '2026-07-30')
    assert.deepEqual(july30?.lunch, { reportLabel: '未报餐', status: 'none', statusLabel: '—', swipeTime: '' })
  })
})

describe('个人用餐记录查询', () => {
  test('全部记录使用一次分页查询按天合并报餐、正常刷卡与补餐，不重复执行总数查询', async () => {
    const capture = []
    const pool = {
      request() {
        const values = {}
        return {
          input(name, _type, value) { values[name] = value; return this },
          async query(statement) { capture.push({ statement, values }); return { recordset: [{ total_count: 12 }] } },
        }
      },
    }
    const repository = createDiningProfileRepository({ getPool: async () => pool })
    const result = await repository.listAllRecords({ employeeId: 7, page: 2 })
    assert.equal(result.total, 12)
    assert.equal(capture.length, 1)
    assert.equal(capture[0].values.startRow, 11)
    assert.equal(capture[0].values.endRow, 20)
    assert.match(capture[0].statement, /COUNT\(1\) OVER \(\)/)
    assert.match(capture[0].statement, /DayRows AS/)
    assert.match(capture[0].statement, /UNION ALL/)
    assert.match(capture[0].statement, /bc_info IN \(N'0', N'消费成功'\)/)
    assert.doesNotMatch(capture[0].statement, /OFFSET/)
  })
})
