import crypto from 'node:crypto'
import { getPool, sql } from './db.js'
import { createDiningTableRefs } from './diningDatabase.js'
import { clampErpPageSize } from './erpPagination.js'
import { resolveActorAuditTripletFromReq } from './businessAuditFields.js'
import { getRequestIp } from './requestIp.js'

const text = (value) => String(value ?? '').trim()
const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']
const PEOPLE_MEAL_TYPES = new Set(['2', '3'])
const SUPPLEMENT_MAX_STAFF = 500

const shanghaiDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export class DiningRecordsError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'DiningRecordsError'
    this.status = status
  }
}

function shanghaiNowParts(nowRaw) {
  const now = nowRaw instanceof Date ? nowRaw : new Date(nowRaw)
  if (Number.isNaN(now.getTime())) throw new DiningRecordsError(500, '服务器时间无效')
  const parts = Object.fromEntries(
    shanghaiDateTimeFormatter.formatToParts(now).filter((item) => item.type !== 'literal').map((item) => [item.type, item.value]),
  )
  const date = `${parts.year}-${parts.month}-${parts.day}`
  return { date, text: `${date} ${parts.hour}:${parts.minute}:${parts.second}` }
}

function bindText(request, name, value, length = 100) {
  return request.input(name, sql.NVarChar(length), text(value))
}

function escapeLikeKeyword(value) {
  return text(value).slice(0, 100).replaceAll('~', '~~').replaceAll('%', '~%').replaceAll('_', '~_').replaceAll('[', '~[')
}

export function normalizeDiningPeopleQuery(input = {}) {
  const rawPage = Number(input.page)
  return {
    keyword: text(input.keyword).slice(0, 100),
    page: Number.isFinite(rawPage) && rawPage >= 1 ? Math.trunc(rawPage) : 1,
    pageSize: clampErpPageSize(input.pageSize, 10),
  }
}

export function normalizeSupplementStaffQuery(input = {}) {
  const rawPage = Number(input.page)
  return {
    keyword: text(input.keyword).slice(0, 100),
    page: Number.isFinite(rawPage) && rawPage >= 1 ? Math.trunc(rawPage) : 1,
    pageSize: clampErpPageSize(input.pageSize, 20),
  }
}

export function normalizeSupplementReviewQuery(input = {}) {
  const rawPage = Number(input.page)
  return {
    keyword: text(input.keyword).slice(0, 100),
    page: Number.isFinite(rawPage) && rawPage >= 1 ? Math.trunc(rawPage) : 1,
    pageSize: clampErpPageSize(input.pageSize, 10),
  }
}

/**
 * 打卡消费记录搜索参数。日期缺省时由调用方用 recentThreeMonthRange 填入。
 * mealType 仅允许空（全部）、2（午餐）、3（晚餐）。
 */
export function normalizeDiningConsumptionQuery(input = {}, fallbackRange = null) {
  const rawPage = Number(input.page)
  let startDate = text(input.startDate)
  let endDate = text(input.endDate)
  if (!startDate || !endDate) {
    const range = fallbackRange || recentThreeMonthRange()
    startDate = startDate || range.startDate
    endDate = endDate || range.endDate
  }
  startDate = validateDateText(startDate, '开始日期无效')
  endDate = validateDateText(endDate, '结束日期无效')
  if (startDate > endDate) throw new DiningRecordsError(400, '开始日期不能晚于结束日期')
  const mealType = text(input.mealType)
  if (mealType && !PEOPLE_MEAL_TYPES.has(mealType)) throw new DiningRecordsError(400, '餐别只支持午餐或晚餐')
  return {
    startDate,
    endDate,
    employee: text(input.employee).slice(0, 100),
    mealType,
    cardNumber: text(input.cardNumber).slice(0, 100),
    page: Number.isFinite(rawPage) && rawPage >= 1 ? Math.trunc(rawPage) : 1,
    pageSize: clampErpPageSize(input.pageSize, 10),
  }
}

function validateDateText(value, message = '补录日期无效') {
  const date = text(value)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new DiningRecordsError(400, message)
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  const normalized = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`
  if (normalized !== date) throw new DiningRecordsError(400, message)
  return date
}

export function validateDiningSupplementPayload(input = {}, today = '') {
  const openedAt = text(input.openedAt)
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(openedAt)) {
    throw new DiningRecordsError(400, '添加时间无效，请重置后重试')
  }
  const date = validateDateText(input.date)
  if (today && date > today) throw new DiningRecordsError(400, '补录日期不能晚于今天')
  const mealType = text(input.mealType)
  if (!PEOPLE_MEAL_TYPES.has(mealType)) throw new DiningRecordsError(400, '请选择午餐或晚餐')
  const remark = text(input.remark)
  if (remark.length > 500) throw new DiningRecordsError(400, '备注不能超过500字')
  if (!Array.isArray(input.staffIds) || !input.staffIds.length) throw new DiningRecordsError(400, '请至少添加一名员工')
  const staffIds = [...new Set(input.staffIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  if (!staffIds.length) throw new DiningRecordsError(400, '人员明细无效')
  if (staffIds.length > SUPPLEMENT_MAX_STAFF) throw new DiningRecordsError(400, `一张补录单最多添加${SUPPLEMENT_MAX_STAFF}人`)
  return { openedAt, date, mealType, remark, staffIds }
}

function validateSupplementAnchorId(value) {
  const anchorId = Number(value)
  if (!Number.isInteger(anchorId) || anchorId <= 0) throw new DiningRecordsError(400, '补录批次无效')
  return anchorId
}

function createSupplementBatchCode(nowText) {
  const compact = text(nowText).replace(/\D/g, '').slice(2, 14)
  return `BL-${compact}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
}

export function normalizeOneClickMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(text(value))
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new DiningRecordsError(400, '请选择有效月份')
  const year = Number(match[1])
  const month = Number(match[2])
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { month: `${match[1]}-${match[2]}`, startDate: `${match[1]}-${match[2]}-01`, endDate: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}` }
}

function normalizeMealEndTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text(value))
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return ''
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}:00`
}

function bindStaffIds(request, staffIds) {
  const values = []
  staffIds.forEach((id, index) => {
    const name = `staffId${index}`
    request.input(name, sql.Int, id)
    values.push(`(@${name})`)
  })
  return values.join(',')
}

export function validateDiningPeopleCancelKey(input = {}) {
  const uid = text(input.uid)
  const date = text(input.date)
  const mealType = text(input.mealType)
  if (!uid || uid.length > 50) throw new DiningRecordsError(400, '员工信息无效')
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new DiningRecordsError(400, '报餐日期无效')
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (`${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}` !== date) {
    throw new DiningRecordsError(400, '报餐日期无效')
  }
  if (!PEOPLE_MEAL_TYPES.has(mealType)) throw new DiningRecordsError(400, '餐别无效')
  return { uid, date, mealType }
}

function datesOfMonth(monthKey) {
  const year = Number(monthKey.slice(0, 4))
  const month = Number(monthKey.slice(4, 6))
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: lastDay }, (_, index) => {
    const date = `${monthKey.slice(0, 4)}-${monthKey.slice(4, 6)}-${String(index + 1).padStart(2, '0')}`
    return { date, weekday: WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, index + 1)).getUTCDay()] }
  })
}

function dateParts(date) {
  const [year, month, day] = String(date).split('-').map(Number)
  return { year, month, day }
}

function weekdayOf(date) {
  const { year, month, day } = dateParts(date)
  return WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
}

export function recentThreeMonthRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const current = Object.fromEntries(parts.map((item) => [item.type, item.value]))
  const currentMonth = new Date(Date.UTC(Number(current.year), Number(current.month) - 1, 1))
  const startMonth = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 2, 1))
  const endDay = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 0)).getUTCDate()
  const startDate = `${startMonth.getUTCFullYear()}-${String(startMonth.getUTCMonth() + 1).padStart(2, '0')}-01`
  const endDate = `${current.year}-${current.month}-${String(endDay).padStart(2, '0')}`
  return { startDate, endDate, startMonth: startDate.slice(0, 7).replaceAll('-', ''), endMonth: `${current.year}${current.month}` }
}

function defaultRemark(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return weekday === 0 || weekday === 6 ? '周末默认不可报餐' : '工作日默认可报餐'
}

export function buildDiningRecordRows({ reportMonths = [], blocks = [], mealStats = [] }) {
  const preparedMonths = reportMonths.filter((item) => text(item.enabled) === '1').map((item) => text(item.month_key))
  const activeBlocks = blocks.filter((item) => text(item.del || '0') === '0' && text(item.enabled || '1') === '1')
  const stats = new Map()
  const dates = new Map(preparedMonths.flatMap(datesOfMonth).map((item) => [item.date, item]))
  for (const item of mealStats) {
    const reportDate = text(item.report_date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) continue
    const key = `${reportDate}|${text(item.meal_type)}`
    stats.set(key, { quantity: Number(item.quantity || 0), people: Number(item.people_count || 0) })
    if (!dates.has(reportDate)) dates.set(reportDate, { date: reportDate, weekday: weekdayOf(reportDate), historical: true })
  }
  return [...dates.values()].map(({ date, weekday, historical }) => {
    const special = activeBlocks.find((item) => text(item.start_date) <= date && text(item.end_date) >= date)
    const lunch = stats.get(`${date}|2`) || { quantity: 0, people: 0 }
    const dinner = stats.get(`${date}|3`) || { quantity: 0, people: 0 }
    const specialRemark = special
      ? `特殊日期：${text(special.report_status) === 'allowed' ? '可报餐' : '不可报餐'}${text(special.remark) ? `（${text(special.remark)}）` : ''}`
      : historical ? '历史报餐数据' : defaultRemark(date)
    return {
      date,
      weekday,
      totalQuantity: lunch.quantity + dinner.quantity,
      lunchQuantity: lunch.quantity,
      lunchPeople: lunch.people,
      dinnerQuantity: dinner.quantity,
      dinnerPeople: dinner.people,
      remark: specialRemark,
    }
  }).sort((left, right) => right.date.localeCompare(left.date))
}

export function createDiningRecordsService(options = {}) {
  const tables = options.tables || createDiningTableRefs()
  const poolProvider = options.getPool || getPool
  const now = options.now || (() => new Date())
  const transactionFactory = options.transactionFactory || ((pool) => new sql.Transaction(pool))

  async function list() {
    const db = await poolProvider()
    const range = recentThreeMonthRange(now())
    const [monthsResult, blocksResult] = await Promise.all([
      db.request().input('startMonth', sql.NVarChar(6), range.startMonth).input('endMonth', sql.NVarChar(6), range.endMonth).query(`SELECT month_key,enabled FROM ${tables.reportMonths} WHERE enabled=N'1' AND month_key>=@startMonth AND month_key<=@endMonth ORDER BY month_key DESC`),
      db.request().input('startDate', sql.NVarChar(10), range.startDate).input('endDate', sql.NVarChar(10), range.endDate).query(`SELECT month_key,start_date,end_date,report_status,remark,enabled,del FROM ${tables.reportBlocks} WHERE del=N'0' AND enabled=N'1' AND start_date<=@endDate AND end_date>=@startDate ORDER BY month_key DESC,start_date,id`),
    ])
    const reportMonths = monthsResult.recordset || []
    const statsResult = await db.request()
      .input('startDate', sql.NVarChar(10), range.startDate)
      .input('endDate', sql.NVarChar(10), range.endDate)
      .query(`
        SELECT
          LTRIM(RTRIM(ISNULL(dis_dtime,N''))) AS report_date,
          LTRIM(RTRIM(ISNULL(dis_lx,N''))) AS meal_type,
          COUNT(1) AS quantity,
          COUNT(DISTINCT LTRIM(RTRIM(ISNULL(uid,N'')))) AS people_count
        FROM ${tables.meals}
        WHERE LTRIM(RTRIM(ISNULL(dis_dtime,N'')))>=@startDate
          AND LTRIM(RTRIM(ISNULL(dis_dtime,N'')))<=@endDate
          AND LTRIM(RTRIM(ISNULL(dis_lx,N''))) IN (N'2',N'3')
          AND LTRIM(RTRIM(ISNULL(del,N'0')))=N'0'
          AND LTRIM(RTRIM(ISNULL(pass,N'0')))=N'1'
        GROUP BY LTRIM(RTRIM(ISNULL(dis_dtime,N''))),LTRIM(RTRIM(ISNULL(dis_lx,N'')))
      `)
    return { rows: buildDiningRecordRows({ reportMonths, blocks: blocksResult.recordset || [], mealStats: statsResult.recordset || [] }) }
  }

  async function listPeople(input = {}) {
    const { keyword, page, pageSize } = normalizeDiningPeopleQuery(input)
    const range = recentThreeMonthRange(now())
    const current = shanghaiNowParts(now())
    const rowStart = (page - 1) * pageSize + 1
    const rowEnd = page * pageSize
    const db = await poolProvider()
    const request = db.request()
    bindText(request, 'startDate', range.startDate, 10)
    bindText(request, 'endDate', range.endDate, 10)
    bindText(request, 'today', current.date, 10)
    bindText(request, 'keyword', escapeLikeKeyword(keyword), 200)
    request.input('rowStart', sql.Int, rowStart)
    request.input('rowEnd', sql.Int, rowEnd)
    const result = await request.query(`
      WITH MealGroups AS (
        SELECT
          LTRIM(RTRIM(ISNULL(uid, N''))) AS employee_uid,
          LTRIM(RTRIM(ISNULL(dis_dtime, N''))) AS report_date,
          LTRIM(RTRIM(ISNULL(dis_lx, N''))) AS meal_type,
          MIN(LTRIM(RTRIM(ISNULL(addtime, N'')))) AS report_time,
          MAX(LTRIM(RTRIM(ISNULL(utruename, N'')))) AS snapshot_name,
          MAX(LTRIM(RTRIM(ISNULL(user_new_code, N'')))) AS snapshot_new_code,
          MAX(LTRIM(RTRIM(ISNULL(user_code, N'')))) AS snapshot_code,
          MAX(LTRIM(RTRIM(ISNULL(new_card_number, N'')))) AS snapshot_new_card,
          MAX(LTRIM(RTRIM(ISNULL(card_number, N'')))) AS snapshot_card
        FROM ${tables.meals}
        WHERE LTRIM(RTRIM(ISNULL(dis_dtime, N''))) >= @startDate
          AND LTRIM(RTRIM(ISNULL(dis_dtime, N''))) <= @endDate
          AND LTRIM(RTRIM(ISNULL(dis_lx, N''))) IN (N'2', N'3')
          AND LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(pass, N'0'))) = N'1'
        GROUP BY LTRIM(RTRIM(ISNULL(uid, N''))), LTRIM(RTRIM(ISNULL(dis_dtime, N''))), LTRIM(RTRIM(ISNULL(dis_lx, N'')))
      ), SwipeGroups AS (
        SELECT
          LTRIM(RTRIM(ISNULL(uid, N''))) AS employee_uid,
          LTRIM(RTRIM(ISNULL(dtime, N''))) AS report_date,
          LTRIM(RTRIM(ISNULL(meal_type, N''))) AS meal_type
        FROM ${tables.mealLogs}
        WHERE LTRIM(RTRIM(ISNULL(dtime, N''))) >= @startDate
          AND LTRIM(RTRIM(ISNULL(dtime, N''))) <= @endDate
          AND LTRIM(RTRIM(ISNULL(meal_type, N''))) IN (N'2', N'3')
          AND LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
        GROUP BY LTRIM(RTRIM(ISNULL(uid, N''))), LTRIM(RTRIM(ISNULL(dtime, N''))), LTRIM(RTRIM(ISNULL(meal_type, N'')))
      ), DisplayRows AS (
        SELECT
          m.employee_uid AS uid,
          m.report_date,
          m.report_time,
          CASE WHEN LTRIM(RTRIM(ISNULL(s.new_code, N''))) <> N'' THEN LTRIM(RTRIM(s.new_code))
               WHEN m.snapshot_new_code <> N'' THEN m.snapshot_new_code ELSE m.snapshot_code END AS employee_code,
          m.meal_type,
          CASE WHEN LTRIM(RTRIM(ISNULL(s.name, N''))) <> N'' THEN LTRIM(RTRIM(s.name)) ELSE m.snapshot_name END AS employee_name,
          CASE WHEN LTRIM(RTRIM(ISNULL(s.new_card_number, N''))) <> N'' THEN LTRIM(RTRIM(s.new_card_number))
               WHEN m.snapshot_new_card <> N'' THEN m.snapshot_new_card
               WHEN LTRIM(RTRIM(ISNULL(s.card_number, N''))) <> N'' THEN LTRIM(RTRIM(s.card_number)) ELSE m.snapshot_card END AS card_number,
          CASE WHEN sw.employee_uid IS NULL THEN 0 ELSE 1 END AS has_swiped
        FROM MealGroups m
        LEFT JOIN ${tables.staff} s ON CONVERT(NVARCHAR(50), s.id) = m.employee_uid
        LEFT JOIN SwipeGroups sw ON sw.employee_uid = m.employee_uid AND sw.report_date = m.report_date AND sw.meal_type = m.meal_type
      ), FilteredRows AS (
        SELECT *
        FROM DisplayRows
        WHERE @keyword = N''
          OR report_date LIKE N'%' + @keyword + N'%' ESCAPE N'~'
          OR employee_code LIKE N'%' + @keyword + N'%' ESCAPE N'~'
          OR employee_name LIKE N'%' + @keyword + N'%' ESCAPE N'~'
          OR card_number LIKE N'%' + @keyword + N'%' ESCAPE N'~'
      ), NumberedRows AS (
        SELECT
          ROW_NUMBER() OVER (ORDER BY report_date DESC, report_time DESC, uid ASC, meal_type ASC) AS row_no,
          COUNT(1) OVER () AS total_count,
          uid, report_date, report_time, employee_code, meal_type, employee_name, card_number, has_swiped
        FROM FilteredRows
      )
      SELECT row_no, total_count, uid, report_date, report_time, employee_code, meal_type, employee_name, card_number, has_swiped,
        CASE WHEN report_date < @today OR has_swiped = 1 THEN 0 ELSE 1 END AS can_cancel
      FROM NumberedRows
      WHERE row_no BETWEEN @rowStart AND @rowEnd
      ORDER BY row_no
    `)
    const recordset = result.recordset || []
    const rows = recordset.map((row) => ({
      uid: text(row.uid),
      date: text(row.report_date),
      reportTime: text(row.report_time),
      employeeCode: text(row.employee_code),
      mealType: text(row.meal_type),
      mealTypeName: text(row.meal_type) === '2' ? '午餐' : '晚餐',
      employeeName: text(row.employee_name),
      cardNumber: text(row.card_number),
      hasSwiped: Number(row.has_swiped) === 1,
      canCancel: Number(row.can_cancel) === 1,
      cancelReason: Number(row.has_swiped) === 1 ? '已刷卡，不能取消报餐' : text(row.report_date) < current.date ? '历史日期不能取消报餐' : '',
    }))
    const total = Number(recordset[0]?.total_count || 0)
    return { rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } }
  }

  async function listConsumptions(input = {}) {
    const fallback = recentThreeMonthRange(now())
    const { startDate, endDate, employee, mealType, cardNumber, page, pageSize } = normalizeDiningConsumptionQuery(input, fallback)
    const rowStart = (page - 1) * pageSize + 1
    const rowEnd = page * pageSize
    const db = await poolProvider()
    const request = db.request()
    bindText(request, 'startDate', startDate, 10)
    bindText(request, 'endDate', endDate, 10)
    bindText(request, 'employee', escapeLikeKeyword(employee), 200)
    bindText(request, 'mealType', mealType, 10)
    bindText(request, 'cardNumber', escapeLikeKeyword(cardNumber), 200)
    request.input('rowStart', sql.Int, rowStart)
    request.input('rowEnd', sql.Int, rowEnd)
    const result = await request.query(`
      WITH FilteredLogs AS (
        SELECT
          l.id,
          LTRIM(RTRIM(ISNULL(l.dtime, N''))) AS consume_date,
          CONVERT(nvarchar(19), l.edible_time, 120) AS edible_time_text,
          LTRIM(RTRIM(ISNULL(l.employee_id, N''))) AS employee_code,
          LTRIM(RTRIM(ISNULL(l.employee_name, N''))) AS employee_name,
          CASE
            WHEN LTRIM(RTRIM(ISNULL(l.new_card_id, N''))) <> N'' THEN LTRIM(RTRIM(l.new_card_id))
            ELSE LTRIM(RTRIM(ISNULL(l.card_id, N'')))
          END AS card_number,
          LTRIM(RTRIM(ISNULL(l.meal_type, N''))) AS meal_type,
          CASE WHEN LTRIM(RTRIM(ISNULL(l.bl, N'0'))) = N'1' THEN N'1' ELSE N'0' END AS source_flag,
          LTRIM(RTRIM(ISNULL(l.bluser, N''))) AS bluser,
          CASE
            WHEN LTRIM(RTRIM(ISNULL(l.bl_info, N''))) <> N'' THEN LTRIM(RTRIM(l.bl_info))
            ELSE LTRIM(RTRIM(ISNULL(l.remark, N'')))
          END AS remark_text
        FROM ${tables.mealLogs} l
        WHERE LTRIM(RTRIM(ISNULL(l.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(l.meal_type, N''))) IN (N'2', N'3')
          AND LTRIM(RTRIM(ISNULL(l.dtime, N''))) >= @startDate
          AND LTRIM(RTRIM(ISNULL(l.dtime, N''))) <= @endDate
          AND (@mealType = N'' OR LTRIM(RTRIM(ISNULL(l.meal_type, N''))) = @mealType)
          AND (@employee = N''
            OR LTRIM(RTRIM(ISNULL(l.employee_id, N''))) LIKE N'%' + @employee + N'%' ESCAPE N'~'
            OR LTRIM(RTRIM(ISNULL(l.employee_name, N''))) LIKE N'%' + @employee + N'%' ESCAPE N'~')
          AND (@cardNumber = N''
            OR LTRIM(RTRIM(ISNULL(l.card_id, N''))) LIKE N'%' + @cardNumber + N'%' ESCAPE N'~'
            OR LTRIM(RTRIM(ISNULL(l.new_card_id, N''))) LIKE N'%' + @cardNumber + N'%' ESCAPE N'~')
      ), NumberedRows AS (
        SELECT
          ROW_NUMBER() OVER (ORDER BY edible_time_text DESC, id DESC) AS row_no,
          COUNT(1) OVER () AS total_count,
          id, consume_date, edible_time_text, employee_code, employee_name, card_number, meal_type, source_flag, bluser, remark_text
        FROM FilteredLogs
      )
      SELECT row_no, total_count, id, consume_date, edible_time_text, employee_code, employee_name, card_number, meal_type, source_flag, bluser, remark_text
      FROM NumberedRows
      WHERE row_no BETWEEN @rowStart AND @rowEnd
      ORDER BY row_no
    `)
    const recordset = result.recordset || []
    const rows = recordset.map((row) => {
      const type = text(row.meal_type)
      const isSupplement = text(row.source_flag) === '1'
      return {
        id: Number(row.id),
        date: text(row.consume_date).slice(0, 10),
        edibleTime: text(row.edible_time_text),
        employeeCode: text(row.employee_code),
        employeeName: text(row.employee_name),
        cardNumber: text(row.card_number),
        mealType: type,
        mealTypeName: type === '2' ? '午餐' : type === '3' ? '晚餐' : '未知餐别',
        source: isSupplement ? 'supplement' : 'swipe',
        sourceLabel: isSupplement ? '补录' : '刷卡',
        operatorName: isSupplement ? (text(row.bluser) || '—') : '—',
        remark: text(row.remark_text),
      }
    })
    const total = Number(recordset[0]?.total_count || 0)
    return {
      rows,
      pagination: { page, pageSize, total, totalPages: total > 0 ? Math.ceil(total / pageSize) : 0 },
      range: { startDate, endDate },
    }
  }

  function getSupplementInit(actor = {}) {
    const current = shanghaiNowParts(now())
    const operatorName = text(actor.utruename)
    if (!operatorName) throw new DiningRecordsError(409, '当前登录账号未设置真实姓名，不能新增补录')
    return { openedAt: current.text, today: current.date, operatorName, maxStaff: SUPPLEMENT_MAX_STAFF }
  }

  async function listSupplementStaff(input = {}) {
    const { keyword, page, pageSize } = normalizeSupplementStaffQuery(input)
    const rowStart = (page - 1) * pageSize + 1
    const rowEnd = page * pageSize
    const db = await poolProvider()
    const request = db.request()
    bindText(request, 'keyword', escapeLikeKeyword(keyword), 200)
    request.input('rowStart', sql.Int, rowStart)
    request.input('rowEnd', sql.Int, rowEnd)
    const result = await request.query(`
      WITH StaffBase AS (
        SELECT
          s.id,
          CASE WHEN LTRIM(RTRIM(ISNULL(s.new_code,N'')))<>N'' THEN LTRIM(RTRIM(s.new_code)) ELSE LTRIM(RTRIM(ISNULL(s.code,N''))) END AS employee_code,
          LTRIM(RTRIM(ISNULL(s.name,N''))) AS employee_name,
          LTRIM(RTRIM(ISNULL(s.new_card_number,N''))) AS new_card_number,
          LTRIM(RTRIM(ISNULL(s.card_number,N''))) AS card_number,
          LTRIM(RTRIM(ISNULL(s.in_bm,N''))) AS department,
          LTRIM(RTRIM(ISNULL(s.meal_type,N''))) AS employee_meal_type
        FROM ${tables.staff} s
        WHERE s.del=N'0'
          AND s.pass=N'1'
          AND (NULLIF(LTRIM(RTRIM(ISNULL(s.new_card_number,N''))),N'') IS NOT NULL
            OR NULLIF(LTRIM(RTRIM(ISNULL(s.card_number,N''))),N'') IS NOT NULL)
          AND (@keyword=N''
            OR s.name LIKE N'%' + @keyword + N'%' ESCAPE N'~'
            OR s.new_code LIKE N'%' + @keyword + N'%' ESCAPE N'~'
            OR s.code LIKE N'%' + @keyword + N'%' ESCAPE N'~'
            OR s.new_card_number LIKE N'%' + @keyword + N'%' ESCAPE N'~'
            OR s.card_number LIKE N'%' + @keyword + N'%' ESCAPE N'~')
      ), NumberedRows AS (
        SELECT ROW_NUMBER() OVER (ORDER BY employee_name ASC,id DESC) AS row_no,
          COUNT(1) OVER () AS total_count,
          id,employee_code,employee_name,new_card_number,card_number,department,employee_meal_type
        FROM StaffBase
      )
      SELECT row_no,total_count,id,employee_code,employee_name,new_card_number,card_number,department,employee_meal_type
      FROM NumberedRows
      WHERE row_no BETWEEN @rowStart AND @rowEnd
      ORDER BY row_no
    `)
    const recordset = result.recordset || []
    const list = recordset.map((row) => ({
      id: Number(row.id),
      employeeCode: text(row.employee_code),
      employeeName: text(row.employee_name),
      newCardNumber: text(row.new_card_number),
      oldCardNumber: text(row.card_number),
      cardNumber: text(row.new_card_number) || text(row.card_number),
      department: text(row.department),
      employeeMealType: text(row.employee_meal_type),
    }))
    return { list, total: Number(recordset[0]?.total_count || 0), page, pageSize }
  }

  async function listOneClickSupplementPreview(input = {}) {
    const staffId = Number(input.staffId)
    if (!Number.isInteger(staffId) || staffId <= 0) throw new DiningRecordsError(400, '请选择员工')
    const monthRange = normalizeOneClickMonth(input.month)
    const current = shanghaiNowParts(now())
    const db = await poolProvider()
    const staffRequest = db.request().input('staffId', sql.Int, staffId)
    const staffResult = await staffRequest.query(`
      SELECT TOP 1 id,code,new_code,name,in_bm,card_number,new_card_number,meal_type
      FROM ${tables.staff}
      WHERE id=@staffId AND del=N'0' AND pass=N'1'
    `)
    const employee = staffResult.recordset?.[0]
    if (!employee) throw new DiningRecordsError(404, '员工已失效或未审核')
    const configResult = await db.request().query(`
      SELECT TOP 1 two2,three2 FROM ${tables.config} WHERE code=N'UB_ERP_Dining' AND del=N'0' AND pass=N'1' ORDER BY id ASC
    `)
    const config = configResult.recordset?.[0] || {}
    const mealEnds = { '2': normalizeMealEndTime(config.two2), '3': normalizeMealEndTime(config.three2) }
    if (!mealEnds['2'] || !mealEnds['3']) throw new DiningRecordsError(500, '饭堂午晚餐结束时间配置无效')
    const request = db.request()
    request.input('staffId', sql.Int, staffId)
    bindText(request, 'startDate', monthRange.startDate, 10)
    bindText(request, 'endDate', monthRange.endDate, 10)
    const result = await request.query(`
      SELECT DISTINCT LTRIM(RTRIM(m.dis_dtime)) AS meal_date,LTRIM(RTRIM(m.dis_lx)) AS meal_type
      FROM ${tables.meals} m
      WHERE LTRIM(RTRIM(ISNULL(m.uid,N'')))=CONVERT(nvarchar(50),@staffId)
        AND LTRIM(RTRIM(ISNULL(m.dis_dtime,N'')))>=@startDate AND LTRIM(RTRIM(ISNULL(m.dis_dtime,N'')))<=@endDate
        AND LTRIM(RTRIM(ISNULL(m.dis_lx,N''))) IN (N'2',N'3') AND m.del=N'0' AND m.pass=N'1'
        AND NOT EXISTS (SELECT 1 FROM ${tables.mealLogs} l WHERE LTRIM(RTRIM(ISNULL(l.uid,N'')))=CONVERT(nvarchar(50),@staffId) AND l.dtime=m.dis_dtime AND l.meal_type=m.dis_lx AND l.del=N'0')
        AND NOT EXISTS (SELECT 1 FROM ${tables.mealLogs} p WHERE LTRIM(RTRIM(ISNULL(p.uid,N'')))=CONVERT(nvarchar(50),@staffId) AND p.dtime=m.dis_dtime AND p.meal_type=m.dis_lx AND p.bl=N'1' AND p.del=N'1')
      ORDER BY meal_date,meal_type
    `)
    const rows = (result.recordset || []).filter((row) => current.text > `${text(row.meal_date)} ${mealEnds[text(row.meal_type)]}`).map((row, index) => ({
      sequence: index + 1,
      date: text(row.meal_date),
      weekday: weekdayOf(text(row.meal_date)),
      mealType: text(row.meal_type),
      mealTypeName: text(row.meal_type) === '2' ? '午餐' : '晚餐',
      status: 'missed',
      statusName: '漏卡',
    }))
    return {
      month: monthRange.month,
      employee: {
        id: Number(employee.id), employeeCode: text(employee.new_code) || text(employee.code), employeeName: text(employee.name),
        department: text(employee.in_bm), cardNumber: text(employee.new_card_number) || text(employee.card_number),
      },
      rows,
    }
  }

  async function createOneClickSupplement(input = {}, actor = {}) {
    // 预览不是写入依据：确认提交时仍需重新读取，避免预览后刚好完成刷卡而重复补录。
    const preview = await listOneClickSupplementPreview(input)
    const current = shanghaiNowParts(now())
    const operatorName = text(actor.utruename)
    if (!operatorName) throw new DiningRecordsError(409, '当前登录账号未设置真实姓名，不能新增补录')
    if (!preview.rows.length) return { batchCode: '', insertedCount: 0, skippedCount: 0, skipped: [] }
    const pool = await poolProvider()
    const transaction = transactionFactory(pool)
    const batchCode = createSupplementBatchCode(current.text)
    const remark = `${preview.employee.employeeName}${preview.month.replace('-', '年')}月漏卡一键补录`
    const skipped = []
    let started = false
    try {
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
      started = true
      for (const item of preview.rows) {
        const lockRequest = transaction.request()
        bindText(lockRequest, 'lockResource', `DiningSwipe:${preview.employee.id}:${item.date}:${item.mealType}`, 255)
        const lockResult = await lockRequest.query(`DECLARE @r int; EXEC @r=sp_getapplock @Resource=@lockResource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=5000; SELECT @r AS lock_result;`)
        if (Number(lockResult.recordset?.[0]?.lock_result ?? -1) < 0) throw new DiningRecordsError(409, '员工的刷卡正在处理中，请稍后重试')
        const save = transaction.request()
        save.input('staffId', sql.Int, preview.employee.id)
        bindText(save, 'date', item.date, 10); bindText(save, 'mealType', item.mealType, 10)
        bindText(save, 'openedAt', current.text, 50); bindText(save, 'operatorName', operatorName, 50)
        bindText(save, 'remark', remark, 500); bindText(save, 'ip', actor.ip, 50); bindText(save, 'batchCode', batchCode, 50)
        const saved = await save.query(`
          INSERT INTO ${tables.mealLogs} (uid,employee_id,employee_name,meal_type,edible_time,card_id,new_card_id,addtime,ip,dtime,bc_info,del,dis_meal_type,bl,blsystemcode,bltime,bluser,bl_info)
          SELECT CONVERT(nvarchar(50),s.id),s.code,s.name,@mealType,CONVERT(datetime,@date+N' 00:00:00',120),s.card_number,s.new_card_number,@openedAt,@ip,@date,N'消费成功',N'1',s.meal_type,N'1',@batchCode,@openedAt,@operatorName,@remark
          FROM ${tables.staff} s
          WHERE s.id=@staffId AND s.del=N'0' AND s.pass=N'1'
            AND EXISTS (SELECT 1 FROM ${tables.meals} m WHERE LTRIM(RTRIM(ISNULL(m.uid,N'')))=CONVERT(nvarchar(50),@staffId) AND m.dis_dtime=@date AND m.dis_lx=@mealType AND m.del=N'0' AND m.pass=N'1')
            AND NOT EXISTS (SELECT 1 FROM ${tables.mealLogs} l WHERE LTRIM(RTRIM(ISNULL(l.uid,N'')))=CONVERT(nvarchar(50),@staffId) AND l.dtime=@date AND l.meal_type=@mealType AND (l.del=N'0' OR (l.bl=N'1' AND l.del=N'1')));
          SELECT @@ROWCOUNT AS inserted_count;
        `)
        if (!Number(saved.recordset?.[0]?.inserted_count || 0)) skipped.push({ date: item.date, mealType: item.mealType, reason: '已刷卡、已有待审核补录或报餐状态已变化' })
      }
      await transaction.commit(); started = false
      const insertedCount = preview.rows.length - skipped.length
      return { batchCode: insertedCount ? batchCode : '', insertedCount, skippedCount: skipped.length, skipped }
    } catch (error) {
      if (started) try { await transaction.rollback() } catch { /* 保留原始错误 */ }
      throw error
    }
  }

  async function listSupplementReviews(input = {}) {
    const { keyword, page, pageSize } = normalizeSupplementReviewQuery(input)
    const rowStart = (page - 1) * pageSize + 1
    const rowEnd = page * pageSize
    const db = await poolProvider()
    const request = db.request()
    bindText(request, 'keyword', escapeLikeKeyword(keyword), 200)
    request.input('rowStart', sql.Int, rowStart)
    request.input('rowEnd', sql.Int, rowEnd)
    const result = await request.query(`
      WITH LogicalBatches AS (
        SELECT
          MAX(id) AS anchor_id,
          LTRIM(RTRIM(ISNULL(blsystemcode,N''))) AS batch_code,
          LTRIM(RTRIM(ISNULL(dtime,N''))) AS supplement_date,
          LTRIM(RTRIM(ISNULL(meal_type,N''))) AS meal_type,
          LTRIM(RTRIM(ISNULL(bluser,N''))) AS operator_name,
          LTRIM(RTRIM(ISNULL(addtime,N''))) AS added_at,
          COUNT(1) AS people_count,
          MIN(CASE WHEN LTRIM(RTRIM(ISNULL(del,N'0')))=N'0' THEN 0 ELSE 1 END) AS min_del,
          MAX(CASE WHEN LTRIM(RTRIM(ISNULL(del,N'0')))=N'0' THEN 0 ELSE 1 END) AS max_del
        FROM ${tables.mealLogs}
        WHERE LTRIM(RTRIM(ISNULL(bl,N'0')))=N'1'
          AND NULLIF(LTRIM(RTRIM(ISNULL(blsystemcode,N''))),N'') IS NOT NULL
        GROUP BY LTRIM(RTRIM(ISNULL(blsystemcode,N''))),
          LTRIM(RTRIM(ISNULL(dtime,N''))),
          LTRIM(RTRIM(ISNULL(meal_type,N''))),
          LTRIM(RTRIM(ISNULL(bluser,N''))),
          LTRIM(RTRIM(ISNULL(addtime,N'')))
        HAVING @keyword=N'' OR MAX(CASE WHEN
          LTRIM(RTRIM(ISNULL(dtime,N''))) LIKE N'%' + @keyword + N'%' ESCAPE N'~'
          OR LTRIM(RTRIM(ISNULL(addtime,N''))) LIKE N'%' + @keyword + N'%' ESCAPE N'~'
          OR LTRIM(RTRIM(ISNULL(blsystemcode,N''))) LIKE N'%' + @keyword + N'%' ESCAPE N'~'
          OR LTRIM(RTRIM(ISNULL(bluser,N''))) LIKE N'%' + @keyword + N'%' ESCAPE N'~'
          OR CASE LTRIM(RTRIM(ISNULL(meal_type,N''))) WHEN N'2' THEN N'午餐' WHEN N'3' THEN N'晚餐' ELSE N'' END LIKE N'%' + @keyword + N'%' ESCAPE N'~'
          OR employee_name LIKE N'%' + @keyword + N'%' ESCAPE N'~'
          OR new_card_id LIKE N'%' + @keyword + N'%' ESCAPE N'~'
          OR card_id LIKE N'%' + @keyword + N'%' ESCAPE N'~'
          THEN 1 ELSE 0 END)=1
      ), NumberedRows AS (
        SELECT ROW_NUMBER() OVER (ORDER BY anchor_id DESC) AS row_no,
          COUNT(1) OVER () AS total_count,
          anchor_id,batch_code,supplement_date,meal_type,operator_name,added_at,people_count,min_del,max_del
        FROM LogicalBatches
      )
      SELECT row_no,total_count,anchor_id,batch_code,supplement_date,meal_type,operator_name,added_at,people_count,min_del,max_del
      FROM NumberedRows
      WHERE row_no BETWEEN @rowStart AND @rowEnd
      ORDER BY row_no
    `)
    const recordset = result.recordset || []
    const rows = recordset.map((row) => {
      const minDel = Number(row.min_del)
      const maxDel = Number(row.max_del)
      const status = minDel !== maxDel ? 'abnormal' : minDel === 1 ? 'pending' : 'approved'
      const mealType = text(row.meal_type)
      return {
        anchorId: Number(row.anchor_id),
        batchCode: text(row.batch_code),
        date: text(row.supplement_date).slice(0, 10),
        mealType,
        mealTypeName: mealType === '2' ? '午餐' : mealType === '3' ? '晚餐' : '未知餐别',
        operatorName: text(row.operator_name),
        addedAt: text(row.added_at),
        peopleCount: Number(row.people_count || 0),
        status,
      }
    })
    const total = Number(recordset[0]?.total_count || 0)
    return { rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } }
  }

  async function getSupplementReviewDetails(anchorIdRaw) {
    const anchorId = validateSupplementAnchorId(anchorIdRaw)
    const db = await poolProvider()
    const request = db.request().input('anchorId', sql.Int, anchorId)
    const result = await request.query(`
      WITH Anchor AS (
        SELECT TOP 1
          LTRIM(RTRIM(ISNULL(blsystemcode,N''))) AS batch_code,
          LTRIM(RTRIM(ISNULL(dtime,N''))) AS supplement_date,
          LTRIM(RTRIM(ISNULL(meal_type,N''))) AS meal_type,
          LTRIM(RTRIM(ISNULL(bluser,N''))) AS operator_name,
          LTRIM(RTRIM(ISNULL(addtime,N''))) AS added_at
        FROM ${tables.mealLogs}
        WHERE id=@anchorId
          AND LTRIM(RTRIM(ISNULL(bl,N'0')))=N'1'
          AND NULLIF(LTRIM(RTRIM(ISNULL(blsystemcode,N''))),N'') IS NOT NULL
      )
      SELECT l.id,l.employee_name,l.new_card_id,l.card_id
      FROM ${tables.mealLogs} l
      CROSS JOIN Anchor a
      WHERE LTRIM(RTRIM(ISNULL(l.bl,N'0')))=N'1'
        AND LTRIM(RTRIM(ISNULL(l.blsystemcode,N'')))=a.batch_code
        AND LTRIM(RTRIM(ISNULL(l.dtime,N'')))=a.supplement_date
        AND LTRIM(RTRIM(ISNULL(l.meal_type,N'')))=a.meal_type
        AND LTRIM(RTRIM(ISNULL(l.bluser,N'')))=a.operator_name
        AND LTRIM(RTRIM(ISNULL(l.addtime,N'')))=a.added_at
      ORDER BY l.id
    `)
    const recordset = result.recordset || []
    if (!recordset.length) throw new DiningRecordsError(404, '补录批次不存在')
    return {
      rows: recordset.map((row) => ({
        id: Number(row.id),
        employeeName: text(row.employee_name),
        cardNumber: text(row.new_card_id) || text(row.card_id),
      })),
    }
  }

  async function updateSupplementReviewState(anchorIdRaw, targetState) {
    const anchorId = validateSupplementAnchorId(anchorIdRaw)
    const audit = targetState === '0'
    const pool = await poolProvider()
    const transaction = transactionFactory(pool)
    let started = false
    try {
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
      started = true

      // 代表行只负责定位；真正更新条件全部从数据库重新读取，且按逻辑批次锁定。
      const batchResult = await transaction.request().input('anchorId', sql.Int, anchorId).query(`
        WITH Anchor AS (
          SELECT TOP 1
            LTRIM(RTRIM(ISNULL(blsystemcode,N''))) AS batch_code,
            LTRIM(RTRIM(ISNULL(dtime,N''))) AS supplement_date,
            LTRIM(RTRIM(ISNULL(meal_type,N''))) AS meal_type,
            LTRIM(RTRIM(ISNULL(bluser,N''))) AS operator_name,
            LTRIM(RTRIM(ISNULL(addtime,N''))) AS added_at
          FROM ${tables.mealLogs} WITH (UPDLOCK,HOLDLOCK)
          WHERE id=@anchorId
            AND LTRIM(RTRIM(ISNULL(bl,N'0')))=N'1'
            AND NULLIF(LTRIM(RTRIM(ISNULL(blsystemcode,N''))),N'') IS NOT NULL
        )
        SELECT l.id,l.uid,l.employee_name,
          CASE WHEN LTRIM(RTRIM(ISNULL(l.del,N'0')))=N'0' THEN N'0' ELSE N'1' END AS del,
          a.batch_code,a.supplement_date,a.meal_type,a.operator_name,a.added_at
        FROM ${tables.mealLogs} l WITH (UPDLOCK,HOLDLOCK)
        CROSS JOIN Anchor a
        WHERE LTRIM(RTRIM(ISNULL(l.bl,N'0')))=N'1'
          AND LTRIM(RTRIM(ISNULL(l.blsystemcode,N'')))=a.batch_code
          AND LTRIM(RTRIM(ISNULL(l.dtime,N'')))=a.supplement_date
          AND LTRIM(RTRIM(ISNULL(l.meal_type,N'')))=a.meal_type
          AND LTRIM(RTRIM(ISNULL(l.bluser,N'')))=a.operator_name
          AND LTRIM(RTRIM(ISNULL(l.addtime,N'')))=a.added_at
        ORDER BY l.id
      `)
      const batchRows = batchResult.recordset || []
      if (!batchRows.length) throw new DiningRecordsError(404, '补录批次不存在')
      const states = new Set(batchRows.map((row) => text(row.del) === '0' ? '0' : '1'))
      if (states.size !== 1) throw new DiningRecordsError(409, '补录批次状态异常，不能审核或反审')
      const currentState = [...states][0]
      if (currentState === targetState) throw new DiningRecordsError(409, audit ? '该补录批次已经审核' : '该补录批次已经是待审核状态')

      const batch = {
        batchCode: text(batchRows[0].batch_code),
        date: text(batchRows[0].supplement_date).slice(0, 10),
        mealType: text(batchRows[0].meal_type),
        operatorName: text(batchRows[0].operator_name),
        addedAt: text(batchRows[0].added_at),
      }
      const uids = [...new Set(batchRows.map((row) => text(row.uid)))].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
      const lockRequest = transaction.request()
      const lockValues = uids.map((uid, index) => {
        const name = `lockUid${index}`
        bindText(lockRequest, name, uid, 50)
        return `(@${name})`
      }).join(',')
      bindText(lockRequest, 'lockDate', batch.date, 10)
      bindText(lockRequest, 'lockMealType', batch.mealType, 10)
      const lockResult = await lockRequest.query(`
        DECLARE @Members TABLE (uid nvarchar(50) NOT NULL PRIMARY KEY);
        INSERT INTO @Members(uid) VALUES ${lockValues};
        DECLARE @uid nvarchar(50),@lockResult int,@lockResource nvarchar(255);
        DECLARE member_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT uid FROM @Members ORDER BY uid;
        OPEN member_cursor;
        FETCH NEXT FROM member_cursor INTO @uid;
        WHILE @@FETCH_STATUS=0
        BEGIN
          SET @lockResource=N'DiningSwipe:' + @uid + N':' + @lockDate + N':' + @lockMealType;
          EXEC @lockResult=sp_getapplock @Resource=@lockResource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=5000;
          IF @lockResult<0
          BEGIN
            CLOSE member_cursor;
            DEALLOCATE member_cursor;
            RAISERROR(N'部分员工的刷卡正在处理中，请稍后重试',16,1);
          END
          FETCH NEXT FROM member_cursor INTO @uid;
        END
        CLOSE member_cursor;
        DEALLOCATE member_cursor;
        SELECT 1 AS locked;
      `)
      if (!lockResult.recordset?.length) throw new DiningRecordsError(409, '人员餐次锁定失败，请稍后重试')

      if (audit) {
        const conflictRequest = transaction.request()
        bindText(conflictRequest, 'batchCode', batch.batchCode, 50)
        bindText(conflictRequest, 'date', batch.date, 10)
        bindText(conflictRequest, 'mealType', batch.mealType, 50)
        bindText(conflictRequest, 'operatorName', batch.operatorName, 50)
        bindText(conflictRequest, 'addedAt', batch.addedAt, 50)
        const conflictResult = await conflictRequest.query(`
          SELECT DISTINCT pending.uid,pending.employee_name
          FROM ${tables.mealLogs} pending
          INNER JOIN ${tables.mealLogs} existing
            ON existing.uid=pending.uid
            AND existing.dtime=pending.dtime
            AND existing.meal_type=pending.meal_type
            AND existing.del=N'0'
          WHERE pending.bl=N'1'
            AND LTRIM(RTRIM(ISNULL(pending.blsystemcode,N'')))=@batchCode
            AND LTRIM(RTRIM(ISNULL(pending.dtime,N'')))=@date
            AND LTRIM(RTRIM(ISNULL(pending.meal_type,N'')))=@mealType
            AND LTRIM(RTRIM(ISNULL(pending.bluser,N'')))=@operatorName
            AND LTRIM(RTRIM(ISNULL(pending.addtime,N'')))=@addedAt
            AND existing.id<>pending.id
        `)
        const conflictRows = conflictResult.recordset || []
        if (conflictRows.length) {
          const error = new DiningRecordsError(409, '批次内存在已经正式刷卡的员工，整批未审核')
          error.conflicts = conflictRows.map((row) => ({ uid: text(row.uid), employeeName: text(row.employee_name) }))
          throw error
        }
      }

      const updateRequest = transaction.request()
      bindText(updateRequest, 'batchCode', batch.batchCode, 50)
      bindText(updateRequest, 'date', batch.date, 10)
      bindText(updateRequest, 'mealType', batch.mealType, 50)
      bindText(updateRequest, 'operatorName', batch.operatorName, 50)
      bindText(updateRequest, 'addedAt', batch.addedAt, 50)
      bindText(updateRequest, 'currentState', currentState, 50)
      bindText(updateRequest, 'targetState', targetState, 50)
      const updateResult = await updateRequest.query(`
        UPDATE ${tables.mealLogs}
        SET del=@targetState
        WHERE bl=N'1'
          AND LTRIM(RTRIM(ISNULL(blsystemcode,N'')))=@batchCode
          AND LTRIM(RTRIM(ISNULL(dtime,N'')))=@date
          AND LTRIM(RTRIM(ISNULL(meal_type,N'')))=@mealType
          AND LTRIM(RTRIM(ISNULL(bluser,N'')))=@operatorName
          AND LTRIM(RTRIM(ISNULL(addtime,N'')))=@addedAt
          AND CASE WHEN LTRIM(RTRIM(ISNULL(del,N'0')))=N'0' THEN N'0' ELSE N'1' END=@currentState
      `)
      const affected = Number(updateResult.rowsAffected?.[0] || 0)
      if (affected !== batchRows.length) throw new DiningRecordsError(409, '补录批次状态已变化，请刷新后重试')
      await transaction.commit()
      return {
        ...batch,
        mealTypeName: batch.mealType === '2' ? '午餐' : batch.mealType === '3' ? '晚餐' : '未知餐别',
        peopleCount: batchRows.length,
        status: audit ? 'approved' : 'pending',
      }
    } catch (error) {
      if (started) {
        try { await transaction.rollback() } catch { /* 保留原始业务错误 */ }
      }
      throw error
    }
  }

  const auditSupplementReview = (anchorId) => updateSupplementReviewState(anchorId, '0')
  const unauditSupplementReview = (anchorId) => updateSupplementReviewState(anchorId, '1')

  async function createSupplement(input = {}, actor = {}) {
    const current = shanghaiNowParts(now())
    const payload = validateDiningSupplementPayload(input, current.date)
    if (payload.openedAt > current.text) throw new DiningRecordsError(400, '添加时间不能晚于服务器当前时间')
    const operatorName = text(actor.utruename)
    if (!operatorName) throw new DiningRecordsError(409, '当前登录账号未设置真实姓名，不能新增补录')
    const batchCode = createSupplementBatchCode(current.text)
    const pool = await poolProvider()
    const transaction = transactionFactory(pool)
    let started = false
    try {
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
      started = true

      // 一次请求按员工ID升序取得餐次锁，避免逐人往返数据库，也避免与刷卡终端并发写入。
      const lockRequest = transaction.request()
      const lockValues = bindStaffIds(lockRequest, payload.staffIds)
      bindText(lockRequest, 'date', payload.date, 10)
      bindText(lockRequest, 'mealType', payload.mealType, 10)
      const lockResult = await lockRequest.query(`
        DECLARE @Selected TABLE (id int NOT NULL PRIMARY KEY);
        INSERT INTO @Selected(id) VALUES ${lockValues};
        DECLARE @staffId int,@lockResult int,@lockResource nvarchar(255);
        DECLARE staff_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT id FROM @Selected ORDER BY id;
        OPEN staff_cursor;
        FETCH NEXT FROM staff_cursor INTO @staffId;
        WHILE @@FETCH_STATUS=0
        BEGIN
          SET @lockResource=N'DiningSwipe:' + CONVERT(nvarchar(20),@staffId) + N':' + @date + N':' + @mealType;
          EXEC @lockResult=sp_getapplock @Resource=@lockResource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=5000;
          IF @lockResult<0
          BEGIN
            CLOSE staff_cursor;
            DEALLOCATE staff_cursor;
            RAISERROR(N'部分员工的刷卡正在处理中，请稍后重试',16,1);
          END
          FETCH NEXT FROM staff_cursor INTO @staffId;
        END
        CLOSE staff_cursor;
        DEALLOCATE staff_cursor;
        SELECT 1 AS locked;
      `)
      if (!lockResult.recordset?.length) throw new DiningRecordsError(409, '人员餐次锁定失败，请稍后重试')

      const saveRequest = transaction.request()
      const selectedValues = bindStaffIds(saveRequest, payload.staffIds)
      bindText(saveRequest, 'date', payload.date, 10)
      bindText(saveRequest, 'mealType', payload.mealType, 10)
      bindText(saveRequest, 'openedAt', payload.openedAt, 50)
      bindText(saveRequest, 'savedAt', current.text, 50)
      bindText(saveRequest, 'operatorName', operatorName, 50)
      bindText(saveRequest, 'remark', payload.remark, 500)
      bindText(saveRequest, 'ip', actor.ip, 50)
      bindText(saveRequest, 'batchCode', batchCode, 50)
      const saveResult = await saveRequest.query(`
        DECLARE @Selected TABLE (id int NOT NULL PRIMARY KEY);
        INSERT INTO @Selected(id) VALUES ${selectedValues};
        DECLARE @Existing TABLE (id int NOT NULL PRIMARY KEY,reason nvarchar(50));
        INSERT INTO @Existing(id,reason)
        SELECT x.id,
          CASE WHEN MAX(CASE WHEN l.del=N'0' THEN 1 ELSE 0 END)=1 THEN N'已存在有效刷卡'
               ELSE N'已有待审核补录' END
        FROM ${tables.mealLogs} l
        INNER JOIN @Selected x ON l.uid=CONVERT(nvarchar(50),x.id)
        WHERE l.dtime=@date AND l.meal_type=@mealType
          AND (l.del=N'0' OR (l.bl=N'1' AND l.del=N'1'))
        GROUP BY x.id;

        DECLARE @Inserted TABLE (id int NOT NULL PRIMARY KEY,employee_name nvarchar(50));
        INSERT INTO ${tables.mealLogs}
          (uid,employee_id,employee_name,meal_type,edible_time,card_id,new_card_id,addtime,ip,dtime,
           bc_info,del,dis_meal_type,bl,blsystemcode,bltime,bluser,bl_info)
        OUTPUT CONVERT(int,inserted.uid),inserted.employee_name INTO @Inserted(id,employee_name)
        SELECT CONVERT(nvarchar(50),s.id),s.code,s.name,@mealType,CONVERT(datetime,@date + N' 00:00:00',120),
          s.card_number,s.new_card_number,@openedAt,@ip,@date,N'消费成功',N'1',s.meal_type,N'1',
          @batchCode,@savedAt,@operatorName,@remark
        FROM ${tables.staff} s
        INNER JOIN @Selected x ON x.id=s.id
        LEFT JOIN @Existing e ON e.id=s.id
        WHERE s.del=N'0' AND s.pass=N'1' AND e.id IS NULL
          AND (NULLIF(LTRIM(RTRIM(ISNULL(s.new_card_number,N''))),N'') IS NOT NULL
            OR NULLIF(LTRIM(RTRIM(ISNULL(s.card_number,N''))),N'') IS NOT NULL);

        SELECT id,employee_name FROM @Inserted ORDER BY id;
        SELECT x.id,
          CASE WHEN s.id IS NULL OR s.del<>N'0' OR s.pass<>N'1' THEN N'员工已失效或未审核'
               WHEN NULLIF(LTRIM(RTRIM(ISNULL(s.new_card_number,N''))),N'') IS NULL
                AND NULLIF(LTRIM(RTRIM(ISNULL(s.card_number,N''))),N'') IS NULL THEN N'员工未绑定卡号'
               ELSE ISNULL(e.reason,N'未能保存') END AS reason,
          ISNULL(s.name,N'员工ID ' + CONVERT(nvarchar(20),x.id)) AS employee_name
        FROM @Selected x
        LEFT JOIN ${tables.staff} s ON s.id=x.id
        LEFT JOIN @Existing e ON e.id=x.id
        LEFT JOIN @Inserted i ON i.id=x.id
        WHERE i.id IS NULL
        ORDER BY x.id;
      `)
      const insertedRows = saveResult.recordsets?.[0] || []
      const skippedRows = saveResult.recordsets?.[1] || []
      await transaction.commit()
      started = false
      return {
        batchCode: insertedRows.length ? batchCode : '',
        insertedCount: insertedRows.length,
        skippedCount: skippedRows.length,
        skipped: skippedRows.map((row) => ({ id: Number(row.id), employeeName: text(row.employee_name), reason: text(row.reason) })),
      }
    } catch (error) {
      if (started) {
        try { await transaction.rollback() } catch { /* 保留原始错误，由连接池清理事务连接。 */ }
      }
      if (/部分员工的刷卡正在处理中/.test(text(error?.message))) {
        throw new DiningRecordsError(409, '部分员工的刷卡正在处理中，请稍后重试')
      }
      throw error
    }
  }

  async function cancelPeopleMeal(input = {}) {
    const key = validateDiningPeopleCancelKey(input)
    const current = shanghaiNowParts(now())
    if (key.date < current.date) throw new DiningRecordsError(409, '历史日期不能取消报餐')
    const pool = await poolProvider()
    const transaction = transactionFactory(pool)
    let started = false
    try {
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
      started = true
      const lockRequest = transaction.request()
      bindText(lockRequest, 'lockResource', `DiningSwipe:${key.uid}:${key.date}:${key.mealType}`, 255)
      const lockResult = await lockRequest.query(`
        DECLARE @lockResult int;
        EXEC @lockResult = sp_getapplock
          @Resource = @lockResource,
          @LockMode = N'Exclusive',
          @LockOwner = N'Transaction',
          @LockTimeout = 5000;
        SELECT @lockResult AS lock_result;
      `)
      if (Number(lockResult.recordset?.[0]?.lock_result ?? -999) < 0) {
        throw new DiningRecordsError(409, '该员工的刷卡或取消正在处理中，请稍后重试')
      }

      const swipeRequest = transaction.request()
      bindText(swipeRequest, 'employeeId', key.uid, 50)
      bindText(swipeRequest, 'date', key.date, 10)
      bindText(swipeRequest, 'mealType', key.mealType, 10)
      const swipeResult = await swipeRequest.query(`
        SELECT TOP (1) id
        FROM ${tables.mealLogs}
        WHERE LTRIM(RTRIM(ISNULL(uid, N''))) = @employeeId
          AND LTRIM(RTRIM(ISNULL(dtime, N''))) = @date
          AND LTRIM(RTRIM(ISNULL(meal_type, N''))) = @mealType
          AND LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
        ORDER BY id ASC
      `)
      if (swipeResult.recordset?.length) throw new DiningRecordsError(409, '该员工已经刷卡，不能取消报餐')

      const updateRequest = transaction.request()
      bindText(updateRequest, 'employeeId', key.uid, 50)
      bindText(updateRequest, 'date', key.date, 10)
      bindText(updateRequest, 'mealType', key.mealType, 10)
      bindText(updateRequest, 'nowText', current.text, 50)
      const updateResult = await updateRequest.query(`
        UPDATE ${tables.meals}
        SET del = N'1', edittime = @nowText
        WHERE LTRIM(RTRIM(ISNULL(uid, N''))) = @employeeId
          AND LTRIM(RTRIM(ISNULL(dis_dtime, N''))) = @date
          AND LTRIM(RTRIM(ISNULL(dis_lx, N''))) = @mealType
          AND LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(pass, N'0'))) = N'1'
      `)
      const affected = Number(updateResult.rowsAffected?.[0] || 0)
      if (!affected) throw new DiningRecordsError(409, '报餐记录已取消或不存在，请刷新后重试')
      await transaction.commit()
      started = false
      return { affected }
    } catch (error) {
      if (started) {
        try { await transaction.rollback() } catch { /* 保留原始错误，由连接池清理事务连接。 */ }
      }
      throw error
    }
  }

  return {
    list, listPeople, listConsumptions, getSupplementInit, listSupplementStaff, listOneClickSupplementPreview, createOneClickSupplement, listSupplementReviews, getSupplementReviewDetails,
    auditSupplementReview, unauditSupplementReview, createSupplement, cancelPeopleMeal,
  }
}

export function registerDiningRecordsRoutes(app, options = {}) {
  const service = options.service || createDiningRecordsService(options)
  const poolProvider = options.getPool || getPool
  const actorResolver = options.resolveActor || resolveActorAuditTripletFromReq
  app.get('/api/canteen/records', async (_req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.list() })
    } catch (error) {
      console.error('读取饭堂报餐管理汇总失败：', error)
      res.status(500).json({ code: 500, msg: '读取饭堂报餐管理汇总失败', data: null })
    }
  })
  app.get('/api/canteen/records/people', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.listPeople(req.query) })
    } catch (error) {
      console.error('查询报餐人记录失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '查询报餐人记录失败' : error.message, data: null })
    }
  })
  app.get('/api/canteen/records/consumptions', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.listConsumptions(req.query) })
    } catch (error) {
      console.error('查询打卡消费记录失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '查询打卡消费记录失败' : error.message, data: null })
    }
  })
  app.get('/api/canteen/records/supplements/reviews', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.listSupplementReviews(req.query) })
    } catch (error) {
      console.error('查询补录审核列表失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '查询补录审核列表失败' : error.message, data: null })
    }
  })
  app.get('/api/canteen/records/supplements/reviews/:anchorId/details', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.getSupplementReviewDetails(req.params.anchorId) })
    } catch (error) {
      console.error('查询补录审核明细失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '查询补录审核明细失败' : error.message, data: null })
    }
  })
  app.get('/api/canteen/records/supplements/init', async (req, res) => {
    try {
      const actor = await actorResolver(await poolProvider(), req)
      res.json({ code: 200, msg: 'success', data: service.getSupplementInit(actor) })
    } catch (error) {
      console.error('初始化打卡消费补录失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '初始化打卡消费补录失败' : error.message, data: null })
    }
  })
  app.get('/api/canteen/records/supplements/staff', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.listSupplementStaff(req.query) })
    } catch (error) {
      console.error('查询补录员工失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '查询补录员工失败' : error.message, data: null })
    }
  })
  app.get('/api/canteen/records/supplements/one-click-preview', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.listOneClickSupplementPreview(req.query) })
    } catch (error) {
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '查询漏卡补录预览失败' : error.message, data: null })
    }
  })
  app.post('/api/canteen/records/supplements/one-click', async (req, res) => {
    try {
      const actor = await actorResolver(await poolProvider(), req)
      const result = await service.createOneClickSupplement(req.body, { ...actor, ip: getRequestIp(req) })
      req.body = { staffId: Number(req.body?.staffId), month: text(req.body?.month), batchCode: result.batchCode, insertedCount: result.insertedCount, skippedCount: result.skippedCount }
      res.json({ code: 200, msg: result.insertedCount ? '一键补录已保存，等待审核' : '没有可补录的漏卡记录', data: result })
    } catch (error) {
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '一键补录保存失败' : error.message, data: null })
    }
  })
  app.post('/api/canteen/records/supplements', async (req, res) => {
    try {
      const actor = await actorResolver(await poolProvider(), req)
      const result = await service.createSupplement(req.body, { ...actor, ip: getRequestIp(req) })
      // 中央操作日志只保留批次摘要，不记录整批员工ID。
      req.body = {
        batchCode: result.batchCode,
        date: text(req.body?.date),
        mealType: text(req.body?.mealType),
        insertedCount: result.insertedCount,
        skippedCount: result.skippedCount,
      }
      res.json({ code: 200, msg: result.insertedCount ? '补录已保存，等待审核' : '没有可保存的人员', data: result })
    } catch (error) {
      console.error('保存打卡消费补录失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '保存打卡消费补录失败' : error.message, data: null })
    }
  })
  app.put('/api/canteen/records/supplements/reviews/:anchorId/audit', async (req, res) => {
    try {
      const result = await service.auditSupplementReview(req.params.anchorId)
      req.body = { batchCode: result.batchCode, date: result.date, mealType: result.mealTypeName, peopleCount: result.peopleCount }
      res.json({ code: 200, msg: '补录审核成功', data: result })
    } catch (error) {
      console.error('审核打卡消费补录失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({
        code: status,
        msg: status === 500 ? '补录审核失败' : error.message,
        data: error?.conflicts ? { conflicts: error.conflicts } : null,
      })
    }
  })
  app.put('/api/canteen/records/supplements/reviews/:anchorId/unaudit', async (req, res) => {
    try {
      const result = await service.unauditSupplementReview(req.params.anchorId)
      req.body = { batchCode: result.batchCode, date: result.date, mealType: result.mealTypeName, peopleCount: result.peopleCount }
      res.json({ code: 200, msg: '补录反审成功', data: result })
    } catch (error) {
      console.error('反审核打卡消费补录失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '补录反审失败' : error.message, data: null })
    }
  })
  app.delete('/api/canteen/records/people/:uid/:date/:mealType', async (req, res) => {
    try {
      res.json({ code: 200, msg: '取消报餐成功', data: await service.cancelPeopleMeal(req.params) })
    } catch (error) {
      console.error('管理员取消报餐失败：', error)
      const status = Number(error?.status) || 500
      res.status(status).json({ code: status, msg: status === 500 ? '取消报餐失败' : error.message, data: null })
    }
  })
}
