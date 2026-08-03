import { getPool, sql } from './db.js'
import { createDiningTableRefs } from './diningDatabase.js'
import { readDiningBearerToken } from './diningAuthHandlers.js'

export const DINING_PROFILE_PAGE_SIZE = 10

const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function twoDigits(value) {
  return String(value).padStart(2, '0')
}

export function getDiningProfileShanghaiNow(nowRaw = new Date()) {
  const date = nowRaw instanceof Date ? nowRaw : new Date(nowRaw)
  const values = Object.fromEntries(
    shanghaiFormatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}:${values.second}` }
}

export function addDiningProfileDays(dateKey, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? ''))
  if (!match) return ''
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)))
  return `${value.getUTCFullYear()}-${twoDigits(value.getUTCMonth() + 1)}-${twoDigits(value.getUTCDate())}`
}

function normalizeEndTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim())
  if (!match) return ''
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? 0)
  if (hour > 23 || minute > 59 || second > 59) return ''
  return `${twoDigits(hour)}:${twoDigits(minute)}:${twoDigits(second)}`
}

export function normalizeDiningProfileScope(value) {
  return String(value ?? '').trim().toLowerCase() === 'all' ? 'all' : 'recent'
}

export function normalizeDiningProfilePage(value) {
  const page = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(page) && page > 0 ? page : 1
}

export function resolveDiningProfileStatus(row, nowText, mealEnds) {
  const swiped = Number(row?.normal_swiped ?? 0) === 1 || Number(row?.supplement_swiped ?? 0) === 1
  if (swiped) return 'swiped'
  const endTime = String(row?.meal_type ?? '') === '2' ? mealEnds.lunch : mealEnds.dinner
  const mealDate = String(row?.meal_date ?? '').trim()
  return endTime && mealDate && nowText >= `${mealDate} ${endTime}` ? 'missed' : 'pending'
}

function bindText(request, name, value, length = 50) {
  return request.input(name, sql.NVarChar(length), String(value ?? ''))
}

export function createDiningProfileRepository(options = {}) {
  const poolProvider = options.getPool || getPool
  const tables = options.tables || createDiningTableRefs()

  async function getMealEnds() {
    const pool = await poolProvider()
    const result = await pool.request().query(`
      SELECT TOP (1) two2, three2
      FROM ${tables.config}
      WHERE code = N'UB_ERP_Dining' AND del = N'0' AND pass = N'1'
      ORDER BY id ASC
    `)
    const config = result.recordset?.[0] || {}
    const mealEnds = { lunch: normalizeEndTime(config.two2), dinner: normalizeEndTime(config.three2) }
    if (!mealEnds.lunch || !mealEnds.dinner) throw new DiningProfileError(500, '饭堂午晚餐结束时间配置无效，请联系管理员')
    return mealEnds
  }

  function createRecordsSql(rangeCondition = '', logRangeCondition = '') {
    return `
      WITH Reported AS (
        SELECT dis_dtime AS meal_date, dis_lx AS meal_type, 1 AS reported
        FROM ${tables.meals}
        WHERE uid = @employeeId AND del = N'0' AND pass = N'1' AND dis_lx IN (N'2', N'3')
          ${rangeCondition}
        GROUP BY dis_dtime, dis_lx
      ),
      Swiped AS (
        SELECT dtime AS meal_date, meal_type,
          MAX(CASE WHEN bc_info = N'0' THEN 1 ELSE 0 END) AS normal_swiped,
          MAX(CASE WHEN bc_info = N'消费成功' THEN 1 ELSE 0 END) AS supplement_swiped,
          MAX(addtime) AS swipe_time
        FROM ${tables.mealLogs}
        WHERE uid = @employeeId AND del = N'0' AND meal_type IN (N'2', N'3')
          AND bc_info IN (N'0', N'消费成功')
          ${logRangeCondition}
        GROUP BY dtime, meal_type
      ),
      Records AS (
        SELECT r.meal_date, r.meal_type, r.reported, ISNULL(s.normal_swiped, 0) AS normal_swiped,
          ISNULL(s.supplement_swiped, 0) AS supplement_swiped, s.swipe_time
        FROM Reported AS r
        LEFT JOIN Swiped AS s ON s.meal_date = r.meal_date AND s.meal_type = r.meal_type
        UNION ALL
        SELECT s.meal_date, s.meal_type, 0 AS reported, s.normal_swiped, s.supplement_swiped, s.swipe_time
        FROM Swiped AS s
        LEFT JOIN Reported AS r ON r.meal_date = s.meal_date AND r.meal_type = s.meal_type
        WHERE r.meal_type IS NULL
      )
    `
  }

  async function listRecentRecords({ employeeId, start, end }) {
    const pool = await poolProvider()
    const request = pool.request()
    bindText(request, 'employeeId', employeeId)
    bindText(request, 'startDate', start, 20)
    bindText(request, 'endDate', end, 20)
    const result = await request.query(`
      ${createRecordsSql('AND dis_dtime >= @startDate AND dis_dtime <= @endDate', 'AND dtime >= @startDate AND dtime <= @endDate')}
      SELECT meal_date, meal_type, reported, normal_swiped, supplement_swiped, swipe_time
      FROM Records
    `)
    return result.recordset || []
  }

  async function listAllRecords({ employeeId, page }) {
    const pool = await poolProvider()
    const request = pool.request()
    bindText(request, 'employeeId', employeeId)
    request.input('startRow', sql.Int, (page - 1) * DINING_PROFILE_PAGE_SIZE + 1)
    request.input('endRow', sql.Int, page * DINING_PROFILE_PAGE_SIZE)
    const result = await request.query(`
      ${createRecordsSql()}
      , DayRows AS (
        SELECT meal_date,
          MAX(CASE WHEN meal_type = N'2' THEN reported ELSE 0 END) AS lunch_reported,
          MAX(CASE WHEN meal_type = N'2' THEN normal_swiped ELSE 0 END) AS lunch_normal_swiped,
          MAX(CASE WHEN meal_type = N'2' THEN supplement_swiped ELSE 0 END) AS lunch_supplement_swiped,
          MAX(CASE WHEN meal_type = N'2' THEN swipe_time ELSE N'' END) AS lunch_swipe_time,
          MAX(CASE WHEN meal_type = N'3' THEN reported ELSE 0 END) AS dinner_reported,
          MAX(CASE WHEN meal_type = N'3' THEN normal_swiped ELSE 0 END) AS dinner_normal_swiped,
          MAX(CASE WHEN meal_type = N'3' THEN supplement_swiped ELSE 0 END) AS dinner_supplement_swiped,
          MAX(CASE WHEN meal_type = N'3' THEN swipe_time ELSE N'' END) AS dinner_swipe_time
        FROM Records
        GROUP BY meal_date
      ),
      Numbered AS (
        SELECT meal_date, lunch_reported, lunch_normal_swiped, lunch_supplement_swiped, lunch_swipe_time,
          dinner_reported, dinner_normal_swiped, dinner_supplement_swiped, dinner_swipe_time,
          COUNT(1) OVER () AS total_count,
          ROW_NUMBER() OVER (ORDER BY meal_date DESC) AS row_num
        FROM DayRows
      )
      SELECT meal_date, lunch_reported, lunch_normal_swiped, lunch_supplement_swiped, lunch_swipe_time,
        dinner_reported, dinner_normal_swiped, dinner_supplement_swiped, dinner_swipe_time, total_count
      FROM Numbered
      WHERE row_num BETWEEN @startRow AND @endRow
      ORDER BY row_num
    `)
    const rows = result.recordset || []
    return { rows, total: Number(rows[0]?.total_count ?? 0) }
  }

  return { getMealEnds, listRecentRecords, listAllRecords }
}

export class DiningProfileError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function createDiningProfileService(options = {}) {
  const repository = options.repository || createDiningProfileRepository(options)
  const now = options.now || (() => new Date())

  async function list(employee, input = {}) {
    const scope = normalizeDiningProfileScope(input.scope)
    const requestedPage = normalizeDiningProfilePage(input.page)
    const current = getDiningProfileShanghaiNow(now())
    const start = scope === 'recent' ? addDiningProfileDays(current.date, -23) : ''
    const end = scope === 'recent' ? addDiningProfileDays(current.date, 7) : ''
    const mealEnds = await repository.getMealEnds()
    const nowText = `${current.date} ${current.time}`
    const toMeal = (row, mealType, prefix = '') => {
      const reported = Number(row?.[`${prefix}reported`] ?? 0) === 1
      const normalSwiped = Number(row?.[`${prefix}normal_swiped`] ?? 0)
      const supplementSwiped = Number(row?.[`${prefix}supplement_swiped`] ?? 0)
      const swiped = normalSwiped === 1 || supplementSwiped === 1
      if (!reported && !swiped) return { reportLabel: '未报餐', status: 'none', statusLabel: '—', swipeTime: '' }
      const status = resolveDiningProfileStatus({ ...row, meal_type: mealType, normal_swiped: normalSwiped, supplement_swiped: supplementSwiped }, nowText, mealEnds)
      return {
        reportLabel: reported ? '已报餐' : '未报餐',
        status,
        statusLabel: status === 'swiped' ? '已打卡' : status === 'missed' ? '漏卡' : '未打卡',
        swipeTime: status === 'swiped' ? String(row?.[`${prefix}swipe_time`] ?? '').slice(11, 19) : '',
      }
    }

    let allRows = []
    let total = 0
    let page = requestedPage
    if (scope === 'recent') {
      const records = await repository.listRecentRecords({ employeeId: employee.id, start, end })
      const recordMap = new Map(records.map((row) => [`${row.meal_date}|${row.meal_type}`, row]))
      for (let date = start; date <= end; date = addDiningProfileDays(date, 1)) {
        const lunchRow = recordMap.get(`${date}|2`)
        const dinnerRow = recordMap.get(`${date}|3`)
        allRows.push({ date, lunch: toMeal(lunchRow, '2'), dinner: toMeal(dinnerRow, '3') })
      }
      allRows.reverse()
      total = allRows.length
    } else {
      const result = await repository.listAllRecords({ employeeId: employee.id, page })
      allRows = result.rows.map((row) => ({
        date: String(row.meal_date ?? ''),
        lunch: toMeal(row, '2', 'lunch_'),
        dinner: toMeal(row, '3', 'dinner_'),
      }))
      total = result.total
    }
    const totalPages = total > 0 ? Math.ceil(total / DINING_PROFILE_PAGE_SIZE) : 0
    page = totalPages > 0 ? Math.min(page, totalPages) : 1
    const rows = scope === 'recent'
      ? allRows.slice((page - 1) * DINING_PROFILE_PAGE_SIZE, page * DINING_PROFILE_PAGE_SIZE)
      : allRows
    return {
      scope,
      start,
      end,
      rows,
      pagination: {
        page,
        pageSize: DINING_PROFILE_PAGE_SIZE,
        total,
        totalPages,
      },
    }
  }

  return { list }
}

function profileErrorResponse(error) {
  if (error instanceof DiningProfileError) return { status: error.status, message: error.message }
  return { status: 500, message: '读取个人用餐记录失败，请稍后重试' }
}

export function registerDiningProfileRoutes(app, options = {}) {
  const authService = options.authService
  if (!authService?.getEmployee) throw new Error('registerDiningProfileRoutes 缺少独立报餐身份服务')
  const service = options.service || createDiningProfileService(options)

  app.get('/api/dining/profile/meals', async (req, res) => {
    const employee = authService.getEmployee(readDiningBearerToken(req))
    if (!employee) {
      res.status(401).json({ code: 401, msg: '报餐登录已失效，请重新登录', data: null })
      return
    }
    try {
      const data = await service.list(employee, req.query)
      res.json({ code: 200, msg: 'success', data })
    } catch (error) {
      console.error('读取员工个人用餐记录失败：', error)
      const response = profileErrorResponse(error)
      res.status(response.status).json({ code: response.status, msg: response.message, data: null })
    }
  })

  return service
}
