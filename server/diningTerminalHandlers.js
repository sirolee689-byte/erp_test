import { getPool, sql } from './db.js'
import {
  createDiningTableRefs,
  isDiningTerminalTestMode,
  resolveDiningDatabaseName,
} from './diningDatabase.js'
import { getRequestIp } from './requestIp.js'

export const DINING_TERMINAL_MEALS = Object.freeze({
  lunch: { key: 'lunch', code: '2', label: '午餐', startField: 'two1', endField: 'two2' },
  dinner: { key: 'dinner', code: '3', label: '晚餐', startField: 'three1', endField: 'three2' },
})

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

export class DiningTerminalError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'DiningTerminalError'
    this.status = status
  }
}

function getShanghaiParts(nowRaw) {
  const date = nowRaw instanceof Date ? nowRaw : new Date(nowRaw)
  if (Number.isNaN(date.getTime())) throw new DiningTerminalError(500, '服务器时间无效')
  const values = Object.fromEntries(
    shanghaiFormatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:${values.second}`,
    text: `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`,
  }
}

function normalizeLegacyTime(raw) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(raw ?? '').trim())
  if (!match) return ''
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? 0)
  if (hour > 23 || minute > 59 || second > 59) return ''
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

export function resolveDiningTerminalMeal(config, timeRaw) {
  const current = normalizeLegacyTime(timeRaw)
  if (!current) return null
  for (const meal of Object.values(DINING_TERMINAL_MEALS)) {
    const start = normalizeLegacyTime(config?.[meal.startField])
    const end = normalizeLegacyTime(config?.[meal.endField])
    if (start && end && current >= start && current <= end) return { ...meal, start, end }
  }
  return null
}

function normalizeManualTarget(input) {
  const date = String(input?.date ?? '').trim()
  const mealKey = String(input?.mealType ?? '').trim().toLowerCase()
  const meal = DINING_TERMINAL_MEALS[mealKey]
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null
  const validDate = parsed && `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}` === date
  if (!validDate || !meal) {
    throw new DiningTerminalError(400, '测试日期或餐别无效')
  }
  return { date, meal }
}

function bindText(request, name, value, length = 100) {
  return request.input(name, sql.NVarChar(length), String(value ?? ''))
}

function uniqueTexts(rows, field) {
  return [...new Set(rows.map((row) => String(row?.[field] ?? '').trim()).filter(Boolean))]
}

function publicEmployee(row) {
  return {
    id: String(row?.id ?? ''),
    code: String(row?.code ?? ''),
    newCode: String(row?.new_code ?? ''),
    name: String(row?.name ?? ''),
    department: String(row?.in_bm ?? ''),
    mealType: String(row?.meal_type ?? '') || '员工餐',
  }
}

function maskCardNumber(raw) {
  const text = String(raw ?? '').trim()
  return text ? `******${text.slice(-4)}` : ''
}

export function normalizeDiningTerminalPagination(input = {}) {
  const rawPage = Number(input.page)
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.trunc(rawPage) : 1
  const rawPageSize = Number(input.pageSize)
  const pageSize = [10, 20, 50].includes(rawPageSize) ? rawPageSize : 10
  return { page, pageSize }
}

export function createDiningTerminalRepository(options = {}) {
  const poolProvider = options.getPool || getPool
  const tables = options.tables || createDiningTableRefs()
  const transactionFactory = options.transactionFactory || ((pool) => new sql.Transaction(pool))

  async function loadContext(ip) {
    const pool = await poolProvider()
    const request = pool.request()
    bindText(request, 'ip', ip, 100)
    const result = await request.query(`
      SELECT TOP (1) id, ip, px, name, tdname
      FROM ${tables.machines}
      WHERE ip = @ip
      ORDER BY id ASC;

      SELECT TOP (1) code, closed, two1, two2, three1, three2
      FROM ${tables.config}
      WHERE code = N'UB_ERP_Dining'
        AND del = N'0'
        AND pass = N'1'
        AND enable = N'1'
      ORDER BY id ASC;
    `)
    return {
      machine: result.recordsets?.[0]?.[0] ?? null,
      config: result.recordsets?.[1]?.[0] ?? null,
    }
  }

  async function processSwipe({ cardNumber, date, meal, ip, now, nowText, allowUnreported }) {
    const pool = await poolProvider()
    const transaction = transactionFactory(pool)
    let started = false
    try {
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
      started = true

      const employeeRequest = transaction.request()
      bindText(employeeRequest, 'cardNumber', cardNumber, 100)
      const employeeResult = await employeeRequest.query(`
        SELECT TOP (1) id, code, new_code, name, in_bm, meal_type
        FROM ${tables.staff}
        WHERE (card_number = @cardNumber OR new_card_number = @cardNumber)
          AND del = N'0'
          AND pass = N'1'
        ORDER BY id DESC
      `)
      const employeeRow = employeeResult.recordset?.[0]
      if (!employeeRow) {
        await transaction.commit()
        return { status: 'employee_not_found', cardNumber: maskCardNumber(cardNumber) }
      }

      const employeeId = String(employeeRow.id ?? '')
      const lockRequest = transaction.request()
      bindText(lockRequest, 'lockResource', `DiningSwipe:${employeeId}:${date}:${meal.code}`, 255)
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
        throw new DiningTerminalError(409, '该员工的刷卡正在处理中，请稍后重试')
      }

      const mealRequest = transaction.request()
      bindText(mealRequest, 'employeeId', employeeId, 50)
      bindText(mealRequest, 'date', date, 20)
      bindText(mealRequest, 'mealType', meal.code, 10)
      const mealResult = await mealRequest.query(`
        SELECT TOP (50) dis_content, meal_from
        FROM ${tables.meals}
        WHERE uid = @employeeId
          AND dis_dtime = @date
          AND dis_lx = @mealType
          AND del = N'0'
          AND pass = N'1'
        ORDER BY id ASC
      `)
      const mealRows = mealResult.recordset || []

      const duplicateRequest = transaction.request()
      bindText(duplicateRequest, 'employeeId', employeeId, 50)
      bindText(duplicateRequest, 'date', date, 20)
      bindText(duplicateRequest, 'mealType', meal.code, 10)
      const duplicateResult = await duplicateRequest.query(`
        SELECT TOP (1) id, LEFT(ISNULL(addtime, N''), 19) AS edible_time_text
        FROM ${tables.mealLogs}
        WHERE uid = @employeeId
          AND dtime = @date
          AND meal_type = @mealType
          AND del = N'0'
        ORDER BY id ASC
      `)
      if (duplicateResult.recordset?.length) {
        await transaction.commit()
        return {
          status: 'duplicate',
          employee: publicEmployee(employeeRow),
          cardNumber: maskCardNumber(cardNumber),
          edibleTime: duplicateResult.recordset[0].edible_time_text,
        }
      }

      const reported = mealRows.length > 0
      if (!reported && !allowUnreported) {
        await transaction.commit()
        return {
          status: 'not_reported',
          employee: publicEmployee(employeeRow),
          cardNumber: maskCardNumber(cardNumber),
        }
      }

      const insertRequest = transaction.request()
      bindText(insertRequest, 'employeeId', employeeId, 50)
      bindText(insertRequest, 'employeeCode', employeeRow.code, 100)
      bindText(insertRequest, 'employeeName', employeeRow.name, 100)
      bindText(insertRequest, 'mealType', meal.code, 10)
      // edible_time 是旧系统的本地时间字段，不能直接传 Node 的 UTC Date。
      bindText(insertRequest, 'edibleTimeText', nowText, 19)
      bindText(insertRequest, 'date', date, 20)
      bindText(insertRequest, 'cardNumber', cardNumber, 100)
      bindText(insertRequest, 'nowText', nowText, 100)
      bindText(insertRequest, 'bcInfo', reported ? '0' : '消费成功', 100)
      bindText(insertRequest, 'employeeMealType', employeeRow.meal_type || '员工餐', 100)
      bindText(insertRequest, 'ip', ip, 100)
      const inserted = await insertRequest.query(`
        INSERT INTO ${tables.mealLogs}
          (uid, employee_id, employee_name, meal_type, edible_time, dtime,
           card_id, new_card_id, addtime, bc_info, dis_meal_type, ip, del, bl)
        OUTPUT INSERTED.id
        VALUES
          (@employeeId, @employeeCode, @employeeName, @mealType,
           CONVERT(datetime, @edibleTimeText, 120), @date,
           @cardNumber, @cardNumber, @nowText, @bcInfo, @employeeMealType, @ip, N'0', N'0')
      `)
      await transaction.commit()
      return {
        status: reported ? 'success' : 'supplement_success',
        employee: publicEmployee(employeeRow),
        cardNumber: maskCardNumber(cardNumber),
        recordId: inserted.recordset?.[0]?.id ?? null,
        edibleTime: nowText,
        contents: uniqueTexts(mealRows, 'dis_content'),
        sources: uniqueTexts(mealRows, 'meal_from'),
      }
    } catch (error) {
      if (started) {
        try { await transaction.rollback() } catch { /* 保留原始数据库错误。 */ }
      }
      throw error
    }
  }

  async function listRecent({ ip, date, mealType, page, pageSize }) {
    const pool = await poolProvider()
    const request = pool.request()
    bindText(request, 'ip', ip, 100)
    bindText(request, 'date', date, 20)
    bindText(request, 'mealType', mealType, 10)
    request.input('startRow', sql.Int, (page - 1) * pageSize + 1)
    request.input('endRow', sql.Int, page * pageSize)
    const result = await request.query(`
      SELECT id, employee_name, meal_type,
        LEFT(ISNULL(addtime, N''), 19) AS edible_time_text,
        dtime, bc_info,
        ROW_NUMBER() OVER (ORDER BY id DESC) AS row_num
      INTO #DiningTerminalRows
      FROM ${tables.mealLogs}
      WHERE ip = @ip
        AND dtime = @date
        AND (@mealType = N'' OR meal_type = @mealType)
        AND del = N'0';

      SELECT id, employee_name, meal_type, edible_time_text, dtime, bc_info
      FROM #DiningTerminalRows
      WHERE row_num BETWEEN @startRow AND @endRow
      ORDER BY row_num;

      SELECT COUNT(1) AS total_count
      FROM #DiningTerminalRows;

      SELECT uid,
        MAX(CASE WHEN NULLIF(utruename, N'') IS NOT NULL THEN utruename ELSE uname END) AS employee_name
      INTO #DiningTerminalReported
      FROM ${tables.meals}
      WHERE dis_dtime = @date
        AND (@mealType = N'' OR dis_lx = @mealType)
        AND del = N'0'
        AND pass = N'1'
        AND uid IS NOT NULL
        AND uid <> N''
      GROUP BY uid;

      SELECT uid,
        MAX(CASE WHEN bc_info = N'0' THEN 1 ELSE 0 END) AS normal_swipe,
        MAX(CASE WHEN bc_info = N'消费成功' THEN 1 ELSE 0 END) AS supplement
      INTO #DiningTerminalLogFlags
      FROM ${tables.mealLogs}
      WHERE dtime = @date
        AND (@mealType = N'' OR meal_type = @mealType)
        AND del = N'0'
        AND uid IS NOT NULL
        AND uid <> N''
      GROUP BY uid;

      SELECT
        COUNT(1) AS expected_count,
        ISNULL(SUM(CASE WHEN ISNULL(l.normal_swipe, 0) = 1 THEN 1 ELSE 0 END), 0) AS swiped_count,
        ISNULL(SUM(CASE WHEN ISNULL(l.normal_swipe, 0) = 0 THEN 1 ELSE 0 END), 0) AS pending_count,
        ISNULL((SELECT SUM(supplement) FROM #DiningTerminalLogFlags), 0) AS supplement_count
      FROM #DiningTerminalReported r
      LEFT JOIN #DiningTerminalLogFlags l ON l.uid = r.uid;

      SELECT r.uid, r.employee_name
      FROM #DiningTerminalReported r
      LEFT JOIN #DiningTerminalLogFlags l ON l.uid = r.uid
      WHERE ISNULL(l.normal_swipe, 0) = 0
      ORDER BY employee_name, uid;
    `)
    const rows = (result.recordsets?.[0] || []).map((row) => ({
      id: row.id,
      employeeName: String(row.employee_name ?? ''),
      mealType: String(row.meal_type ?? ''),
      mealLabel: String(row.meal_type ?? '') === '2' ? '午餐' : '晚餐',
      edibleTime: String(row.edible_time_text ?? ''),
      date: String(row.dtime ?? ''),
      result: String(row.bc_info ?? '') === '消费成功' ? '补餐成功' : '打卡成功',
    }))
    const total = Number(result.recordsets?.[1]?.[0]?.total_count ?? 0)
    const counts = result.recordsets?.[2]?.[0] || {}
    const pendingRows = (result.recordsets?.[3] || []).map((row) => ({
      uid: String(row.uid ?? ''),
      employeeName: String(row.employee_name ?? '').trim() || '未命名员工',
    }))
    return {
      rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
      },
      summary: {
        expected: Number(counts.expected_count ?? 0),
        swiped: Number(counts.swiped_count ?? 0),
        pending: Math.max(0, Number(counts.pending_count ?? 0)),
        supplement: Number(counts.supplement_count ?? 0),
      },
      pendingRows,
    }
  }

  return { loadContext, processSwipe, listRecent }
}

export function createDiningTerminalService(options = {}) {
  const databaseName = options.databaseName || resolveDiningDatabaseName()
  const testMode = options.testMode ?? isDiningTerminalTestMode(databaseName)
  const repository = options.repository || createDiningTerminalRepository(options)
  const now = options.now || (() => new Date())

  async function getAuthorizedContext(ip) {
    const normalizedIp = String(ip ?? '').trim()
    if (!normalizedIp) throw new DiningTerminalError(403, '无法识别当前终端IP')
    const context = await repository.loadContext(normalizedIp)
    if (!context.machine) throw new DiningTerminalError(403, '当前终端未授权')
    if (!context.config) throw new DiningTerminalError(503, '未找到启用的饭堂配置')
    return { ...context, ip: normalizedIp }
  }

  function resolveTarget(config, input = {}) {
    const current = getShanghaiParts(now())
    const hasManualTarget = Boolean(String(input?.date ?? '').trim() || String(input?.mealType ?? '').trim())
    if (hasManualTarget) {
      if (!testMode) throw new DiningTerminalError(400, '正式环境不允许手动选择日期和餐别')
      const target = normalizeManualTarget(input)
      return { ...target, current, manual: true }
    }
    const meal = resolveDiningTerminalMeal(config, current.time)
    if (!meal) throw new DiningTerminalError(409, '当前不在午餐或晚餐刷卡时段')
    return { date: current.date, meal, current, manual: false }
  }

  async function context(ip) {
    const authorized = await getAuthorizedContext(ip)
    const current = getShanghaiParts(now())
    const activeMeal = resolveDiningTerminalMeal(authorized.config, current.time)
    return {
      testMode,
      databaseName,
      serverDate: current.date,
      serverTime: current.time,
      machine: {
        id: authorized.machine.id,
        ip: authorized.ip,
        number: String(authorized.machine.px ?? ''),
        name: String(authorized.machine.name ?? authorized.machine.tdname ?? ''),
      },
      closed: String(authorized.config.closed ?? '0') === '1',
      meals: Object.values(DINING_TERMINAL_MEALS).map((meal) => ({
        key: meal.key,
        code: meal.code,
        label: meal.label,
        start: normalizeLegacyTime(authorized.config[meal.startField]),
        end: normalizeLegacyTime(authorized.config[meal.endField]),
      })),
      activeMeal: activeMeal ? {
        key: activeMeal.key,
        code: activeMeal.code,
        label: activeMeal.label,
        start: activeMeal.start,
        end: activeMeal.end,
      } : null,
    }
  }

  async function swipe(ip, input) {
    const cardNumber = String(input?.cardNumber ?? '').trim()
    if (cardNumber.length !== 10) throw new DiningTerminalError(400, '饭卡号必须是10位')
    const authorized = await getAuthorizedContext(ip)
    const target = resolveTarget(authorized.config, input)
    const swipeNow = now()
    const result = await repository.processSwipe({
      cardNumber,
      date: target.date,
      meal: target.meal,
      ip: authorized.ip,
      now: swipeNow,
      nowText: getShanghaiParts(swipeNow).text,
      allowUnreported: String(authorized.config.closed ?? '0') === '1',
    })
    return {
      ...result,
      date: target.date,
      mealType: target.meal.code,
      mealLabel: target.meal.label,
      manual: target.manual,
    }
  }

  async function recent(ip, input = {}) {
    const authorized = await getAuthorizedContext(ip)
    let target
    try {
      target = resolveTarget(authorized.config, input)
    } catch (error) {
      if (!(error instanceof DiningTerminalError) || error.status !== 409) throw error
      const current = getShanghaiParts(now())
      target = { date: current.date, meal: { code: '' } }
    }
    const pagination = normalizeDiningTerminalPagination(input)
    return repository.listRecent({
      ip: authorized.ip,
      date: target.date,
      mealType: target.meal.code,
      ...pagination,
    })
  }

  return { context, swipe, recent }
}

function errorResponse(error) {
  if (error instanceof DiningTerminalError) return { status: error.status, message: error.message }
  if (Number(error?.number ?? error?.originalError?.number) === 208) {
    return { status: 503, message: '测试库饭堂表尚未准备完整，请联系管理员' }
  }
  if (Number(error?.number ?? error?.originalError?.number) === 229) {
    return { status: 503, message: '当前数据库账号没有饭堂刷卡写入权限，请联系管理员' }
  }
  return { status: 500, message: '饭堂刷卡处理失败，请稍后重试' }
}

export function registerDiningTerminalRoutes(app, options = {}) {
  const service = options.service || createDiningTerminalService(options)

  app.get('/api/dining-terminal/context', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.context(getRequestIp(req)) })
    } catch (error) {
      const response = errorResponse(error)
      res.status(response.status).json({ code: response.status, msg: response.message, data: null })
    }
  })

  app.post('/api/dining-terminal/swipe', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.swipe(getRequestIp(req), req.body || {}) })
    } catch (error) {
      const response = errorResponse(error)
      res.status(response.status).json({ code: response.status, msg: response.message, data: null })
    }
  })

  app.get('/api/dining-terminal/recent', async (req, res) => {
    try {
      res.json({ code: 200, msg: 'success', data: await service.recent(getRequestIp(req), req.query || {}) })
    } catch (error) {
      const response = errorResponse(error)
      res.status(response.status).json({ code: response.status, msg: response.message, data: null })
    }
  })

  return service
}
