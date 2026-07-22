/**
 * 仓库编码（UB_ERP_Stocks_warehouse）API
 * - 列表/详情/增改/审反审/批量审/软删/恢复/参管人选
 * - SQL Server 2008 R2：ROW_NUMBER 分页；定位键 systemcode
 * - 本期不做 Excel 导入、打印、物理删除
 */
import crypto from 'node:crypto'
import { sql } from './db.js'
import { clampErpPageSize } from './erpPagination.js'
import { getActorAuditTripletFromReq } from './businessAuditFields.js'
import { getRequestIp } from './operationAuditMiddleware.js'

const WH_FROM = 'dbo.[UB_ERP_Stocks_warehouse]'
const USER_FROM = 'dbo.[UB_ERP_User]'
const AUDIT_LOCK_MSG = '该记录已审核锁定，请反审后再操作'

function escapeSqlLikePattern(s) {
  return String(s ?? '')
    .replace(/\[/g, '[[]')
    .replace(/%/g, '[%]')
    .replace(/_/g, '[_]')
}

/** 业务时间串：2026-4-23 11:44:51（月日不补零） */
function formatBizTimestamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function passIsAudited(passVal) {
  return String(passVal ?? '').trim() === '1'
}

function rowIsActive(row) {
  if (!row) return false
  const d = String(row.del ?? '').trim()
  return d === '' || d === '0'
}

function to01(v, fallback = 0) {
  const n = Number(v)
  if (n === 1) return 1
  if (n === 0) return 0
  const s = String(v ?? '').trim()
  if (s === '1') return 1
  if (s === '0') return 0
  return fallback
}

/** 生成唯一 systemcode（对齐旧库风格：年份 + 十六进制，≤50） */
function generateWarehouseSystemcode() {
  const year = String(new Date().getFullYear())
  const hex = crypto.randomBytes(16).toString('hex').toUpperCase()
  return `${year}${hex}`.slice(0, 50)
}

function mapWarehouseRow(row) {
  if (!row) return null
  return {
    id: row.id != null ? Number(row.id) : null,
    systemcode: row.systemcode != null ? String(row.systemcode) : '',
    code: row.code != null ? String(row.code) : '',
    name: row.name != null ? String(row.name) : '',
    info2: row.info2 != null ? String(row.info2) : '',
    negative: to01(row.negative, 0),
    pd: to01(row.pd, 0),
    ks: to01(row.ks, 0),
    ename: row.ename != null ? String(row.ename) : '',
    etname: row.etname != null ? String(row.etname) : '',
    managerNames: row.managerNames != null ? String(row.managerNames) : '',
    logo: row.logo != null ? String(row.logo) : '',
    info: row.info != null ? String(row.info) : '',
    pass: row.pass != null ? String(row.pass).trim() : '',
    del: row.del != null ? String(row.del).trim() : '',
    addtime: row.addtime != null ? String(row.addtime) : '',
    edittime: row.edittime != null ? String(row.edittime) : '',
  }
}

const SELECT_COLS = `
  w.id AS id,
  LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.systemcode, N'')))) AS systemcode,
  LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.code, N'')))) AS code,
  LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.name, N'')))) AS name,
  LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.info2, N'')))) AS info2,
  ISNULL(w.negative, 0) AS negative,
  ISNULL(w.pd, 0) AS pd,
  ISNULL(w.ks, 0) AS ks,
  LTRIM(RTRIM(CONVERT(nvarchar(2000), ISNULL(w.ename, N'')))) AS ename,
  LTRIM(RTRIM(CONVERT(nvarchar(3000), ISNULL(w.etname, N'')))) AS etname,
  LTRIM(RTRIM(CONVERT(nvarchar(800), ISNULL(w.logo, N'')))) AS logo,
  LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(w.info, N'')))) AS info,
  LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.pass, N'')))) AS pass,
  LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.del, N'')))) AS del,
  LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.addtime, N'')))) AS addtime,
  LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.edittime, N'')))) AS edittime
`

/**
 * @param {import('mssql').ConnectionPool|import('mssql').Transaction} poolOrTx
 * @param {string} systemcodeRaw
 */
async function fetchWarehouseBySystemcode(poolOrTx, systemcodeRaw) {
  const systemcode = String(systemcodeRaw ?? '').trim()
  if (!systemcode) return null
  const req = poolOrTx.request()
  req.input('systemcode', sql.NVarChar(50), systemcode)
  const r = await req.query(`
    SELECT TOP (1) ${SELECT_COLS}
    FROM ${WH_FROM} AS w
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.systemcode, N'')))) = @systemcode
  `)
  return r.recordset?.[0] ?? null
}

/**
 * 按 ename 分号串批量解析参管人员姓名（Usercode → truename）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string[]} enameList
 * @returns {Promise<Map<string, string>>}
 */
async function batchResolveManagerNames(pool, enameList) {
  const resultMap = new Map()
  const codeSet = new Set()
  const parsed = []

  for (const raw of enameList) {
    const ename = String(raw ?? '').trim()
    const codes = ename
      ? ename.split(';').map((s) => s.trim()).filter(Boolean)
      : []
    parsed.push({ ename, codes })
    for (const c of codes) codeSet.add(c)
  }

  /** @type {Map<string, string>} */
  const codeToName = new Map()
  const codes = [...codeSet]
  if (codes.length) {
    const req = pool.request()
    const placeholders = []
    codes.forEach((c, i) => {
      const key = `c${i}`
      placeholders.push(`@${key}`)
      req.input(key, sql.NVarChar(50), c)
    })
    const r = await req.query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(u.Usercode, N'')))) AS usercode,
        LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(u.truename, N'')))) AS truename
      FROM ${USER_FROM} AS u
      WHERE (ISNULL(u.del, N'') = N'' OR u.del = N'0')
        AND LTRIM(RTRIM(ISNULL(u.pass, N''))) = N'1'
        AND LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(u.Usercode, N'')))) IN (${placeholders.join(',')})
    `)
    for (const row of r.recordset ?? []) {
      const code = String(row.usercode ?? '').trim()
      const name = String(row.truename ?? '').trim()
      if (code) codeToName.set(code, name || code)
    }
  }

  for (const item of parsed) {
    if (!item.ename) {
      resultMap.set(item.ename, '')
      continue
    }
    const names = item.codes
      .map((c) => codeToName.get(c) || c)
      .filter(Boolean)
    resultMap.set(item.ename, names.join(','))
  }
  return resultMap
}

/**
 * @param {import('express').Express} app
 * @param {{ getPool: Function }} deps
 */
export function registerWarehouseRoutes(app, deps) {
  const { getPool } = deps

  /**
   * GET /api/inventory/warehouse/list
   * query: page, pageSize, pass(0|1), recycled(1), keyword
   */
  app.get('/api/inventory/warehouse/list', async (req, res) => {
    try {
      const pool = await getPool()
      const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
      const pageSize = clampErpPageSize(Number(req.query?.pageSize ?? 20) || 20, 20)

      const recycledRaw = String(req.query?.recycled ?? '').trim().toLowerCase()
      const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'
      const passRaw = String(req.query?.pass ?? '1').trim()
      const pass = passRaw === '0' ? '0' : '1'

      const keywordRaw = String(req.query?.keyword ?? '').trim()
      const hasKeyword = keywordRaw.length > 0
      const kwPat = hasKeyword ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''

      const whereSql = recycled
        ? `
        WHERE LTRIM(RTRIM(ISNULL(w.del, N''))) = N'1'
        ${hasKeyword ? ' AND (w.code LIKE @kw OR w.name LIKE @kw OR w.info LIKE @kw OR w.ename LIKE @kw) ' : ''}
      `
        : `
        WHERE (ISNULL(w.del, N'') = N'' OR w.del = N'0')
          AND LTRIM(RTRIM(ISNULL(w.pass, N''))) = @pass
        ${hasKeyword ? ' AND (w.code LIKE @kw OR w.name LIKE @kw OR w.info LIKE @kw OR w.ename LIKE @kw) ' : ''}
      `

      const countReq = pool.request()
      if (!recycled) countReq.input('pass', sql.NVarChar(10), pass)
      if (hasKeyword) countReq.input('kw', sql.NVarChar(200), kwPat)
      const totalRow = await countReq.query(`
        SELECT COUNT(1) AS total
        FROM ${WH_FROM} AS w
        ${whereSql}
      `)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)

      const safeOffset = (page - 1) * pageSize
      const startRow = safeOffset + 1
      const endRow = safeOffset + pageSize

      const listReq = pool.request()
      if (!recycled) listReq.input('pass', sql.NVarChar(10), pass)
      listReq.input('startRow', sql.Int, startRow)
      listReq.input('endRow', sql.Int, endRow)
      if (hasKeyword) listReq.input('kw', sql.NVarChar(200), kwPat)

      const listResult = await listReq.query(`
        SELECT
          x.id, x.systemcode, x.code, x.name, x.info2, x.negative, x.pd, x.ks,
          x.ename, x.etname, x.logo, x.info, x.pass, x.del, x.addtime, x.edittime
        FROM (
          SELECT
            ${SELECT_COLS},
            ROW_NUMBER() OVER (
              ORDER BY LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.code, N'')))) ASC, w.id ASC
            ) AS rn
          FROM ${WH_FROM} AS w
          ${whereSql}
        ) AS x
        WHERE x.rn BETWEEN @startRow AND @endRow
        ORDER BY x.rn
      `)

      const rawList = listResult.recordset ?? []
      const nameMap = await batchResolveManagerNames(
        pool,
        rawList.map((r) => (r.ename != null ? String(r.ename) : '')),
      )
      const list = rawList.map((row) => {
        const mapped = mapWarehouseRow(row)
        mapped.managerNames = nameMap.get(mapped.ename) || mapped.etname || ''
        return mapped
      })

      res.json({ code: 200, msg: 'success', data: { total, list, recycled } })
    } catch (err) {
      console.error('GET /api/inventory/warehouse/list 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `读取仓库编码列表失败：${detail}`, data: null })
    }
  })

  /**
   * GET /api/inventory/warehouse/user-options
   * 参管人选：del=0 pass=1；keyword 模糊 Usercode/truename
   */
  app.get('/api/inventory/warehouse/user-options', async (req, res) => {
    try {
      const pool = await getPool()
      const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
      const pageSize = clampErpPageSize(Number(req.query?.pageSize ?? 20) || 20, 20)
      const keywordRaw = String(req.query?.keyword ?? '').trim()
      const hasKeyword = keywordRaw.length > 0
      const kwPat = hasKeyword ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''

      const whereSql = `
        WHERE (ISNULL(u.del, N'') = N'' OR u.del = N'0')
          AND LTRIM(RTRIM(ISNULL(u.pass, N''))) = N'1'
          ${hasKeyword ? ' AND (u.Usercode LIKE @kw OR u.truename LIKE @kw) ' : ''}
      `

      const countReq = pool.request()
      if (hasKeyword) countReq.input('kw', sql.NVarChar(200), kwPat)
      const totalRow = await countReq.query(`
        SELECT COUNT(1) AS total FROM ${USER_FROM} AS u ${whereSql}
      `)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)

      const startRow = (page - 1) * pageSize + 1
      const endRow = (page - 1) * pageSize + pageSize
      const listReq = pool.request()
      listReq.input('startRow', sql.Int, startRow)
      listReq.input('endRow', sql.Int, endRow)
      if (hasKeyword) listReq.input('kw', sql.NVarChar(200), kwPat)

      const listResult = await listReq.query(`
        SELECT x.usercode, x.truename
        FROM (
          SELECT
            LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(u.Usercode, N'')))) AS usercode,
            LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(u.truename, N'')))) AS truename,
            ROW_NUMBER() OVER (
              ORDER BY LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(u.Usercode, N'')))) ASC, u.UserID ASC
            ) AS rn
          FROM ${USER_FROM} AS u
          ${whereSql}
        ) AS x
        WHERE x.rn BETWEEN @startRow AND @endRow
        ORDER BY x.rn
      `)

      const list = (listResult.recordset ?? [])
        .map((row) => ({
          usercode: row.usercode != null ? String(row.usercode) : '',
          truename: row.truename != null ? String(row.truename) : '',
        }))
        .filter((r) => r.usercode)

      res.json({ code: 200, msg: 'success', data: { total, list } })
    } catch (err) {
      console.error('GET /api/inventory/warehouse/user-options 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `读取参管人员失败：${detail}`, data: null })
    }
  })

  /** GET /api/inventory/warehouse/:systemcode */
  app.get('/api/inventory/warehouse/:systemcode', async (req, res) => {
    try {
      const systemcode = String(req.params.systemcode ?? '').trim()
      if (!systemcode || systemcode.toLowerCase() === 'list' || systemcode.toLowerCase() === 'user-options') {
        res.status(400).json({ code: 400, msg: 'systemcode 不合法', data: null })
        return
      }
      const pool = await getPool()
      const row = await fetchWarehouseBySystemcode(pool, systemcode)
      if (!row) {
        res.status(404).json({ code: 404, msg: '未找到该仓库编码', data: null })
        return
      }
      const mapped = mapWarehouseRow(row)
      const nameMap = await batchResolveManagerNames(pool, [mapped.ename])
      mapped.managerNames = nameMap.get(mapped.ename) || mapped.etname || ''
      res.json({ code: 200, msg: 'success', data: mapped })
    } catch (err) {
      console.error('GET /api/inventory/warehouse/:systemcode 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `读取仓库编码详情失败：${detail}`, data: null })
    }
  })

  /**
   * POST /api/inventory/warehouse
   * body: { code, name, info2?, negative?, pd?, ks?, ename?, etname?, logo?, info? }
   * code 全表唯一（含已删）
   */
  app.post('/api/inventory/warehouse', async (req, res) => {
    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    try {
      const body = req.body ?? {}
      const code = String(body.code ?? '').trim()
      const name = String(body.name ?? '').trim()
      const info2 = String(body.info2 ?? '').trim()
      const negative = to01(body.negative, 0)
      const pd = to01(body.pd, 0)
      const ks = to01(body.ks, 0)
      const ename = String(body.ename ?? '').trim()
      const etname = String(body.etname ?? '').trim()
      const logoRaw = body.logo
      const hasLogo = logoRaw !== undefined && logoRaw !== null && String(logoRaw).trim() !== ''
      const logo = hasLogo ? String(logoRaw).trim() : null
      const info = String(body.info ?? '').trim()

      if (!code) {
        res.status(400).json({ code: 400, msg: '仓库编码不能为空', data: null })
        return
      }
      if (!name) {
        res.status(400).json({ code: 400, msg: '仓库名称不能为空', data: null })
        return
      }

      const { uidInt, uname: unameVal, utruename: utruenameVal } = getActorAuditTripletFromReq(req)
      if (uidInt == null) {
        res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
        return
      }

      await tx.begin()
      const dupReq = new sql.Request(tx)
      dupReq.input('code', sql.NVarChar(50), code)
      const dupRow = await dupReq.query(`
        SELECT TOP (1)
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.name, N'')))) AS name,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.del, N'')))) AS del
        FROM ${WH_FROM} AS w
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.code, N'')))) = @code
      `)
      const exist = dupRow.recordset?.[0]
      if (exist) {
        await tx.rollback()
        const existName = String(exist.name ?? '').trim() || '（无名称）'
        const tip = String(exist.del ?? '').trim() === '1'
          ? `该仓库编码已存在（仓库名称：${existName}，已在回收站），请恢复原记录或更换编码`
          : `该仓库编码已存在（仓库名称：${existName}）`
        res.status(400).json({ code: 400, msg: tip, data: null })
        return
      }

      let systemcode = generateWarehouseSystemcode()
      for (let i = 0; i < 5; i += 1) {
        const chk = new sql.Request(tx)
        chk.input('systemcode', sql.NVarChar(50), systemcode)
        const hit = await chk.query(`
          SELECT COUNT(1) AS n FROM ${WH_FROM} AS w
          WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.systemcode, N'')))) = @systemcode
        `)
        if (Number(hit.recordset?.[0]?.n ?? 0) === 0) break
        systemcode = generateWarehouseSystemcode()
      }

      const addtimeStr = formatBizTimestamp()
      const ipStr = getRequestIp(req) || null
      const ins = new sql.Request(tx)
      ins.input('systemcode', sql.NVarChar(50), systemcode)
      ins.input('code', sql.NVarChar(50), code)
      ins.input('name', sql.NVarChar(50), name)
      ins.input('info2', sql.NVarChar(50), info2 || null)
      ins.input('negative', sql.Int, negative)
      ins.input('pd', sql.Int, pd)
      ins.input('ks', sql.Int, ks)
      ins.input('ename', sql.NVarChar(2000), ename || null)
      ins.input('etname', sql.NVarChar(3000), etname || null)
      ins.input('info', sql.NVarChar(500), info || null)
      ins.input('uid', sql.NVarChar(50), String(uidInt))
      ins.input('uname', sql.NVarChar(50), unameVal)
      ins.input('utruename', sql.NVarChar(50), utruenameVal)
      ins.input('addtime', sql.NVarChar(50), addtimeStr)
      ins.input('ip', sql.NVarChar(50), ipStr)

      if (hasLogo) {
        ins.input('logo', sql.NVarChar(800), logo)
        await ins.query(`
          INSERT INTO ${WH_FROM} (
            systemcode, code, name, info2, negative, pd, ks, ename, etname, logo, info,
            uid, uname, utruename, addtime, ip, pass, del
          ) VALUES (
            @systemcode, @code, @name, @info2, @negative, @pd, @ks, @ename, @etname, @logo, @info,
            @uid, @uname, @utruename, @addtime, @ip, N'0', N'0'
          )
        `)
      } else {
        await ins.query(`
          INSERT INTO ${WH_FROM} (
            systemcode, code, name, info2, negative, pd, ks, ename, etname, info,
            uid, uname, utruename, addtime, ip, pass, del
          ) VALUES (
            @systemcode, @code, @name, @info2, @negative, @pd, @ks, @ename, @etname, @info,
            @uid, @uname, @utruename, @addtime, @ip, N'0', N'0'
          )
        `)
      }

      await tx.commit()
      const row = await fetchWarehouseBySystemcode(pool, systemcode)
      res.json({ code: 200, msg: 'success', data: mapWarehouseRow(row) })
    } catch (err) {
      try {
        await tx.rollback()
      } catch {
        /* ignore */
      }
      console.error('POST /api/inventory/warehouse 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
      res.status(500).json({ code: 500, msg: `新增仓库编码失败：${detail}`, data: null })
    }
  })

  /**
   * PUT /api/inventory/warehouse
   * 仅未审在册可改；code 不可改；不覆盖 addtime；未交 logo 不写 logo 列
   */
  app.put('/api/inventory/warehouse', async (req, res) => {
    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    try {
      const body = req.body ?? {}
      const systemcode = String(body.systemcode ?? '').trim()
      const name = String(body.name ?? '').trim()
      const info2 = String(body.info2 ?? '').trim()
      const negative = to01(body.negative, 0)
      const pd = to01(body.pd, 0)
      const ks = to01(body.ks, 0)
      const ename = String(body.ename ?? '').trim()
      const etname = String(body.etname ?? '').trim()
      const logoRaw = body.logo
      const hasLogo = logoRaw !== undefined && logoRaw !== null
      const logo = hasLogo ? String(logoRaw).trim() : null
      const info = String(body.info ?? '').trim()

      if (!systemcode) {
        res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
        return
      }
      if (!name) {
        res.status(400).json({ code: 400, msg: '仓库名称不能为空', data: null })
        return
      }

      await tx.begin()
      const existing = await fetchWarehouseBySystemcode(tx, systemcode)
      if (!existing || !rowIsActive(existing)) {
        await tx.rollback()
        res.status(404).json({ code: 404, msg: '未找到该仓库编码或已删除', data: null })
        return
      }
      if (passIsAudited(existing.pass)) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '已审核记录不可编辑，请先反审', data: null })
        return
      }

      const edittimeStr = formatBizTimestamp()
      const ipStr = getRequestIp(req) || null
      const q = new sql.Request(tx)
      q.input('systemcode', sql.NVarChar(50), systemcode)
      q.input('name', sql.NVarChar(50), name)
      q.input('info2', sql.NVarChar(50), info2 || null)
      q.input('negative', sql.Int, negative)
      q.input('pd', sql.Int, pd)
      q.input('ks', sql.Int, ks)
      q.input('ename', sql.NVarChar(2000), ename || null)
      q.input('etname', sql.NVarChar(3000), etname || null)
      q.input('info', sql.NVarChar(500), info || null)
      q.input('edittime', sql.NVarChar(50), edittimeStr)
      q.input('ip', sql.NVarChar(50), ipStr)

      if (hasLogo) {
        q.input('logo', sql.NVarChar(800), logo || null)
        await q.query(`
          UPDATE w SET
            w.name = @name,
            w.info2 = @info2,
            w.negative = @negative,
            w.pd = @pd,
            w.ks = @ks,
            w.ename = @ename,
            w.etname = @etname,
            w.logo = @logo,
            w.info = @info,
            w.edittime = @edittime,
            w.ip = @ip
          FROM ${WH_FROM} AS w
          WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.systemcode, N'')))) = @systemcode
            AND (ISNULL(w.del, N'') = N'' OR w.del = N'0')
            AND LTRIM(RTRIM(ISNULL(w.pass, N''))) = N'0'
        `)
      } else {
        await q.query(`
          UPDATE w SET
            w.name = @name,
            w.info2 = @info2,
            w.negative = @negative,
            w.pd = @pd,
            w.ks = @ks,
            w.ename = @ename,
            w.etname = @etname,
            w.info = @info,
            w.edittime = @edittime,
            w.ip = @ip
          FROM ${WH_FROM} AS w
          WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.systemcode, N'')))) = @systemcode
            AND (ISNULL(w.del, N'') = N'' OR w.del = N'0')
            AND LTRIM(RTRIM(ISNULL(w.pass, N''))) = N'0'
        `)
      }

      await tx.commit()
      const row = await fetchWarehouseBySystemcode(pool, systemcode)
      res.json({ code: 200, msg: 'success', data: mapWarehouseRow(row) })
    } catch (err) {
      try {
        await tx.rollback()
      } catch {
        /* ignore */
      }
      console.error('PUT /api/inventory/warehouse 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
      res.status(500).json({ code: 500, msg: `保存仓库编码失败：${detail}`, data: null })
    }
  })

  /** PUT /api/inventory/warehouse/audit body:{ systemcode } */
  app.put('/api/inventory/warehouse/audit', async (req, res) => {
    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    try {
      const systemcode = String(req.body?.systemcode ?? '').trim()
      if (!systemcode) {
        res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
        return
      }
      const { uidInt, utruename: utruenameVal } = getActorAuditTripletFromReq(req)
      if (uidInt == null) {
        res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
        return
      }

      await tx.begin()
      const existing = await fetchWarehouseBySystemcode(tx, systemcode)
      if (!existing || !rowIsActive(existing)) {
        await tx.rollback()
        res.status(404).json({ code: 404, msg: '未找到该仓库编码或已删除', data: null })
        return
      }
      if (passIsAudited(existing.pass)) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '当前已是已审核状态', data: null })
        return
      }

      const q = new sql.Request(tx)
      q.input('systemcode', sql.NVarChar(50), systemcode)
      q.input('passuid', sql.NVarChar(50), String(uidInt))
      q.input('passuname', sql.NVarChar(50), utruenameVal)
      await q.query(`
        UPDATE w SET
          w.pass = N'1',
          w.passuid = @passuid,
          w.passuname = @passuname
        FROM ${WH_FROM} AS w
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.systemcode, N'')))) = @systemcode
          AND (ISNULL(w.del, N'') = N'' OR w.del = N'0')
          AND LTRIM(RTRIM(ISNULL(w.pass, N''))) = N'0'
      `)
      await tx.commit()
      const row = await fetchWarehouseBySystemcode(pool, systemcode)
      res.json({ code: 200, msg: 'success', data: mapWarehouseRow(row) })
    } catch (err) {
      try {
        await tx.rollback()
      } catch {
        /* ignore */
      }
      console.error('PUT /api/inventory/warehouse/audit 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
      res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
    }
  })

  /** PUT /api/inventory/warehouse/unaudit body:{ systemcode } */
  app.put('/api/inventory/warehouse/unaudit', async (req, res) => {
    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    try {
      const systemcode = String(req.body?.systemcode ?? '').trim()
      if (!systemcode) {
        res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
        return
      }
      const { uidInt, utruename: utruenameVal } = getActorAuditTripletFromReq(req)
      if (uidInt == null) {
        res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
        return
      }

      await tx.begin()
      const existing = await fetchWarehouseBySystemcode(tx, systemcode)
      if (!existing || !rowIsActive(existing)) {
        await tx.rollback()
        res.status(404).json({ code: 404, msg: '未找到该仓库编码或已删除', data: null })
        return
      }
      if (!passIsAudited(existing.pass)) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '当前为未审核状态，无需反审', data: null })
        return
      }

      const q = new sql.Request(tx)
      q.input('systemcode', sql.NVarChar(50), systemcode)
      q.input('passuid', sql.NVarChar(50), String(uidInt))
      q.input('passuname', sql.NVarChar(50), utruenameVal)
      await q.query(`
        UPDATE w SET
          w.pass = N'0',
          w.passuid = @passuid,
          w.passuname = @passuname
        FROM ${WH_FROM} AS w
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.systemcode, N'')))) = @systemcode
          AND (ISNULL(w.del, N'') = N'' OR w.del = N'0')
          AND LTRIM(RTRIM(ISNULL(w.pass, N''))) = N'1'
      `)
      await tx.commit()
      const row = await fetchWarehouseBySystemcode(pool, systemcode)
      res.json({ code: 200, msg: 'success', data: mapWarehouseRow(row) })
    } catch (err) {
      try {
        await tx.rollback()
      } catch {
        /* ignore */
      }
      console.error('PUT /api/inventory/warehouse/unaudit 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
      res.status(500).json({ code: 500, msg: `反审失败：${detail}`, data: null })
    }
  })

  /**
   * PUT /api/inventory/warehouse/audit-batch
   * 将全部 del=0 AND pass=0 审核为 pass=1
   */
  app.put('/api/inventory/warehouse/audit-batch', async (req, res) => {
    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    try {
      const { uidInt, utruename: utruenameVal } = getActorAuditTripletFromReq(req)
      if (uidInt == null) {
        res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
        return
      }

      await tx.begin()
      const cntReq = new sql.Request(tx)
      const cntRow = await cntReq.query(`
        SELECT COUNT(1) AS n
        FROM ${WH_FROM} AS w
        WHERE (ISNULL(w.del, N'') = N'' OR w.del = N'0')
          AND LTRIM(RTRIM(ISNULL(w.pass, N''))) = N'0'
      `)
      const pending = Number(cntRow.recordset?.[0]?.n ?? 0)
      if (pending < 1) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '当前没有待审核的仓库编码', data: { affected: 0 } })
        return
      }

      const q = new sql.Request(tx)
      q.input('passuid', sql.NVarChar(50), String(uidInt))
      q.input('passuname', sql.NVarChar(50), utruenameVal)
      const upd = await q.query(`
        UPDATE w SET
          w.pass = N'1',
          w.passuid = @passuid,
          w.passuname = @passuname
        FROM ${WH_FROM} AS w
        WHERE (ISNULL(w.del, N'') = N'' OR w.del = N'0')
          AND LTRIM(RTRIM(ISNULL(w.pass, N''))) = N'0'
      `)
      const affected = Array.isArray(upd.rowsAffected)
        ? Number(upd.rowsAffected[0] ?? 0)
        : Number(upd.rowsAffected ?? 0)
      await tx.commit()
      req.__auditWarehouseBatchAffected = affected
      res.json({ code: 200, msg: 'success', data: { affected } })
    } catch (err) {
      try {
        await tx.rollback()
      } catch {
        /* ignore */
      }
      console.error('PUT /api/inventory/warehouse/audit-batch 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
      res.status(500).json({ code: 500, msg: `批量审核失败：${detail}`, data: null })
    }
  })

  /** PUT /api/inventory/warehouse/restore body:{ systemcode } */
  app.put('/api/inventory/warehouse/restore', async (req, res) => {
    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    try {
      const systemcode = String(req.body?.systemcode ?? '').trim()
      if (!systemcode) {
        res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
        return
      }

      await tx.begin()
      const existing = await fetchWarehouseBySystemcode(tx, systemcode)
      if (!existing) {
        await tx.rollback()
        res.status(404).json({ code: 404, msg: '未找到该仓库编码', data: null })
        return
      }
      if (String(existing.del ?? '').trim() !== '1') {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '当前记录未处于已删除状态，无需恢复', data: null })
        return
      }

      const q = new sql.Request(tx)
      q.input('systemcode', sql.NVarChar(50), systemcode)
      await q.query(`
        UPDATE w SET w.del = N'0'
        FROM ${WH_FROM} AS w
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.systemcode, N'')))) = @systemcode
          AND LTRIM(RTRIM(ISNULL(w.del, N''))) = N'1'
      `)
      await tx.commit()
      const row = await fetchWarehouseBySystemcode(pool, systemcode)
      res.json({ code: 200, msg: 'success', data: mapWarehouseRow(row) })
    } catch (err) {
      try {
        await tx.rollback()
      } catch {
        /* ignore */
      }
      console.error('PUT /api/inventory/warehouse/restore 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
      res.status(500).json({ code: 500, msg: `恢复失败：${detail}`, data: null })
    }
  })

  /** DELETE /api/inventory/warehouse/:systemcode — 逻辑删除；已审禁止 */
  app.delete('/api/inventory/warehouse/:systemcode', async (req, res) => {
    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    try {
      const systemcode = String(req.params.systemcode ?? '').trim()
      const reserved = ['list', 'user-options', 'audit', 'unaudit', 'restore', 'audit-batch']
      if (!systemcode || reserved.includes(systemcode.toLowerCase())) {
        res.status(400).json({ code: 400, msg: 'systemcode 不合法', data: null })
        return
      }

      const { uidInt, uname: unameVal, utruename: utruenameVal } = getActorAuditTripletFromReq(req)
      if (uidInt == null) {
        res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
        return
      }

      await tx.begin()
      const existing = await fetchWarehouseBySystemcode(tx, systemcode)
      if (!existing || !rowIsActive(existing)) {
        await tx.rollback()
        res.status(404).json({ code: 404, msg: '未找到该仓库编码或已删除', data: null })
        return
      }
      if (passIsAudited(existing.pass)) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: AUDIT_LOCK_MSG, data: null })
        return
      }

      const deltimeStr = formatBizTimestamp()
      const q = new sql.Request(tx)
      q.input('systemcode', sql.NVarChar(50), systemcode)
      q.input('delid', sql.NVarChar(50), String(uidInt))
      q.input('delname', sql.NVarChar(50), unameVal)
      q.input('deltruename', sql.NVarChar(50), utruenameVal)
      q.input('deltime', sql.NVarChar(50), deltimeStr)
      await q.query(`
        UPDATE w SET
          w.del = N'1',
          w.delid = @delid,
          w.delname = @delname,
          w.deltruename = @deltruename,
          w.deltime = @deltime
        FROM ${WH_FROM} AS w
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(w.systemcode, N'')))) = @systemcode
          AND (ISNULL(w.del, N'') = N'' OR w.del = N'0')
      `)
      await tx.commit()
      // 供操作审计中间件拼可读日志
      req.__auditDeleteWarehouse = {
        systemcode: String(existing.systemcode ?? systemcode),
        code: String(existing.code ?? ''),
        name: String(existing.name ?? ''),
      }
      res.json({ code: 200, msg: 'success', data: { systemcode } })
    } catch (err) {
      try {
        await tx.rollback()
      } catch {
        /* ignore */
      }
      console.error('DELETE /api/inventory/warehouse/:systemcode 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
      res.status(500).json({ code: 500, msg: `删除失败：${detail}`, data: null })
    }
  })
}
