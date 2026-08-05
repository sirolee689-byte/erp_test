/**
 * 宿舍电费一键录入：Excel 预览校验 + 确认后批量写入 UB_ERP_Hr_room_use
 * 写库口径与 POST /api/hr/dormitory/electric/settle（无换表）一致
 */
import * as XLSX from 'xlsx'
import { sql } from './db.js'

const HR_ROOM_FROM = 'dbo.[UB_ERP_Hr_room]'
const HR_ROOM_IN_FROM = 'dbo.[UB_ERP_Hr_room_in]'
const HR_ROOM_USE_FROM = 'dbo.[UB_ERP_Hr_room_use]'
const HR_STAFF_FROM = 'dbo.[UB_ERP_Hr_staff]'
const PRICE = 0.93

function normalizeExcelCellString(v) {
  return String(v ?? '').replace(/\u00a0/g, ' ').trim()
}

/** 统计月份规范为 YYYY-M（不补零），与单房电费弹窗一致 */
export function normalizeTjDateYm(raw) {
  const s = String(raw ?? '').trim()
  const m = /^(\d{4})-(\d{1,2})$/.exec(s)
  if (!m) return ''
  const y = Number(m[1])
  const mo = Number(m[2])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return ''
  return `${y}-${mo}`
}

function tjDateAltOf(tjDate) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(tjDate ?? '').trim())
  if (!m) return null
  const y = m[1]
  const mo = Number(m[2])
  if (!Number.isFinite(mo)) return null
  const a = `${y}-${mo}`
  const b = `${y}-${String(mo).padStart(2, '0')}`
  return a === String(tjDate).trim() ? b : a
}

function parseNonNegNumber(raw) {
  if (raw == null || String(raw).trim() === '') return NaN
  const n = Number(String(raw).trim().replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

function readingsEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 1e-6
}

/**
 * 解析 Excel：A 房号 / B 上期 / C 本期；首行若像表头则跳过
 * @returns {{ ok: true, rows: Array<{excelRow:number, room_code:string, c_star:number, c_this:number}> } | { ok: false, msg: string }}
 */
export function parseElectricBatchExcel(fileBase64, fileName) {
  const name = String(fileName ?? '').trim()
  if (name && !/\.(xlsx|xls)$/i.test(name)) {
    return { ok: false, msg: '仅支持上传 xlsx 或 xls 文件' }
  }
  let buffer
  try {
    buffer = Buffer.from(String(fileBase64 ?? '').trim(), 'base64')
  } catch {
    return { ok: false, msg: '文件内容解析失败（base64 不合法）' }
  }
  if (!buffer || buffer.length < 10) {
    return { ok: false, msg: '文件内容为空或不完整' }
  }
  let wb
  try {
    wb = XLSX.read(buffer, { type: 'buffer' })
  } catch (e) {
    return { ok: false, msg: `Excel 解析失败：${String(e?.message ?? e)}` }
  }
  const sheetName = wb.SheetNames?.[0]
  if (!sheetName) return { ok: false, msg: 'Excel 中未找到工作表' }
  const sheet = wb.Sheets?.[sheetName]
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (!Array.isArray(rawRows) || rawRows.length < 1) {
    return { ok: false, msg: 'Excel 内容为空' }
  }

  let start = 0
  const h0 = normalizeExcelCellString(rawRows[0]?.[0])
  const h1 = normalizeExcelCellString(rawRows[0]?.[1])
  const h2 = normalizeExcelCellString(rawRows[0]?.[2])
  const headerHint = `${h0}${h1}${h2}`
  // 首行含中文表头关键字，或 B/C 都不是数字时视为表头
  if (/房号|上期|本期|读数|房间/.test(headerHint)) {
    start = 1
  } else if (
    Number.isNaN(parseNonNegNumber(h1)) &&
    Number.isNaN(parseNonNegNumber(h2)) &&
    /[\u4e00-\u9fff]/.test(headerHint)
  ) {
    start = 1
  }

  const rows = []
  for (let i = start; i < rawRows.length; i += 1) {
    const r = rawRows[i] ?? []
    const room_code = normalizeExcelCellString(r[0])
    const cStarRaw = r[1]
    const cThisRaw = r[2]
    // 整行空跳过
    if (!room_code && String(cStarRaw ?? '').trim() === '' && String(cThisRaw ?? '').trim() === '') continue
    rows.push({
      excelRow: i + 1,
      room_code,
      c_star: parseNonNegNumber(cStarRaw),
      c_this: parseNonNegNumber(cThisRaw),
      c_star_raw: normalizeExcelCellString(cStarRaw),
      c_this_raw: normalizeExcelCellString(cThisRaw),
    })
  }
  if (!rows.length) return { ok: false, msg: 'Excel 无有效数据行' }
  return { ok: true, rows }
}

async function roomExistsBySCode(pool, roomCode) {
  const q = pool.request().input('roomCode', sql.NVarChar(50), roomCode)
  const rs = await q.query(`
    SELECT TOP 1 LTRIM(RTRIM(ISNULL(r.s_code, N''))) AS s_code
    FROM ${HR_ROOM_FROM} AS r
    WHERE LTRIM(RTRIM(ISNULL(r.del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(r.pass, N'0'))) = N'1'
      AND LTRIM(RTRIM(ISNULL(r.s_code, N''))) = @roomCode
  `)
  return !!(rs.recordset?.[0])
}

async function countOccupants(pool, roomCode) {
  const q = pool.request().input('roomCode', sql.NVarChar(50), roomCode)
  const rs = await q.query(`
    SELECT COUNT(1) AS cnt
    FROM ${HR_ROOM_IN_FROM} AS i
    INNER JOIN ${HR_STAFF_FROM} AS s
      ON LTRIM(RTRIM(ISNULL(s.new_code, N''))) = LTRIM(RTRIM(ISNULL(i.staff_code, N'')))
      AND LTRIM(RTRIM(ISNULL(s.del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(s.pass, N'0'))) = N'1'
    WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(i.room_code, N''))) = @roomCode
  `)
  return Number(rs.recordset?.[0]?.cnt ?? 0)
}

/**
 * 期望上期：该月已有记录则取其 c_star；否则取最近一条 c_this（无则 0）
 * @returns {{ expectedStar: number, hasMonthRecord: boolean, monthCThis: number|null }}
 */
async function getExpectedStarAndMonthFlag(pool, roomCode, tjDate) {
  const alt = tjDateAltOf(tjDate)
  const q = pool.request()
  q.input('roomCode', sql.NVarChar(50), roomCode)
  q.input('tj_date', sql.NVarChar(50), tjDate)
  q.input('tj_date_alt', sql.NVarChar(50), alt)
  const monthRs = await q.query(`
    SELECT TOP 1
      LTRIM(RTRIM(ISNULL(u.c_star, N''))) AS c_star,
      LTRIM(RTRIM(ISNULL(u.c_this, N''))) AS c_this
    FROM ${HR_ROOM_USE_FROM} AS u
    WHERE LTRIM(RTRIM(ISNULL(u.del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(u.room_code, N''))) = @roomCode
      AND (
        LTRIM(RTRIM(ISNULL(u.tj_date, N''))) = @tj_date
        OR (@tj_date_alt IS NOT NULL AND LTRIM(RTRIM(ISNULL(u.tj_date, N''))) = @tj_date_alt)
      )
    ORDER BY u.id DESC
  `)
  const monthRow = monthRs.recordset?.[0] ?? null
  if (monthRow) {
    const star = Number(String(monthRow.c_star ?? '').trim() || '0')
    const thisNum = Number(String(monthRow.c_this ?? '').trim() || '0')
    return {
      expectedStar: Number.isFinite(star) ? star : 0,
      hasMonthRecord: true,
      monthCThis: Number.isFinite(thisNum) ? thisNum : null,
    }
  }

  const lastRs = await pool
    .request()
    .input('roomCode', sql.NVarChar(50), roomCode)
    .query(`
      SELECT TOP 1 LTRIM(RTRIM(ISNULL(u.c_this, N''))) AS c_this
      FROM ${HR_ROOM_USE_FROM} AS u
      WHERE LTRIM(RTRIM(ISNULL(u.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(u.room_code, N''))) = @roomCode
      ORDER BY u.id DESC
    `)
  const last = Number(String(lastRs.recordset?.[0]?.c_this ?? '').trim() || '0')
  return {
    expectedStar: Number.isFinite(last) ? last : 0,
    hasMonthRecord: false,
    monthCThis: null,
  }
}

async function loadOccupantDiscounts(pool, roomCode) {
  const occRs = await pool
    .request()
    .input('roomCode', sql.NVarChar(50), roomCode)
    .query(`
      SELECT
        i.id,
        LTRIM(RTRIM(ISNULL(i.electric, N''))) AS electric
      FROM ${HR_ROOM_IN_FROM} AS i
      INNER JOIN ${HR_STAFF_FROM} AS s
        ON LTRIM(RTRIM(ISNULL(s.new_code, N''))) = LTRIM(RTRIM(ISNULL(i.staff_code, N'')))
        AND LTRIM(RTRIM(ISNULL(s.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(s.pass, N'0'))) = N'1'
      WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.room_code, N''))) = @roomCode
      ORDER BY i.id DESC
    `)
  return (occRs.recordset ?? []).map((r) => {
    const disc = Number(String(r?.electric ?? '').trim() || '0')
    return Number.isFinite(disc) && disc > 0 ? disc : 0
  })
}

/**
 * 预览：逐行校验，不写库
 * status: ok | overwrite | skip
 */
export async function previewElectricBatch(pool, { tj_date, fileBase64, fileName }) {
  const tjDate = normalizeTjDateYm(tj_date)
  if (!tjDate) {
    return { ok: false, status: 400, msg: 'tj_date（统计月份）不合法，例如 2026-7' }
  }
  const parsed = parseElectricBatchExcel(fileBase64, fileName)
  if (!parsed.ok) return { ok: false, status: 400, msg: parsed.msg }

  const results = []
  const seenRooms = new Set()

  for (const row of parsed.rows) {
    const base = {
      excelRow: row.excelRow,
      room_code: row.room_code,
      c_star: row.c_star_raw,
      c_this: row.c_this_raw,
    }

    if (!row.room_code) {
      results.push({ ...base, status: 'skip', reason: '房号为空' })
      continue
    }
    if (!Number.isFinite(row.c_star)) {
      results.push({ ...base, status: 'skip', reason: '上期读数不是有效非负数字' })
      continue
    }
    if (!Number.isFinite(row.c_this)) {
      results.push({ ...base, status: 'skip', reason: '本期读数不是有效非负数字' })
      continue
    }
    if (row.c_this < row.c_star) {
      results.push({
        ...base,
        status: 'skip',
        reason: `本期读数(${row.c_this})小于上期读数(${row.c_star})`,
      })
      continue
    }
    if (seenRooms.has(row.room_code)) {
      results.push({ ...base, status: 'skip', reason: 'Excel 中同一房号重复，仅保留首次出现行' })
      continue
    }
    seenRooms.add(row.room_code)

    const exists = await roomExistsBySCode(pool, row.room_code)
    if (!exists) {
      results.push({ ...base, status: 'skip', reason: '系统中找不到该房号（须已审核未删除）' })
      continue
    }

    const occCnt = await countOccupants(pool, row.room_code)
    if (occCnt <= 0) {
      results.push({ ...base, status: 'skip', reason: '该房间当前无在住人员，无法核算' })
      continue
    }

    const { expectedStar, hasMonthRecord } = await getExpectedStarAndMonthFlag(pool, row.room_code, tjDate)
    if (!readingsEqual(row.c_star, expectedStar)) {
      results.push({
        ...base,
        status: 'skip',
        reason: `上期读数与系统不符（系统期望 ${expectedStar}，Excel 为 ${row.c_star}）`,
        system_c_star: expectedStar,
      })
      continue
    }

    const used = row.c_this - row.c_star
    const totalMoney = Math.round(used * PRICE * 100) / 100
    if (hasMonthRecord) {
      results.push({
        ...base,
        status: 'overwrite',
        reason: '该房该月已有电费，确认导入将覆盖',
        c_star_num: row.c_star,
        c_this_num: row.c_this,
        used_electric: used,
        total_money: totalMoney,
      })
    } else {
      results.push({
        ...base,
        status: 'ok',
        reason: '可导入',
        c_star_num: row.c_star,
        c_this_num: row.c_this,
        used_electric: used,
        total_money: totalMoney,
      })
    }
  }

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    overwrite: results.filter((r) => r.status === 'overwrite').length,
    skip: results.filter((r) => r.status === 'skip').length,
  }

  return {
    ok: true,
    data: {
      tj_date: tjDate,
      summary,
      rows: results,
    },
  }
}

/**
 * 单房写入（无换表）；调用方已确认可导入
 */
async function settleOneRoom(pool, reqCtx, { roomCode, tjDate, cStar, cThis }) {
  const usedElectric = cThis - cStar
  if (!Number.isFinite(usedElectric) || usedElectric < 0) {
    throw new Error('用电量不合法')
  }
  const discounts = await loadOccupantDiscounts(pool, roomCode)
  if (!discounts.length) {
    throw new Error('该房间当前无在住人员，无法核算')
  }
  const discountTotal = discounts.reduce((s, d) => s + d, 0)
  const totalMoney = Math.round(usedElectric * PRICE * 100) / 100
  const { uidStr, unameLegacy, nowStr, ipStr } = reqCtx

  const alt = tjDateAltOf(tjDate)
  const del = pool.request()
  del.input('room_code', sql.NVarChar(50), roomCode)
  del.input('tj_date', sql.NVarChar(50), tjDate)
  del.input('tj_date_alt', sql.NVarChar(50), alt)
  await del.query(`
    DELETE FROM ${HR_ROOM_USE_FROM}
    WHERE LTRIM(RTRIM(ISNULL(room_code, N''))) = @room_code
      AND (
        LTRIM(RTRIM(ISNULL(tj_date, N''))) = @tj_date
        OR (@tj_date_alt IS NOT NULL AND LTRIM(RTRIM(ISNULL(tj_date, N''))) = @tj_date_alt)
      )
  `)

  const ins = pool.request()
  ins.input('room_code', sql.NVarChar(50), roomCode)
  ins.input('tj_date', sql.NVarChar(50), tjDate)
  ins.input('c_star', sql.NVarChar(50), String(cStar))
  ins.input('c_old_end', sql.NVarChar(50), null)
  ins.input('c_new_star', sql.NVarChar(50), null)
  ins.input('c_this', sql.NVarChar(50), String(cThis))
  ins.input('c_change', sql.NVarChar(50), '0')
  ins.input('c_electric', sql.NVarChar(50), String(usedElectric))
  ins.input('c_money', sql.NVarChar(50), String(PRICE))
  ins.input('c_yh_electric', sql.NVarChar(50), String(discountTotal))
  ins.input('c_sum_money', sql.NVarChar(50), String(totalMoney))
  ins.input('c_date', sql.NVarChar(50), nowStr)
  ins.input('uid', sql.NVarChar(50), uidStr || null)
  ins.input('uname', sql.NVarChar(50), unameLegacy || null)
  ins.input('addtime', sql.NVarChar(50), nowStr)
  ins.input('ip', sql.NVarChar(50), ipStr)

  const insRs = await ins.query(`
    INSERT INTO ${HR_ROOM_USE_FROM} (
      room_code, tj_date,
      c_star, c_old_end, c_new_star, c_this, c_change, c_electric, c_money, c_yh_electric, c_sum_money, c_date,
      uid, uname, addtime, ip,
      del, pass
    )
    VALUES (
      @room_code, @tj_date,
      @c_star, @c_old_end, @c_new_star, @c_this, @c_change, @c_electric, @c_money, @c_yh_electric, @c_sum_money, @c_date,
      @uid, @uname, @addtime, @ip,
      N'0', N'1'
    );
    SELECT SCOPE_IDENTITY() AS id;
  `)
  return {
    id: Number(insRs.recordset?.[0]?.id ?? 0),
    room_code: roomCode,
    used_electric: usedElectric,
    total_money: totalMoney,
  }
}

/**
 * 确认导入：重新校验后写入 ok / overwrite 行
 */
export async function importElectricBatch(pool, reqCtx, { tj_date, fileBase64, fileName }, writeLogFn) {
  const preview = await previewElectricBatch(pool, { tj_date, fileBase64, fileName })
  if (!preview.ok) return preview

  const toWrite = (preview.data.rows ?? []).filter((r) => r.status === 'ok' || r.status === 'overwrite')
  if (!toWrite.length) {
    return { ok: false, status: 400, msg: '没有可导入的行（请先修正跳过项或确认解析结果）', data: preview.data }
  }

  const imported = []
  const failed = []

  for (const row of toWrite) {
    try {
      const saved = await settleOneRoom(pool, reqCtx, {
        roomCode: row.room_code,
        tjDate: preview.data.tj_date,
        cStar: Number(row.c_star_num),
        cThis: Number(row.c_this_num),
      })
      imported.push({
        excelRow: row.excelRow,
        room_code: row.room_code,
        status: row.status,
        id: saved.id,
        used_electric: saved.used_electric,
        total_money: saved.total_money,
      })
      if (typeof writeLogFn === 'function') {
        await writeLogFn(
          '电费核算',
          `管理员 [${reqCtx.unameLegacy || '未知'}] 完成了 [${row.room_code}] 的电费核算（一键录入${row.status === 'overwrite' ? '·覆盖' : ''}）`,
        )
      }
    } catch (e) {
      failed.push({
        excelRow: row.excelRow,
        room_code: row.room_code,
        reason: String(e?.message ?? e),
      })
    }
  }

  return {
    ok: true,
    data: {
      tj_date: preview.data.tj_date,
      imported_count: imported.length,
      failed_count: failed.length,
      imported,
      failed,
      preview_summary: preview.data.summary,
    },
  }
}
