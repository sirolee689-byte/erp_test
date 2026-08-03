import { getPool, sql } from './db.js'
import { createDiningTableRefs } from './diningDatabase.js'

export class DiningReportsError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'DiningReportsError'
    this.status = status
  }
}

const text = (value) => String(value ?? '').trim()

export function formatDiningReportEmployeeName(name, leftAfterMeal) {
  const employeeName = text(name)
  return Number(leftAfterMeal) === 1 && employeeName ? `${employeeName}（已离职）` : employeeName
}

function shanghaiToday(nowRaw = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(nowRaw)
  const values = Object.fromEntries(parts.filter((item) => item.type !== 'literal').map((item) => [item.type, item.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function validateDailyOrderDate(value) {
  const date = text(value)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new DiningReportsError(400, '查询日期无效')
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  const normalized = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`
  if (normalized !== date) throw new DiningReportsError(400, '查询日期无效')
  return date
}

export function validateDateRange(startRaw, endRaw) {
  const startDate = validateDailyOrderDate(startRaw)
  const endDate = validateDailyOrderDate(endRaw)
  if (startDate > endDate) throw new DiningReportsError(400, '开始日期不能晚于结束日期')
  return { startDate, endDate }
}

export function validateMonthlyOrderMonth(value) {
  const month = text(value)
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new DiningReportsError(400, '统计月份无效')
  }
  return month
}

function listMonthDates(month) {
  const [year, monthNumber] = month.split('-').map(Number)
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}

export function createDiningReportsService(options = {}) {
  const poolProvider = options.getPool || getPool
  const tables = options.tables || createDiningTableRefs(options.databaseName)
  const now = options.now || (() => new Date())

  async function listDailyOrders(input = {}) {
    const date = validateDailyOrderDate(input.date || shanghaiToday(now()))
    const request = (await poolProvider()).request()
    request.input('date', sql.NVarChar(10), date)
    const result = await request.query(`
      WITH ValidMealRows AS (
        SELECT
          CASE
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.uid, N''))), N'') IS NOT NULL
              THEN N'UID:' + LTRIM(RTRIM(m.uid))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.user_new_code, N''))), N'') IS NOT NULL
              THEN N'NEW_CODE:' + LTRIM(RTRIM(m.user_new_code))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.user_code, N''))), N'') IS NOT NULL
              THEN N'CODE:' + LTRIM(RTRIM(m.user_code))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.new_card_number, N''))), N'') IS NOT NULL
              THEN N'NEW_CARD:' + LTRIM(RTRIM(m.new_card_number))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.card_number, N''))), N'') IS NOT NULL
              THEN N'CARD:' + LTRIM(RTRIM(m.card_number))
            ELSE N'ROW:' + CONVERT(nvarchar(50), m.id)
          END AS identity_key,
          LTRIM(RTRIM(ISNULL(m.uid, N''))) AS employee_uid,
          LTRIM(RTRIM(ISNULL(m.user_new_code, N''))) AS user_new_code,
          LTRIM(RTRIM(ISNULL(m.user_code, N''))) AS user_code,
          LTRIM(RTRIM(ISNULL(m.bm, N''))) AS department,
          LTRIM(RTRIM(ISNULL(m.utruename, N''))) AS employee_name,
          LTRIM(RTRIM(ISNULL(m.uname, N''))) AS employee_name_fallback,
          LTRIM(RTRIM(ISNULL(m.dis_lx, N''))) AS meal_type
        FROM ${tables.meals} m
        WHERE LTRIM(RTRIM(ISNULL(m.dis_dtime, N''))) = @date
          AND LTRIM(RTRIM(ISNULL(m.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(m.pass, N'0'))) = N'1'
          AND LTRIM(RTRIM(ISNULL(m.dis_lx, N''))) IN (N'2', N'3')
      )
      SELECT
        v.identity_key,
        COALESCE(
          MAX(NULLIF(v.user_new_code, N'')),
          MAX(NULLIF(v.user_code, N'')),
          MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.new_code, N''))), N'')),
          MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.code, N''))), N'')),
          N''
        ) AS employee_code,
        COALESCE(
          MAX(NULLIF(v.department, N'')),
          MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.in_bm, N''))), N'')),
          N''
        ) AS department,
        COALESCE(
          MAX(NULLIF(v.employee_name, N'')),
          MAX(NULLIF(v.employee_name_fallback, N'')),
          MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.name, N''))), N'')),
          N''
        ) AS employee_name,
        MAX(CASE
          WHEN LTRIM(RTRIM(ISNULL(s.del, N'0'))) = N'1'
            AND ISDATE(LTRIM(RTRIM(ISNULL(s.deltime, N'')))) = 1
            AND CONVERT(char(10), CONVERT(datetime, LTRIM(RTRIM(s.deltime))), 120) < @date
          THEN 1 ELSE 0
        END) AS left_after_meal,
        MAX(CASE WHEN v.meal_type = N'2' THEN 1 ELSE 0 END) AS has_lunch,
        MAX(CASE WHEN v.meal_type = N'3' THEN 1 ELSE 0 END) AS has_dinner
      FROM ValidMealRows v
      LEFT JOIN ${tables.staff} s
        ON CONVERT(nvarchar(50), s.id) = v.employee_uid
      GROUP BY v.identity_key
      ORDER BY department ASC, employee_code ASC, employee_name ASC, v.identity_key ASC
    `)

    const rows = (result.recordset || []).map((row, index) => ({
      sequence: index + 1,
      employeeCode: text(row.employee_code),
      department: text(row.department),
      employeeName: formatDiningReportEmployeeName(row.employee_name, row.left_after_meal),
      hasLunch: Number(row.has_lunch) === 1,
      hasDinner: Number(row.has_dinner) === 1,
    }))
    return {
      date,
      rows,
      summary: {
        totalPeople: rows.length,
        lunchPeople: rows.filter((row) => row.hasLunch).length,
        dinnerPeople: rows.filter((row) => row.hasDinner).length,
      },
    }
  }

  async function listMissedSwipeDepartments() {
    const result = await (await poolProvider()).request().query(`
      SELECT DISTINCT LTRIM(RTRIM(ISNULL(s.in_bm, N''))) AS department
      FROM ${tables.staff} s
      WHERE LTRIM(RTRIM(ISNULL(s.in_bm, N''))) <> N''
        AND LTRIM(RTRIM(ISNULL(s.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(s.pass, N'0'))) = N'1'
      ORDER BY department ASC
    `)
    return (result.recordset || []).map((row) => text(row.department)).filter(Boolean)
  }

  async function listMissedSwipes(input = {}) {
    const { startDate, endDate } = validateDateRange(input.startDate, input.endDate)
    const department = text(input.department)
    const request = (await poolProvider()).request()
    request.input('startDate', sql.NVarChar(10), startDate)
    request.input('endDate', sql.NVarChar(10), endDate)
    request.input('department', sql.NVarChar(200), department)

    const result = await request.query(`
      WITH ValidMealRows AS (
        SELECT
          CASE
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.uid, N''))), N'') IS NOT NULL
              THEN N'UID:' + LTRIM(RTRIM(m.uid))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.user_new_code, N''))), N'') IS NOT NULL
              THEN N'NEW_CODE:' + LTRIM(RTRIM(m.user_new_code))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.user_code, N''))), N'') IS NOT NULL
              THEN N'CODE:' + LTRIM(RTRIM(m.user_code))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.new_card_number, N''))), N'') IS NOT NULL
              THEN N'NEW_CARD:' + LTRIM(RTRIM(m.new_card_number))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.card_number, N''))), N'') IS NOT NULL
              THEN N'CARD:' + LTRIM(RTRIM(m.card_number))
            ELSE N'ROW:' + CONVERT(nvarchar(50), m.id)
          END AS identity_key,
          LTRIM(RTRIM(ISNULL(m.uid, N''))) AS employee_uid,
          LTRIM(RTRIM(ISNULL(m.user_new_code, N''))) AS user_new_code,
          LTRIM(RTRIM(ISNULL(m.user_code, N''))) AS user_code,
          LTRIM(RTRIM(ISNULL(m.new_card_number, N''))) AS new_card_number,
          LTRIM(RTRIM(ISNULL(m.card_number, N''))) AS card_number,
          LTRIM(RTRIM(ISNULL(m.bm, N''))) AS department,
          LTRIM(RTRIM(ISNULL(m.utruename, N''))) AS employee_name,
          LTRIM(RTRIM(ISNULL(m.uname, N''))) AS employee_name_fallback,
          LTRIM(RTRIM(ISNULL(m.dis_dtime, N''))) AS meal_date,
          LTRIM(RTRIM(ISNULL(m.dis_lx, N''))) AS meal_type
        FROM ${tables.meals} m
        WHERE LTRIM(RTRIM(ISNULL(m.dis_dtime, N''))) >= @startDate
          AND LTRIM(RTRIM(ISNULL(m.dis_dtime, N''))) <= @endDate
          AND LTRIM(RTRIM(ISNULL(m.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(m.pass, N'0'))) = N'1'
          AND LTRIM(RTRIM(ISNULL(m.dis_lx, N''))) IN (N'2', N'3')
      ),
      OrderedMeals AS (
        SELECT
          v.identity_key,
          v.meal_date,
          v.meal_type,
          MAX(NULLIF(v.employee_uid, N'')) AS employee_uid,
          COALESCE(MAX(NULLIF(v.department, N'')), MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.in_bm, N''))), N'')), N'') AS department,
          COALESCE(MAX(NULLIF(v.user_new_code, N'')), MAX(NULLIF(v.user_code, N'')), MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.new_code, N''))), N'')), MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.code, N''))), N'')), N'') AS employee_code,
          COALESCE(MAX(NULLIF(v.user_code, N'')), MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.code, N''))), N'')), N'') AS legacy_employee_code,
          COALESCE(MAX(NULLIF(v.employee_name, N'')), MAX(NULLIF(v.employee_name_fallback, N'')), MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.name, N''))), N'')), N'') AS employee_name,
          COALESCE(MAX(NULLIF(v.new_card_number, N'')), MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.new_card_number, N''))), N'')), N'') AS new_card_number,
          COALESCE(MAX(NULLIF(v.card_number, N'')), MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.card_number, N''))), N'')), N'') AS card_number,
          MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.position, N''))), N'')) AS position,
          MAX(CASE
            WHEN LTRIM(RTRIM(ISNULL(s.del, N'0'))) = N'1'
              AND ISDATE(LTRIM(RTRIM(ISNULL(s.deltime, N'')))) = 1
              AND CONVERT(char(10), CONVERT(datetime, LTRIM(RTRIM(s.deltime)), 120), 120) < v.meal_date
            THEN 1 ELSE 0
          END) AS left_after_meal
        FROM ValidMealRows v
        LEFT JOIN ${tables.staff} s ON CONVERT(nvarchar(50), s.id) = v.employee_uid
        GROUP BY v.identity_key, v.meal_date, v.meal_type
      ),
      ComparedMeals AS (
        SELECT
          o.*,
          CASE WHEN EXISTS (
            SELECT 1
            FROM ${tables.mealLogs} l
            WHERE LTRIM(RTRIM(ISNULL(l.del, N'0'))) = N'0'
              AND LTRIM(RTRIM(ISNULL(l.dtime, N''))) = o.meal_date
              AND LTRIM(RTRIM(ISNULL(l.meal_type, N''))) = o.meal_type
              AND (
                (o.employee_uid <> N'' AND CONVERT(nvarchar(50), l.uid) = o.employee_uid)
                OR (o.employee_code <> N'' AND LTRIM(RTRIM(ISNULL(l.employee_id, N''))) = o.employee_code)
                OR (o.legacy_employee_code <> N'' AND LTRIM(RTRIM(ISNULL(l.employee_id, N''))) = o.legacy_employee_code)
                OR (o.new_card_number <> N'' AND LTRIM(RTRIM(ISNULL(l.new_card_id, N''))) = o.new_card_number)
                OR (o.card_number <> N'' AND LTRIM(RTRIM(ISNULL(l.card_id, N''))) = o.card_number)
              )
          ) THEN 1 ELSE 0 END AS has_swiped
        FROM OrderedMeals o
      )
      SELECT *
      FROM ComparedMeals
      WHERE (@department = N'' OR department = @department)
      ORDER BY department ASC, meal_date ASC, employee_code ASC, employee_name ASC, meal_type ASC
    `)

    const comparedRows = (result.recordset || []).map((row) => ({
      department: text(row.department),
      employeeCode: text(row.employee_code),
      employeeName: formatDiningReportEmployeeName(row.employee_name, row.left_after_meal),
      cardNumber: text(row.new_card_number) || text(row.card_number),
      position: text(row.position),
      mealType: text(row.meal_type) === '2' ? '午餐' : '晚餐',
      mealDate: text(row.meal_date),
      hasSwiped: Number(row.has_swiped) === 1,
    }))
    const missedRows = comparedRows.filter((row) => !row.hasSwiped).map((row, index) => ({ ...row, sequence: index + 1 }))
    return {
      startDate,
      endDate,
      department,
      rows: missedRows,
      summary: {
        totalPeople: comparedRows.length,
        swipedPeople: comparedRows.filter((row) => row.hasSwiped).length,
        missedPeople: missedRows.length,
      },
    }
  }

  async function listConsumptionSummary(input = {}) {
    const { startDate, endDate } = validateDateRange(input.startDate, input.endDate)
    const department = text(input.department)
    // 消费汇总以在职已审核员工为名单基础，先批量读取三类数据，
    // 再在内存按“员工＋日期＋餐别”去重，避免逐员工查库。
    const pool = await poolProvider()
    const mealRequest = pool.request()
    mealRequest.input('startDate', sql.NVarChar(10), startDate)
    mealRequest.input('endDate', sql.NVarChar(10), endDate)
    const staffRequest = pool.request()
    staffRequest.input('department', sql.NVarChar(200), department)
    const swipeRequest = pool.request()
    swipeRequest.input('startDate', sql.NVarChar(10), startDate)
    swipeRequest.input('endDate', sql.NVarChar(10), endDate)
    const [mealResult, staffResult, swipeResult] = await Promise.all([
      mealRequest.query(`
        SELECT m.id, m.uid, m.user_new_code, m.user_code, m.new_card_number, m.card_number,
          m.bm, m.utruename, m.uname, m.dis_dtime, m.dis_lx
        FROM ${tables.meals} m
        WHERE m.del = N'0' AND m.pass = N'1'
          AND m.dis_dtime >= @startDate AND m.dis_dtime <= @endDate
          AND m.dis_lx IN (N'2', N'3')
      `),
      staffRequest.query(`
        SELECT id, code, new_code, name, in_bm, card_number, new_card_number
        FROM ${tables.staff}
        WHERE LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(pass, N''))) = N'1'
          AND (@department = N'' OR LTRIM(RTRIM(ISNULL(in_bm, N''))) = @department)
      `),
      swipeRequest.query(`
        SELECT uid, employee_id, card_id, new_card_id, meal_type, dtime, bl
        FROM ${tables.mealLogs}
        WHERE del = N'0' AND dtime >= @startDate AND dtime <= @endDate
          AND meal_type IN (N'2', N'3')
      `),
    ])
    const datePart = (value) => text(value).slice(0, 10)
    const staffRows = staffResult.recordset || []
    const staffById = new Map()
    const staffByCode = new Map()
    const staffByCard = new Map()
    const remember = (map, value, staff) => {
      const key = text(value)
      if (key && !map.has(key)) map.set(key, staff)
    }
    for (const staff of staffRows) {
      remember(staffById, staff.id, staff)
      remember(staffByCode, staff.new_code, staff)
      remember(staffByCode, staff.code, staff)
      remember(staffByCard, staff.new_card_number, staff)
      remember(staffByCard, staff.card_number, staff)
    }
    const resolveStaff = (row, type) => {
      const byId = staffById.get(text(row.uid))
      if (byId) return byId
      if (type === 'meal') {
        return staffByCode.get(text(row.user_new_code))
          || staffByCode.get(text(row.user_code))
          || staffByCard.get(text(row.new_card_number))
          || staffByCard.get(text(row.card_number))
      }
      return staffByCode.get(text(row.employee_id))
        || staffByCard.get(text(row.new_card_id))
        || staffByCard.get(text(row.card_id))
    }
    const staffKey = (staff) => text(staff.id)
    const orderKeysByStaff = new Map(staffRows.map((staff) => [staffKey(staff), new Set()]))
    const swipeKeysByStaff = new Map(staffRows.map((staff) => [staffKey(staff), new Map()]))

    for (const row of mealResult.recordset || []) {
      const staff = resolveStaff(row, 'meal')
      const mealDate = datePart(row.dis_dtime)
      const mealType = text(row.dis_lx)
      if (!staff || !mealDate || !['2', '3'].includes(mealType)) continue
      orderKeysByStaff.get(staffKey(staff))?.add(`${mealDate}|${mealType}`)
    }
    for (const row of swipeResult.recordset || []) {
      const staff = resolveStaff(row, 'swipe')
      const mealDate = datePart(row.dtime)
      const mealType = text(row.meal_type)
      if (!staff || !mealDate || !['2', '3'].includes(mealType)) continue
      const employeeSwipes = swipeKeysByStaff.get(staffKey(staff))
      const mealKey = `${mealDate}|${mealType}`
      const existing = employeeSwipes?.get(mealKey) || { supplemented: false }
      existing.supplemented ||= text(row.bl) === '1'
      employeeSwipes?.set(mealKey, existing)
    }

    const rows = staffRows
      .map((staff) => {
        const orders = orderKeysByStaff.get(staffKey(staff)) || new Set()
        const swipes = swipeKeysByStaff.get(staffKey(staff)) || new Map()
        const lunchOrders = [...orders].filter((key) => key.endsWith('|2')).length
        const dinnerOrders = [...orders].filter((key) => key.endsWith('|3')).length
        const lunchSwipes = [...swipes.keys()].filter((key) => key.endsWith('|2')).length
        const dinnerSwipes = [...swipes.keys()].filter((key) => key.endsWith('|3')).length
        const lunchSupplements = [...swipes.entries()].filter(([key, value]) => key.endsWith('|2') && value.supplemented).length
        const dinnerSupplements = [...swipes.entries()].filter(([key, value]) => key.endsWith('|3') && value.supplemented).length
        const orderedSwiped = [...orders].filter((key) => swipes.has(key)).length
        const orderedMissed = orders.size - orderedSwiped
        const lunchAmount = lunchSwipes * 5
        const dinnerAmount = dinnerSwipes * 5
        const lunchMissedAmount = (lunchOrders - lunchSwipes) * 5
        const dinnerMissedAmount = (dinnerOrders - dinnerSwipes) * 5
        const subsidyAmount = lunchAmount + dinnerAmount
        return {
          department: text(staff.in_bm),
          employeeCode: text(staff.new_code) || text(staff.code),
          employeeName: text(staff.name),
          lunchOrders,
          lunchSwipes,
          lunchSupplements,
          lunchAmount,
          lunchMissedAmount,
          dinnerOrders,
          dinnerSwipes,
          dinnerSupplements,
          dinnerAmount,
          dinnerMissedAmount,
          orderedMissed,
          orderedSwiped,
          supplementTotal: lunchSupplements + dinnerSupplements,
          orderTotal: lunchOrders + dinnerOrders,
          subsidyAmount,
          deductionAmount: lunchMissedAmount + dinnerMissedAmount + subsidyAmount,
        }
      })
      .sort((a, b) => a.department.localeCompare(b.department, 'zh-CN') || a.employeeCode.localeCompare(b.employeeCode, 'zh-CN') || a.employeeName.localeCompare(b.employeeName, 'zh-CN'))
      .map(({ department: _department, ...row }, index) => ({ sequence: index + 1, ...row }))

    return { startDate, endDate, department, rows }
  }

  async function listMonthlyOrders(input = {}) {
    const month = validateMonthlyOrderMonth(input.month)
    const startDate = `${month}-01`
    const endDate = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`
    const request = (await poolProvider()).request()
    request.input('startDate', sql.NVarChar(10), startDate)
    request.input('endDate', sql.NVarChar(10), endDate)
    const result = await request.query(`
      WITH ValidMealRows AS (
        SELECT
          CASE
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.uid, N''))), N'') IS NOT NULL
              THEN N'UID:' + LTRIM(RTRIM(m.uid))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.user_new_code, N''))), N'') IS NOT NULL
              THEN N'NEW_CODE:' + LTRIM(RTRIM(m.user_new_code))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.user_code, N''))), N'') IS NOT NULL
              THEN N'CODE:' + LTRIM(RTRIM(m.user_code))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.new_card_number, N''))), N'') IS NOT NULL
              THEN N'NEW_CARD:' + LTRIM(RTRIM(m.new_card_number))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.card_number, N''))), N'') IS NOT NULL
              THEN N'CARD:' + LTRIM(RTRIM(m.card_number))
            ELSE N'ROW:' + CONVERT(nvarchar(50), m.id)
          END AS identity_key,
          LTRIM(RTRIM(ISNULL(m.uid, N''))) AS employee_uid,
          LTRIM(RTRIM(ISNULL(m.dis_dtime, N''))) AS meal_date,
          LTRIM(RTRIM(ISNULL(m.dis_lx, N''))) AS meal_type,
          LTRIM(RTRIM(ISNULL(m.dis_meal_type, N''))) AS meal_category
        FROM ${tables.meals} m
        WHERE LTRIM(RTRIM(ISNULL(m.dis_dtime, N''))) >= @startDate
          AND LTRIM(RTRIM(ISNULL(m.dis_dtime, N''))) <= @endDate
          AND LTRIM(RTRIM(ISNULL(m.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(m.pass, N'0'))) = N'1'
          AND LTRIM(RTRIM(ISNULL(m.dis_lx, N''))) IN (N'2', N'3')
      ),
      MergedMeals AS (
        SELECT
          v.identity_key,
          v.meal_date,
          v.meal_type,
          COALESCE(
            MAX(NULLIF(v.meal_category, N'')),
            MAX(NULLIF(LTRIM(RTRIM(ISNULL(s.meal_type, N''))), N'')),
            N'员工餐'
          ) AS meal_category
        FROM ValidMealRows v
        LEFT JOIN ${tables.staff} s ON CONVERT(nvarchar(50), s.id) = v.employee_uid
        GROUP BY v.identity_key, v.meal_date, v.meal_type
      )
      SELECT
        meal_date,
        SUM(CASE WHEN meal_type = N'2' THEN 1 ELSE 0 END) AS lunch_total,
        SUM(CASE WHEN meal_type = N'2' AND meal_category = N'管理餐' THEN 1 ELSE 0 END) AS lunch_management,
        SUM(CASE WHEN meal_type = N'3' THEN 1 ELSE 0 END) AS dinner_total,
        SUM(CASE WHEN meal_type = N'3' AND meal_category = N'管理餐' THEN 1 ELSE 0 END) AS dinner_management
      FROM MergedMeals
      GROUP BY meal_date
      ORDER BY meal_date ASC
    `)

    const counts = new Map((result.recordset || []).map((row) => [text(row.meal_date), row]))
    return {
      month,
      rows: listMonthDates(month).map((date) => {
        const row = counts.get(date) || {}
        const lunchTotal = Number(row.lunch_total || 0)
        const lunchManagement = Number(row.lunch_management || 0)
        const dinnerTotal = Number(row.dinner_total || 0)
        const dinnerManagement = Number(row.dinner_management || 0)
        return {
          date,
          lunchTotal,
          lunchEmployee: Math.max(0, lunchTotal - lunchManagement),
          lunchManagement,
          dinnerTotal,
          dinnerEmployee: Math.max(0, dinnerTotal - dinnerManagement),
          dinnerManagement,
        }
      }),
    }
  }

  return { listDailyOrders, listMissedSwipeDepartments, listMissedSwipes, listConsumptionSummary, listMonthlyOrders }
}

export function registerDiningReportsRoutes(app, options = {}) {
  const service = options.service || createDiningReportsService(options)
  app.get('/api/canteen/reports/daily-orders', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.listDailyOrders(req.query) })
    } catch (error) {
      console.error('查询每天订餐情况表失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '查询每天订餐情况表失败' : error.message, data: null })
    }
  })
  app.get('/api/canteen/reports/missed-swipes/departments', async (_req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: { list: await service.listMissedSwipeDepartments() } })
    } catch (error) {
      console.error('读取订餐未刷卡部门失败：', error)
      res.status(500).json({ code: 500, msg: '读取订餐未刷卡部门失败', data: null })
    }
  })
  app.get('/api/canteen/reports/missed-swipes', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.listMissedSwipes(req.query) })
    } catch (error) {
      console.error('查询订餐未刷卡明细失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '查询订餐未刷卡明细失败' : error.message, data: null })
    }
  })
  app.get('/api/canteen/reports/consumption-summary', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.listConsumptionSummary(req.query) })
    } catch (error) {
      console.error('查询消费汇总失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '查询消费汇总失败' : error.message, data: null })
    }
  })
  app.get('/api/canteen/reports/monthly-orders', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.listMonthlyOrders(req.query) })
    } catch (error) {
      console.error('查询月报餐统计表失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '查询月报餐统计表失败' : error.message, data: null })
    }
  })
}
