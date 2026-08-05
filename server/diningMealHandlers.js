import crypto from 'node:crypto'
import { getPool, sql } from './db.js'
import { createDiningTableRefs } from './diningDatabase.js'
import { readDiningBearerToken } from './diningAuthHandlers.js'
import { getRequestIp } from './requestIp.js'
import { getDiningReportDateRule, getDiningReportDateRules } from './diningReportRules.js'

export const DINING_MEAL_TYPES = Object.freeze({
  lunch: { code: '2', label: '午餐', compatibilityContent: '午餐（统一餐）' },
  dinner: { code: '3', label: '晚餐', compatibilityContent: '晚餐（统一餐）' },
})

export const DINING_COMPATIBILITY_MARKER = '新报餐系统统一餐兼容项'
export const DINING_MEAL_SOURCE = '微信或电脑端报餐'

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

function getShanghaiParts(nowRaw) {
  const date = nowRaw instanceof Date ? nowRaw : new Date(nowRaw)
  if (Number.isNaN(date.getTime())) throw new Error('服务器时间无效')
  const values = Object.fromEntries(
    shanghaiFormatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:${values.second}`,
  }
}

export function addDiningDays(dateKey, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? ''))
  if (!match) return ''
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)))
  return `${value.getUTCFullYear()}-${twoDigits(value.getUTCMonth() + 1)}-${twoDigits(value.getUTCDate())}`
}

export function normalizeDiningCutoffTime(raw) {
  const text = String(raw ?? '').trim()
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (!match) throw new DiningMealError(500, '饭堂报餐截止时间配置无效，请联系管理员')
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? 0)
  if (hour > 23 || minute > 59 || second > 59) {
    throw new DiningMealError(500, '饭堂报餐截止时间配置无效，请联系管理员')
  }
  return `${twoDigits(hour)}:${twoDigits(minute)}:${twoDigits(second)}`
}

export function buildDiningDateWindow(nowRaw, cutoffRaw) {
  const current = getShanghaiParts(nowRaw)
  const cutoffTime = normalizeDiningCutoffTime(cutoffRaw)
  const start = addDiningDays(current.date, 1)
  const end = addDiningDays(current.date, 30)
  const nowText = `${current.date} ${current.time}`
  const dates = []
  for (let date = start; date && date <= end; date = addDiningDays(date, 1)) {
    const deadline = `${addDiningDays(date, -1)} ${cutoffTime}`
    dates.push({ date, canEdit: nowText < deadline, deadline })
  }
  return { start, end, cutoffTime, dates }
}

export class DiningMealError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'DiningMealError'
    this.status = status
  }
}

function newLegacyCode(prefix = '') {
  return `${prefix}${crypto.randomBytes(20).toString('hex').toUpperCase()}`.slice(0, 50)
}

function bindText(request, name, value, length = 100) {
  return request.input(name, sql.NVarChar(length), String(value ?? ''))
}

export function createDiningMealRepository(options = {}) {
  const poolProvider = options.getPool || getPool
  const tables = options.tables || createDiningTableRefs()
  const codeFactory = options.createCode || newLegacyCode
  const transactionFactory = options.transactionFactory || ((pool) => new sql.Transaction(pool))

  async function getCutoffTime() {
    const pool = await poolProvider()
    const result = await pool.request().query(`
      SELECT TOP (1) LTRIM(RTRIM(ISNULL(d.bc, N''))) AS cutoff_time
      FROM ${tables.config} AS d
      WHERE LTRIM(RTRIM(ISNULL(d.code, N''))) = N'UB_ERP_Dining'
        AND LTRIM(RTRIM(ISNULL(d.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(d.pass, N'0'))) = N'1'
        AND LTRIM(RTRIM(ISNULL(d.enable, N'0'))) = N'1'
      ORDER BY d.id ASC
    `)
    const value = String(result.recordset?.[0]?.cutoff_time ?? '').trim()
    if (!value) throw new DiningMealError(500, '未找到启用的饭堂报餐截止时间，请联系管理员')
    return value
  }

  async function listActiveMeals({ employeeId, start, end }) {
    const pool = await poolProvider()
    const request = pool.request()
    bindText(request, 'employeeId', employeeId, 50)
    bindText(request, 'start', start, 20)
    bindText(request, 'end', end, 20)
    const result = await request.query(`
      SELECT
        LTRIM(RTRIM(ISNULL(m.dis_dtime, N''))) AS meal_date,
        LTRIM(RTRIM(ISNULL(m.dis_lx, N''))) AS meal_type,
        COUNT(1) AS record_count
      FROM ${tables.meals} AS m
      WHERE LTRIM(RTRIM(ISNULL(m.uid, N''))) = @employeeId
        AND LTRIM(RTRIM(ISNULL(m.dis_dtime, N''))) >= @start
        AND LTRIM(RTRIM(ISNULL(m.dis_dtime, N''))) <= @end
        AND LTRIM(RTRIM(ISNULL(m.dis_lx, N''))) IN (N'2', N'3')
        AND LTRIM(RTRIM(ISNULL(m.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(m.pass, N'0'))) = N'1'
      GROUP BY LTRIM(RTRIM(ISNULL(m.dis_dtime, N''))), LTRIM(RTRIM(ISNULL(m.dis_lx, N'')))
    `)
    return result.recordset || []
  }

  async function findOrCreateCompatibilityItem(transaction, employee, date, meal) {
    const existingRequest = transaction.request()
    bindText(existingRequest, 'date', date, 20)
    bindText(existingRequest, 'mealType', meal.code, 10)
    bindText(existingRequest, 'marker', DINING_COMPATIBILITY_MARKER, 50)
    const existing = await existingRequest.query(`
      SELECT TOP (1)
        i.id,
        i.systemcode,
        i.dcode
      FROM ${tables.dishItems} AS i
      INNER JOIN ${tables.dishes} AS d ON d.systemcode = i.systemcode
      WHERE LTRIM(RTRIM(ISNULL(i.dtime, N''))) = @date
        AND LTRIM(RTRIM(ISNULL(i.lx, N''))) = @mealType
        AND LTRIM(RTRIM(ISNULL(i.info, N''))) = @marker
        AND LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.pass, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.enable, N'0'))) = N'1'
        AND LTRIM(RTRIM(ISNULL(d.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(d.pass, N'0'))) = N'1'
        AND LTRIM(RTRIM(ISNULL(d.enable, N'0'))) = N'1'
      ORDER BY i.id ASC
    `)

    let compatibilityItem = existing.recordset?.[0] ?? null
    if (!compatibilityItem) {
      const masterRequest = transaction.request()
      bindText(masterRequest, 'date', date, 20)
      const masterResult = await masterRequest.query(`
        SELECT TOP (1) d.systemcode
        FROM ${tables.dishes} AS d
        WHERE LTRIM(RTRIM(ISNULL(d.dtime, N''))) = @date
          AND LTRIM(RTRIM(ISNULL(d.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(d.pass, N'0'))) = N'1'
          AND LTRIM(RTRIM(ISNULL(d.enable, N'0'))) = N'1'
        ORDER BY d.id ASC
      `)

      let dishSystemcode = String(masterResult.recordset?.[0]?.systemcode ?? '').trim()
      if (!dishSystemcode) {
        dishSystemcode = codeFactory('Dishes-ND-')
        const createMasterRequest = transaction.request()
        bindText(createMasterRequest, 'employeeId', employee.id, 50)
        bindText(createMasterRequest, 'employeeName', employee.name, 50)
        bindText(createMasterRequest, 'systemcode', dishSystemcode, 50)
        bindText(createMasterRequest, 'date', date, 20)
        bindText(createMasterRequest, 'nowText', employee.nowText, 50)
        bindText(createMasterRequest, 'marker', DINING_COMPATIBILITY_MARKER, 50)
        await createMasterRequest.query(`
          INSERT INTO ${tables.dishes}
            (uid, uname, utruename, code, systemcode, addtime, del, pass, yesno, enable, info, dtime)
          VALUES
            (@employeeId, @employeeName, @employeeName, @systemcode, @systemcode, @nowText, N'0', N'1', N'0', N'1', @marker, @date)
        `)
      }

      const dcode = codeFactory(`Dining-${meal.code}-`)
      const createItemRequest = transaction.request()
      bindText(createItemRequest, 'employeeId', employee.id, 50)
      bindText(createItemRequest, 'employeeName', employee.name, 50)
      bindText(createItemRequest, 'systemcode', dishSystemcode, 50)
      bindText(createItemRequest, 'dcode', dcode, 50)
      bindText(createItemRequest, 'date', date, 20)
      bindText(createItemRequest, 'nowText', employee.nowText, 50)
      bindText(createItemRequest, 'marker', DINING_COMPATIBILITY_MARKER, 50)
      bindText(createItemRequest, 'mealType', meal.code, 10)
      bindText(createItemRequest, 'content', meal.compatibilityContent, 100)
      const created = await createItemRequest.query(`
        INSERT INTO ${tables.dishItems}
          (uid, uname, utruename, code, systemcode, dcode, dtime, addtime, del, pass, enable, info, lx, content, money)
        OUTPUT INSERTED.id, INSERTED.systemcode, INSERTED.dcode
        VALUES
          (@employeeId, @employeeName, @employeeName, @systemcode, @systemcode, @dcode, @date, @nowText, N'0', N'0', N'1', @marker, @mealType, @content, 0)
      `)
      compatibilityItem = created.recordset?.[0]
    }

    const firstItemRequest = transaction.request()
    bindText(firstItemRequest, 'systemcode', compatibilityItem.systemcode, 50)
    bindText(firstItemRequest, 'mealType', meal.code, 10)
    const firstItem = await firstItemRequest.query(`
      SELECT TOP (1) i.id
      FROM ${tables.dishItems} AS i
      WHERE LTRIM(RTRIM(ISNULL(i.systemcode, N''))) = @systemcode
        AND LTRIM(RTRIM(ISNULL(i.lx, N''))) = @mealType
        AND LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.pass, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.enable, N'0'))) = N'1'
      ORDER BY i.id ASC
    `)

    return {
      id: Number(compatibilityItem.id),
      baseId: Number(firstItem.recordset?.[0]?.id ?? compatibilityItem.id),
      systemcode: String(compatibilityItem.systemcode ?? ''),
      dcode: String(compatibilityItem.dcode ?? ''),
    }
  }

  async function setMeal({ employee, date, meal, selected, nowText, ip, transaction: sharedTransaction = null }) {
    const pool = sharedTransaction ? null : await poolProvider()
    const transaction = sharedTransaction || transactionFactory(pool)
    let started = false
    try {
      if (!sharedTransaction) {
        await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
        started = true
      }

      if (!selected) {
        const cancelRequest = transaction.request()
        bindText(cancelRequest, 'employeeId', employee.id, 50)
        bindText(cancelRequest, 'date', date, 20)
        bindText(cancelRequest, 'mealType', meal.code, 10)
        bindText(cancelRequest, 'nowText', nowText, 50)
        const cancelled = await cancelRequest.query(`
          UPDATE ${tables.meals}
          SET del = N'1', edittime = @nowText
          WHERE LTRIM(RTRIM(ISNULL(uid, N''))) = @employeeId
            AND LTRIM(RTRIM(ISNULL(dis_dtime, N''))) = @date
            AND LTRIM(RTRIM(ISNULL(dis_lx, N''))) = @mealType
            AND LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
            AND LTRIM(RTRIM(ISNULL(pass, N'0'))) = N'1'
        `)
        if (started) await transaction.commit()
        return { changed: Number(cancelled.rowsAffected?.[0] ?? 0) > 0, selected: false }
      }

      const existsRequest = transaction.request()
      bindText(existsRequest, 'employeeId', employee.id, 50)
      bindText(existsRequest, 'date', date, 20)
      bindText(existsRequest, 'mealType', meal.code, 10)
      const exists = await existsRequest.query(`
        SELECT TOP (1) id
        FROM ${tables.meals}
        WHERE LTRIM(RTRIM(ISNULL(uid, N''))) = @employeeId
          AND LTRIM(RTRIM(ISNULL(dis_dtime, N''))) = @date
          AND LTRIM(RTRIM(ISNULL(dis_lx, N''))) = @mealType
          AND LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(pass, N'0'))) = N'1'
        ORDER BY id ASC
      `)
      if (exists.recordset?.length) {
        if (started) await transaction.commit()
        return { changed: false, selected: true }
      }

      const item = await findOrCreateCompatibilityItem(transaction, { ...employee, nowText }, date, meal)
      const mealSystemcode = codeFactory('')
      const createMealRequest = transaction.request()
      bindText(createMealRequest, 'employeeId', employee.id, 50)
      bindText(createMealRequest, 'employeeName', employee.name, 50)
      bindText(createMealRequest, 'nowText', nowText, 50)
      bindText(createMealRequest, 'ip', ip, 50)
      bindText(createMealRequest, 'cardNumber', employee.card_number, 50)
      bindText(createMealRequest, 'newCardNumber', employee.new_card_number, 50)
      bindText(createMealRequest, 'userCode', employee.code, 50)
      bindText(createMealRequest, 'mealSystemcode', mealSystemcode, 50)
      bindText(createMealRequest, 'dishId', item.baseId, 50)
      bindText(createMealRequest, 'dishSystemcode', item.systemcode, 50)
      bindText(createMealRequest, 'mealType', meal.code, 10)
      bindText(createMealRequest, 'date', date, 20)
      bindText(createMealRequest, 'content', meal.compatibilityContent, 100)
      bindText(createMealRequest, 'dcode', item.dcode, 50)
      bindText(createMealRequest, 'employeeMealType', employee.meal_type, 50)
      bindText(createMealRequest, 'mealSource', DINING_MEAL_SOURCE, 50)
      bindText(createMealRequest, 'department', employee.in_bm, 50)
      bindText(createMealRequest, 'marker', DINING_COMPATIBILITY_MARKER, 50)
      await createMealRequest.query(`
        INSERT INTO ${tables.meals}
          (uid, uname, utruename, addtime, ip, del, pass, card_number, new_card_number,
           user_code, user_new_code, code, systemcode, enable, info, dis_id, dis_code,
           dis_systemcode, dis_date, dis_money, dis_lx, dis_lx_name, dis_dtime, dis_user,
           dis_info, dis_content, dis_dcode, dis_yes, dis_meal_type, meal_from, bm, bl)
        VALUES
          (@employeeId, @employeeName, @employeeName, @nowText, @ip, N'0', N'1', @cardNumber, @newCardNumber,
           @userCode, N'', N'', @mealSystemcode, N'1', @marker, @dishId, N'',
           @dishSystemcode, N'', N'0', @mealType, N'', @date, N'',
           N'', @content, @dcode, N'0', @employeeMealType, @mealSource, @department, N'0')
      `)
      if (started) await transaction.commit()
      return { changed: true, selected: true }
    } catch (error) {
      if (started) {
        try {
          await transaction.rollback()
        } catch {
          // 保留原始报错，回滚失败只交由连接池清理当前事务连接。
        }
      }
      throw error
    }
  }

  function bindMealPairs(request, pairs, dateColumn, typeColumn, prefix = 'mealPair') {
    return pairs.map((pair, index) => {
      const dateName = `${prefix}Date${index}`
      const typeName = `${prefix}Type${index}`
      bindText(request, dateName, pair.date, 20)
      bindText(request, typeName, pair.meal.code, 10)
      return `(LTRIM(RTRIM(ISNULL(${dateColumn}, N''))) = @${dateName} AND LTRIM(RTRIM(ISNULL(${typeColumn}, N''))) = @${typeName})`
    }).join(' OR ')
  }

  async function listExistingBatchMeals(transaction, employeeId, changes) {
    if (!changes.length) return new Set()
    const request = transaction.request()
    bindText(request, 'employeeId', employeeId, 50)
    const pairs = bindMealPairs(request, changes, 'dis_dtime', 'dis_lx')
    const result = await request.query(`
      SELECT
        LTRIM(RTRIM(ISNULL(dis_dtime, N''))) AS meal_date,
        LTRIM(RTRIM(ISNULL(dis_lx, N''))) AS meal_type
      FROM ${tables.meals}
      WHERE LTRIM(RTRIM(ISNULL(uid, N''))) = @employeeId
        AND LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(pass, N'0'))) = N'1'
        AND (${pairs})
      GROUP BY LTRIM(RTRIM(ISNULL(dis_dtime, N''))), LTRIM(RTRIM(ISNULL(dis_lx, N'')))
    `)
    return new Set((result.recordset || []).map((row) => `${String(row.meal_date).trim()}|${String(row.meal_type).trim()}`))
  }

  async function findOrCreateBatchCompatibilityItems(transaction, employee, changes) {
    if (!changes.length) return new Map()
    const byKey = new Map(changes.map((change) => [`${change.date}|${change.meal.code}`, change]))
    const compatibilityRequest = transaction.request()
    const compatibilityPairs = bindMealPairs(compatibilityRequest, changes, 'i.dtime', 'i.lx', 'compatibility')
    const compatibilityResult = await compatibilityRequest.query(`
      SELECT i.id, i.systemcode, i.dcode,
        LTRIM(RTRIM(ISNULL(i.dtime, N''))) AS meal_date,
        LTRIM(RTRIM(ISNULL(i.lx, N''))) AS meal_type
      FROM ${tables.dishItems} AS i
      INNER JOIN ${tables.dishes} AS d ON d.systemcode = i.systemcode
      WHERE LTRIM(RTRIM(ISNULL(i.info, N''))) = N'${DINING_COMPATIBILITY_MARKER}'
        AND LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.pass, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.enable, N'0'))) = N'1'
        AND LTRIM(RTRIM(ISNULL(d.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(d.pass, N'0'))) = N'1'
        AND LTRIM(RTRIM(ISNULL(d.enable, N'0'))) = N'1'
        AND (${compatibilityPairs})
    `)
    const compatibilityByKey = new Map()
    for (const row of compatibilityResult.recordset || []) {
      const key = `${String(row.meal_date).trim()}|${String(row.meal_type).trim()}`
      if (!compatibilityByKey.has(key)) compatibilityByKey.set(key, row)
    }

    const missing = [...byKey.entries()]
      .filter(([key]) => !compatibilityByKey.has(key))
      .map(([, change]) => change)
    if (missing.length) {
      const dates = [...new Set(missing.map((change) => change.date))]
      const masterRequest = transaction.request()
      const dateParams = dates.map((date, index) => {
        const name = `masterDate${index}`
        bindText(masterRequest, name, date, 20)
        return `@${name}`
      }).join(', ')
      const masterResult = await masterRequest.query(`
        SELECT d.id, d.systemcode, LTRIM(RTRIM(ISNULL(d.dtime, N''))) AS meal_date
        FROM ${tables.dishes} AS d
        WHERE LTRIM(RTRIM(ISNULL(d.dtime, N''))) IN (${dateParams})
          AND LTRIM(RTRIM(ISNULL(d.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(d.pass, N'0'))) = N'1'
          AND LTRIM(RTRIM(ISNULL(d.enable, N'0'))) = N'1'
        ORDER BY d.id ASC
      `)
      const masterByDate = new Map()
      for (const row of masterResult.recordset || []) {
        const date = String(row.meal_date).trim()
        if (!masterByDate.has(date)) masterByDate.set(date, String(row.systemcode).trim())
      }

      const missingMasterDates = dates.filter((date) => !masterByDate.has(date))
      if (missingMasterDates.length) {
        const createMasterRequest = transaction.request()
        bindText(createMasterRequest, 'employeeId', employee.id, 50)
        bindText(createMasterRequest, 'employeeName', employee.name, 50)
        bindText(createMasterRequest, 'nowText', employee.nowText, 50)
        const masterRows = missingMasterDates.map((date, index) => {
          const codeName = `masterCode${index}`
          const dateName = `newMasterDate${index}`
          const systemcode = codeFactory('Dishes-ND-')
          masterByDate.set(date, systemcode)
          bindText(createMasterRequest, codeName, systemcode, 50)
          bindText(createMasterRequest, dateName, date, 20)
          return `SELECT @${codeName} AS systemcode, @${dateName} AS meal_date`
        }).join('\nUNION ALL\n')
        await createMasterRequest.query(`
          INSERT INTO ${tables.dishes}
            (uid, uname, utruename, code, systemcode, addtime, del, pass, yesno, enable, info, dtime)
          SELECT @employeeId, @employeeName, @employeeName, rows.systemcode, rows.systemcode, @nowText,
            N'0', N'1', N'0', N'1', N'${DINING_COMPATIBILITY_MARKER}', rows.meal_date
          FROM (${masterRows}) AS rows
        `)
      }

      const createItemRequest = transaction.request()
      bindText(createItemRequest, 'employeeId', employee.id, 50)
      bindText(createItemRequest, 'employeeName', employee.name, 50)
      bindText(createItemRequest, 'nowText', employee.nowText, 50)
      const itemRows = missing.map((change, index) => {
        const key = `${change.date}|${change.meal.code}`
        const systemcodeName = `itemSystemcode${index}`
        const dcodeName = `itemDcode${index}`
        const dateName = `itemDate${index}`
        const typeName = `itemType${index}`
        const contentName = `itemContent${index}`
        const systemcode = masterByDate.get(change.date)
        const dcode = codeFactory(`Dining-${change.meal.code}-`)
        compatibilityByKey.set(key, { id: 0, systemcode, dcode, meal_date: change.date, meal_type: change.meal.code })
        bindText(createItemRequest, systemcodeName, systemcode, 50)
        bindText(createItemRequest, dcodeName, dcode, 50)
        bindText(createItemRequest, dateName, change.date, 20)
        bindText(createItemRequest, typeName, change.meal.code, 10)
        bindText(createItemRequest, contentName, change.meal.compatibilityContent, 100)
        return `SELECT @${systemcodeName} AS systemcode, @${dcodeName} AS dcode, @${dateName} AS meal_date, @${typeName} AS meal_type, @${contentName} AS content`
      }).join('\nUNION ALL\n')
      await createItemRequest.query(`
        INSERT INTO ${tables.dishItems}
          (uid, uname, utruename, code, systemcode, dcode, dtime, addtime, del, pass, enable, info, lx, content, money)
        SELECT @employeeId, @employeeName, @employeeName, rows.systemcode, rows.systemcode, rows.dcode,
          rows.meal_date, @nowText, N'0', N'0', N'1', N'${DINING_COMPATIBILITY_MARKER}', rows.meal_type, rows.content, 0
        FROM (${itemRows}) AS rows
      `)
    }

    const itemRows = [...compatibilityByKey.values()]
    const firstItemRequest = transaction.request()
    const firstItemPredicates = itemRows.map((item, index) => {
      const systemcodeName = `firstSystemcode${index}`
      const typeName = `firstType${index}`
      bindText(firstItemRequest, systemcodeName, item.systemcode, 50)
      bindText(firstItemRequest, typeName, item.meal_type, 10)
      return `(LTRIM(RTRIM(ISNULL(i.systemcode, N''))) = @${systemcodeName} AND LTRIM(RTRIM(ISNULL(i.lx, N''))) = @${typeName})`
    }).join(' OR ')
    const firstItemResult = await firstItemRequest.query(`
      SELECT i.id, i.systemcode, LTRIM(RTRIM(ISNULL(i.lx, N''))) AS meal_type
      FROM ${tables.dishItems} AS i
      WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.pass, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.enable, N'0'))) = N'1'
        AND (${firstItemPredicates})
      ORDER BY i.id ASC
    `)
    const firstItemByKey = new Map()
    for (const row of firstItemResult.recordset || []) {
      const key = `${String(row.systemcode).trim()}|${String(row.meal_type).trim()}`
      if (!firstItemByKey.has(key)) firstItemByKey.set(key, Number(row.id))
    }
    return new Map([...compatibilityByKey.entries()].map(([key, item]) => [key, {
      baseId: firstItemByKey.get(`${String(item.systemcode).trim()}|${String(item.meal_type).trim()}`) || Number(item.id),
      systemcode: String(item.systemcode).trim(),
      dcode: String(item.dcode).trim(),
    }]))
  }

  async function insertBatchMeals(transaction, employee, changes, compatibilityItems) {
    if (!changes.length) return
    const request = transaction.request()
    bindText(request, 'employeeId', employee.id, 50)
    bindText(request, 'employeeName', employee.name, 50)
    bindText(request, 'nowText', changes[0].nowText, 50)
    bindText(request, 'ip', changes[0].ip, 50)
    bindText(request, 'cardNumber', employee.card_number, 50)
    bindText(request, 'newCardNumber', employee.new_card_number, 50)
    bindText(request, 'userCode', employee.code, 50)
    bindText(request, 'employeeMealType', employee.meal_type, 50)
    bindText(request, 'department', employee.in_bm, 50)
    const rows = changes.map((change, index) => {
      const item = compatibilityItems.get(`${change.date}|${change.meal.code}`)
      const names = {
        systemcode: `mealSystemcode${index}`,
        dishId: `mealDishId${index}`,
        dishSystemcode: `mealDishSystemcode${index}`,
        mealType: `mealType${index}`,
        date: `mealDate${index}`,
        content: `mealContent${index}`,
        dcode: `mealDcode${index}`,
      }
      bindText(request, names.systemcode, codeFactory(''), 50)
      bindText(request, names.dishId, item.baseId, 50)
      bindText(request, names.dishSystemcode, item.systemcode, 50)
      bindText(request, names.mealType, change.meal.code, 10)
      bindText(request, names.date, change.date, 20)
      bindText(request, names.content, change.meal.compatibilityContent, 100)
      bindText(request, names.dcode, item.dcode, 50)
      return `SELECT @${names.systemcode} AS systemcode, @${names.dishId} AS dish_id, @${names.dishSystemcode} AS dish_systemcode, @${names.mealType} AS meal_type, @${names.date} AS meal_date, @${names.content} AS content, @${names.dcode} AS dcode`
    }).join('\nUNION ALL\n')
    await request.query(`
      INSERT INTO ${tables.meals}
        (uid, uname, utruename, addtime, ip, del, pass, card_number, new_card_number,
         user_code, user_new_code, code, systemcode, enable, info, dis_id, dis_code,
         dis_systemcode, dis_date, dis_money, dis_lx, dis_lx_name, dis_dtime, dis_user,
         dis_info, dis_content, dis_dcode, dis_yes, dis_meal_type, meal_from, bm, bl)
      SELECT @employeeId, @employeeName, @employeeName, @nowText, @ip, N'0', N'1', @cardNumber, @newCardNumber,
        @userCode, N'', N'', rows.systemcode, N'1', N'${DINING_COMPATIBILITY_MARKER}', rows.dish_id, N'',
        rows.dish_systemcode, N'', N'0', rows.meal_type, N'', rows.meal_date, N'',
        N'', rows.content, rows.dcode, N'0', @employeeMealType, N'${DINING_MEAL_SOURCE}', @department, N'0'
      FROM (${rows}) AS rows
    `)
  }

  async function cancelBatchMeals(transaction, employeeId, changes) {
    if (!changes.length) return new Set()
    const request = transaction.request()
    bindText(request, 'employeeId', employeeId, 50)
    bindText(request, 'nowText', changes[0].nowText, 50)
    const pairs = bindMealPairs(request, changes, 'dis_dtime', 'dis_lx', 'cancel')
    const result = await request.query(`
      UPDATE ${tables.meals}
      SET del = N'1', edittime = @nowText
      OUTPUT LTRIM(RTRIM(ISNULL(INSERTED.dis_dtime, N''))) AS meal_date,
        LTRIM(RTRIM(ISNULL(INSERTED.dis_lx, N''))) AS meal_type
      WHERE LTRIM(RTRIM(ISNULL(uid, N''))) = @employeeId
        AND LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(pass, N'0'))) = N'1'
        AND (${pairs})
    `)
    return new Set((result.recordset || []).map((row) => `${String(row.meal_date).trim()}|${String(row.meal_type).trim()}`))
  }

  async function setMeals(changes = []) {
    if (!Array.isArray(changes) || changes.length === 0) return []
    const pool = await poolProvider()
    const transaction = transactionFactory(pool)
    let started = false
    try {
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
      started = true
      const employee = { ...changes[0].employee, nowText: changes[0].nowText }
      const additions = changes.filter((change) => change.selected)
      const cancellations = changes.filter((change) => !change.selected)
      const existingKeys = await listExistingBatchMeals(transaction, employee.id, additions)
      const additionsToCreate = additions.filter((change) => !existingKeys.has(`${change.date}|${change.meal.code}`))
      const compatibilityItems = await findOrCreateBatchCompatibilityItems(transaction, employee, additionsToCreate)
      await insertBatchMeals(transaction, employee, additionsToCreate, compatibilityItems)
      const cancelledKeys = await cancelBatchMeals(transaction, employee.id, cancellations)
      const results = changes.map((change) => {
        const key = `${change.date}|${change.meal.code}`
        if (change.selected) return { changed: !existingKeys.has(key), selected: true }
        return { changed: cancelledKeys.has(key), selected: false }
      })
      await transaction.commit()
      return results
    } catch (error) {
      if (started) {
        try {
          await transaction.rollback()
        } catch {
          // 以原始报错为准，回滚失败交由连接池释放当前事务连接。
        }
      }
      throw error
    }
  }

  return { getCutoffTime, listActiveMeals, setMeal, setMeals }
}

function createKeyLock() {
  const pending = new Map()
  return async function withKeyLock(key, action) {
    const previous = pending.get(key) || Promise.resolve()
    let release
    const current = new Promise((resolve) => { release = resolve })
    const chain = previous.then(() => current)
    pending.set(key, chain)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (pending.get(key) === chain) pending.delete(key)
    }
  }
}

export function createDiningMealService(options = {}) {
  const repository = options.repository || createDiningMealRepository(options)
  const now = options.now || (() => new Date())
  const withKeyLock = options.withKeyLock || createKeyLock()
  const getDateRule = options.getDateRule || getDiningReportDateRule
  const getDateRules = options.getDateRules || getDiningReportDateRules

  async function list(employee) {
    const cutoff = await repository.getCutoffTime()
    const window = buildDiningDateWindow(now(), cutoff)
    const rows = await repository.listActiveMeals({ employeeId: employee.id, start: window.start, end: window.end })
    const status = new Map()
    for (const row of rows) {
      const date = String(row?.meal_date ?? '').trim()
      const type = String(row?.meal_type ?? '').trim()
      if (!date || !['2', '3'].includes(type)) continue
      status.set(`${date}|${type}`, Number(row?.record_count ?? 0))
    }
    const dateRules = await getDateRules(employee, window.dates.map((item) => item.date))
    return {
      cutoffTime: window.cutoffTime,
      start: window.start,
      end: window.end,
      dates: window.dates.map((item, index) => ({
        ...item,
        canEdit: item.canEdit && dateRules[index].allowed,
        ruleReason: dateRules[index].reason,
        lunch: { selected: status.has(`${item.date}|2`), recordCount: status.get(`${item.date}|2`) || 0 },
        dinner: { selected: status.has(`${item.date}|3`), recordCount: status.get(`${item.date}|3`) || 0 },
      })),
    }
  }

  async function change(employee, input, ip = '') {
    const date = String(input?.date ?? '').trim()
    const mealKey = String(input?.mealType ?? '').trim().toLowerCase()
    const meal = DINING_MEAL_TYPES[mealKey]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !meal || typeof input?.selected !== 'boolean') {
      throw new DiningMealError(400, '报餐日期、餐次或选择状态无效')
    }

    const cutoff = await repository.getCutoffTime()
    const window = buildDiningDateWindow(now(), cutoff)
    const target = window.dates.find((item) => item.date === date)
    if (!target) throw new DiningMealError(400, '只能填写明天起未来一个月内的报餐')
    if (!target.canEdit) throw new DiningMealError(409, `该日期报餐已于前一天 ${window.cutoffTime.slice(0, 5)} 截止`)
    // 规则只拦截新增报餐；已存在的历史报餐即使后来改为禁报日，员工仍可取消。
    if (input.selected) {
      const rule = await getDateRule(employee, date)
      if (!rule.allowed) throw new DiningMealError(409, `${rule.reason || '该日期'}不能报餐`)
    }

    const current = getShanghaiParts(now())
    const nowText = `${current.date} ${current.time}`
    return withKeyLock(`${date}|${meal.code}`, () => repository.setMeal({
      employee,
      date,
      meal,
      selected: input.selected,
      nowText,
      ip,
    }))
  }

  async function withMealLocks(keys, action, index = 0) {
    if (index >= keys.length) return action()
    return withKeyLock(keys[index], () => withMealLocks(keys, action, index + 1))
  }

  async function batchChange(employee, input, ip = '') {
    const action = String(input?.action ?? '').trim().toLowerCase()
    const targetMeals = action === 'lunch' ? ['lunch']
      : action === 'dinner' ? ['dinner']
        : ['lunch', 'dinner']
    const selected = action !== 'cancel'
    if (!['lunch', 'dinner', 'all', 'cancel'].includes(action)) {
      throw new DiningMealError(400, '一键报餐操作无效')
    }

    const current = await list(employee)
    const changes = []
    const skipped = []
    let changedCount = 0
    for (const day of current.dates) {
      if (!day.canEdit) {
        for (const mealKey of targetMeals) {
          skipped.push({
            date: day.date,
            mealType: mealKey,
            reason: day.ruleReason || `已过报餐截止时间（${current.cutoffTime.slice(0, 5)}）`,
          })
        }
        continue
      }
      for (const mealKey of targetMeals) {
        if (Boolean(day[mealKey]?.selected) === selected) {
          skipped.push({ date: day.date, mealType: mealKey, reason: selected ? '已报餐' : '未报餐' })
          continue
        }
        changes.push({ date: day.date, meal: DINING_MEAL_TYPES[mealKey], selected })
      }
    }

    if (changes.length) {
      const nowParts = getShanghaiParts(now())
      const nowText = `${nowParts.date} ${nowParts.time}`
      const lockKeys = changes.map((item) => `${item.date}|${item.meal.code}`).sort()
      const results = await withMealLocks(lockKeys, () => repository.setMeals(changes.map((item) => ({
        employee,
        ...item,
        nowText,
        ip,
      }))))
      changedCount = results.filter((item) => item?.changed).length
      for (let index = 0; index < results.length; index += 1) {
        if (!results[index]?.changed) {
          skipped.push({
            date: changes[index].date,
            mealType: changes[index].meal === DINING_MEAL_TYPES.lunch ? 'lunch' : 'dinner',
            reason: selected ? '已报餐' : '未报餐',
          })
        }
      }
    }

    return {
      action,
      selected,
      changedCount,
      skippedCount: skipped.length,
      skipped: skipped.slice(0, 8),
    }
  }

  return { list, change, batchChange }
}

function diningErrorResponse(error) {
  if (error instanceof DiningMealError) return { status: error.status, message: error.message }
  if (Number(error?.number ?? error?.originalError?.number) === 229) {
    return { status: 503, message: '旧饭堂正式库尚未开放报餐写权限，请联系管理员' }
  }
  return { status: 500, message: '报餐数据处理失败，请稍后再试' }
}

export function registerDiningMealRoutes(app, options = {}) {
  const authService = options.authService
  if (!authService?.getEmployee) throw new Error('registerDiningMealRoutes 缺少独立报餐身份服务')
  const service = options.service || createDiningMealService(options)

  function requireEmployee(req, res) {
    const employee = authService.getEmployee(readDiningBearerToken(req))
    if (!employee) {
      res.status(401).json({ code: 401, msg: '报餐登录已失效，请重新登录', data: null })
      return null
    }
    return employee
  }

  app.get('/api/dining/meals', async (req, res) => {
    const employee = requireEmployee(req, res)
    if (!employee) return
    try {
      const data = await service.list(employee)
      res.json({ code: 200, msg: 'success', data })
    } catch (error) {
      console.error('读取员工报餐状态失败：', error)
      const response = diningErrorResponse(error)
      res.status(response.status).json({ code: response.status, msg: response.message, data: null })
    }
  })

  app.put('/api/dining/meals', async (req, res) => {
    const employee = requireEmployee(req, res)
    if (!employee) return
    try {
      const result = await service.change(employee, req.body, getRequestIp(req))
      res.json({ code: 200, msg: result.selected ? '报餐成功' : '取消报餐成功', data: result })
    } catch (error) {
      console.error('保存员工报餐失败：', error)
      const response = diningErrorResponse(error)
      res.status(response.status).json({ code: response.status, msg: response.message, data: null })
    }
  })

  app.put('/api/dining/meals/batch', async (req, res) => {
    const employee = requireEmployee(req, res)
    if (!employee) return
    try {
      const result = await service.batchChange(employee, req.body, getRequestIp(req))
      res.json({ code: 200, msg: '一键报餐处理完成', data: result })
    } catch (error) {
      console.error('一键处理员工报餐失败：', error)
      const response = diningErrorResponse(error)
      res.status(response.status).json({ code: response.status, msg: response.message, data: null })
    }
  })

  return service
}
