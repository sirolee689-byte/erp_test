/**
 * 库存统计快照：生成、列表、明细读写
 */
import { sql } from './db.js'
import { fetchStockStatsLines } from './stockStatsCalculator.js'

const SNAPSHOT_TABLE = 'UB_ERP_Stock_stats_snapshot'
const LINE_TABLE = 'UB_ERP_Stock_stats_snapshot_line'
const SNAPSHOT_FROM = `dbo.[${SNAPSHOT_TABLE}]`
const LINE_FROM = `dbo.[${LINE_TABLE}]`
const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'

function text(v) {
  return String(v ?? '').trim()
}

function parsePage(v, fallback = 1) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}

function parsePageSize(v, fallback = 20) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(1, Math.floor(n)))
}

function actorFields(actor = {}) {
  const uid = text(actor?.uid ?? actor?.userId ?? actor?.UserID)
  const uname = text(actor?.uname ?? actor?.userName)
  const truename = text(actor?.utruename ?? actor?.truename ?? actor?.userName)
  return { uid, uname, truename }
}

async function resolveWarehouseName(pool, warehouseCode) {
  const r = await pool
    .request()
    .input('code', sql.NVarChar(200), warehouseCode)
    .query(`
      SELECT TOP 1 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
      FROM ${WAREHOUSE_FROM}
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) = @code
    `)
  return text(r.recordset?.[0]?.name)
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {object} body
 * @param {object} actor
 */
export async function generateStockStatsSnapshot(pool, body = {}, actor = {}) {
  const startDate = text(body.startDate)
  const endDate = text(body.endDate)
  const warehouseCode = text(body.warehouseCode)
  const materialFilter = text(body.materialFilter)

  const calc = await fetchStockStatsLines(pool, { startDate, endDate, warehouseCode, materialFilter })
  if (!calc.ok) return calc

  const warehouseName = await resolveWarehouseName(pool, warehouseCode)
  const { uid, uname, truename } = actorFields(actor)
  const filterJson = JSON.stringify({ startDate, endDate, warehouseCode, materialFilter: materialFilter || null })
  const lines = calc.lines ?? []

  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const ins = await new sql.Request(tx)
      .input('startDate', sql.Date, startDate)
      .input('endDate', sql.Date, endDate)
      .input('warehouseCode', sql.NVarChar(200), warehouseCode)
      .input('warehouseName', sql.NVarChar(500), warehouseName)
      .input('materialFilter', sql.NVarChar(300), materialFilter || null)
      .input('rowCount', sql.Int, lines.length)
      .input('filterJson', sql.NVarChar(sql.MAX), filterJson)
      .input('uid', sql.NVarChar(50), uid || null)
      .input('uname', sql.NVarChar(100), uname || null)
      .input('truename', sql.NVarChar(100), truename || null)
      .query(`
        INSERT INTO ${SNAPSHOT_FROM} (
          [start_date], [end_date], [warehouse_code], [warehouse_name],
          [material_filter], [report_kind], [row_count], [filter_json],
          [generated_uid], [generated_uname], [generated_truename]
        )
        OUTPUT INSERTED.[id]
        VALUES (
          @startDate, @endDate, @warehouseCode, @warehouseName,
          @materialFilter, N'normal', @rowCount, @filterJson,
          @uid, @uname, @truename
        )
      `)
    const snapshotId = Number(ins.recordset?.[0]?.id)
    if (!snapshotId) throw new Error('写入快照主表失败')

    for (const line of lines) {
      await new sql.Request(tx)
        .input('snapshotId', sql.Int, snapshotId)
        .input('kcaa01', sql.NVarChar(300), line.kcaa01)
        .input('warehouseCode', sql.NVarChar(200), line.warehouseCode || warehouseCode)
        .input('kcaa02', sql.NVarChar(500), line.kcaa02 || null)
        .input('kcaa03', sql.NVarChar(500), line.kcaa03 || null)
        .input('kcaa04', sql.NVarChar(100), line.kcaa04 || null)
        .input('lastsum', sql.Decimal(18, 6), line.lastsum)
        .input('lastprice', sql.Decimal(18, 6), line.lastprice)
        .input('lastmoney', sql.Decimal(18, 2), line.lastmoney)
        .input('nowin', sql.Decimal(18, 6), line.nowin)
        .input('nowinprice', sql.Decimal(18, 6), line.nowinprice)
        .input('nowmoney', sql.Decimal(18, 2), line.nowmoney)
        .input('nowout', sql.Decimal(18, 6), line.nowout)
        .input('nowoutprice', sql.Decimal(18, 6), line.nowoutprice)
        .input('nowoutmoney', sql.Decimal(18, 2), line.nowoutmoney)
        .input('nowbs', sql.Decimal(18, 6), line.nowbs)
        .input('nowbsprice', sql.Decimal(18, 6), line.nowbsprice)
        .input('nowbsmonney', sql.Decimal(18, 2), line.nowbsmonney)
        .input('hzkcm', sql.Decimal(18, 6), line.hzkcm)
        .input('hzmoney', sql.Decimal(18, 2), line.hzmoney)
        .input('nowsum', sql.Decimal(18, 6), line.nowsum)
        .input('nowprice', sql.Decimal(18, 6), line.nowprice)
        .input('nowmoneys', sql.Decimal(18, 2), line.nowmoneys)
        .query(`
          INSERT INTO ${LINE_FROM} (
            [snapshot_id], [kcaa01], [warehouse_code], [kcaa02], [kcaa03], [kcaa04],
            [lastsum], [lastprice], [lastmoney], [nowin], [nowinprice], [nowmoney],
            [nowout], [nowoutprice], [nowoutmoney], [nowbs], [nowbsprice], [nowbsmonney],
            [hzkcm], [hzmoney], [nowsum], [nowprice], [nowmoneys]
          ) VALUES (
            @snapshotId, @kcaa01, @warehouseCode, @kcaa02, @kcaa03, @kcaa04,
            @lastsum, @lastprice, @lastmoney, @nowin, @nowinprice, @nowmoney,
            @nowout, @nowoutprice, @nowoutmoney, @nowbs, @nowbsprice, @nowbsmonney,
            @hzkcm, @hzmoney, @nowsum, @nowprice, @nowmoneys
          )
        `)
    }

    await tx.commit()
    return { ok: true, snapshotId, rowCount: lines.length }
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {object} query
 */
export async function listStockStatsSnapshots(pool, query = {}) {
  const page = parsePage(query.page)
  const pageSize = parsePageSize(query.pageSize)
  const startRow = (page - 1) * pageSize + 1
  const endRow = page * pageSize

  const r = await pool
    .request()
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
    .query(`
      WITH numbered AS (
        SELECT
          ROW_NUMBER() OVER (ORDER BY [generated_at] DESC, [id] DESC) AS rn,
          COUNT(1) OVER () AS totalCount,
          [id],
          CONVERT(varchar(10), [start_date], 120) AS startDate,
          CONVERT(varchar(10), [end_date], 120) AS endDate,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([warehouse_code], N'')))) AS warehouseCode,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([warehouse_name], N'')))) AS warehouseName,
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([material_filter], N'')))) AS materialFilter,
          [report_kind] AS reportKind,
          CONVERT(varchar(19), [generated_at], 120) AS generatedAt,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([generated_truename], N'')))) AS generatedBy,
          [row_count] AS [rowCount]
        FROM ${SNAPSHOT_FROM}
        WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
          AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
      )
      SELECT * FROM numbered
      WHERE rn BETWEEN @startRow AND @endRow
      ORDER BY rn ASC
    `)

  const rows = r.recordset ?? []
  const total = rows.length ? Number(rows[0].totalCount) : 0
  const list = rows.map(({ rn, totalCount, ...rest }) => rest)
  return { list, total, page, pageSize }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} snapshotId
 * @param {object} query
 */
export async function listStockStatsSnapshotLines(pool, snapshotId, query = {}) {
  const id = Number(snapshotId)
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, msg: '快照参数无效' }
  }

  const page = parsePage(query.page)
  const pageSize = parsePageSize(query.pageSize)
  const startRow = (page - 1) * pageSize + 1
  const endRow = page * pageSize
  const keyword = text(query.keyword)

  const req = pool.request()
  req.input('snapshotId', sql.Int, id)
  req.input('startRow', sql.Int, startRow)
  req.input('endRow', sql.Int, endRow)
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), `%${keyword}%`)
    kwSql = `AND (
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) LIKE @kw
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) LIKE @kw
    )`
  }

  const headR = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT TOP 1
        [id],
        CONVERT(varchar(10), [start_date], 120) AS startDate,
        CONVERT(varchar(10), [end_date], 120) AS endDate,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([warehouse_code], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([warehouse_name], N'')))) AS warehouseName,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([material_filter], N'')))) AS materialFilter,
        CONVERT(varchar(19), [generated_at], 120) AS generatedAt,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([generated_truename], N'')))) AS generatedBy,
        [row_count] AS [rowCount]
      FROM ${SNAPSHOT_FROM}
      WHERE [id] = @id
        AND (ISNULL([del], N'') = N'' OR [del] = N'0')
        AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
    `)
  const header = headR.recordset?.[0]
  if (!header) return { ok: false, status: 404, msg: '统计快照不存在' }

  const r = await req.query(`
    WITH numbered AS (
      SELECT
        ROW_NUMBER() OVER (ORDER BY l.[kcaa01] ASC, l.[id] ASC) AS rn,
        COUNT(1) OVER () AS totalCount,
        l.*
      FROM ${LINE_FROM} AS l
      WHERE l.[snapshot_id] = @snapshotId
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        ${kwSql}
    )
    SELECT * FROM numbered
    WHERE rn BETWEEN @startRow AND @endRow
    ORDER BY rn ASC
  `)

  const rows = r.recordset ?? []
  const total = rows.length ? Number(rows[0].totalCount) : 0
  const list = rows.map((row) => ({
    id: row.id,
    kcaa01: text(row.kcaa01),
    warehouseCode: text(row.warehouse_code),
    kcaa02: text(row.kcaa02),
    kcaa03: text(row.kcaa03),
    kcaa04: text(row.kcaa04),
    lastsum: Number(row.lastsum),
    lastprice: Number(row.lastprice),
    lastmoney: Number(row.lastmoney),
    nowin: Number(row.nowin),
    nowinprice: Number(row.nowinprice),
    nowmoney: Number(row.nowmoney),
    nowout: Number(row.nowout),
    nowoutprice: Number(row.nowoutprice),
    nowoutmoney: Number(row.nowoutmoney),
    nowbs: Number(row.nowbs),
    nowbsprice: Number(row.nowbsprice),
    nowbsmonney: Number(row.nowbsmonney),
    hzkcm: Number(row.hzkcm),
    hzmoney: Number(row.hzmoney),
    nowsum: Number(row.nowsum),
    nowprice: Number(row.nowprice),
    nowmoneys: Number(row.nowmoneys),
  }))

  return { ok: true, header, list, total, page, pageSize }
}

export async function deleteStockStatsSnapshot(pool, snapshotId) {
  const id = Number(snapshotId)
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, msg: '快照参数无效' }
  }
  const r = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      UPDATE ${SNAPSHOT_FROM}
      SET [del] = N'1'
      WHERE [id] = @id AND (ISNULL([del], N'') = N'' OR [del] = N'0')
    `)
  if (!r.rowsAffected?.[0]) return { ok: false, status: 404, msg: '统计快照不存在' }
  return { ok: true }
}

export async function fetchStockStatsWarehouseOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), `%${keyword}%`)
    kwSql = `AND (
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw
    )`
  }
  const r = await req.query(`
    SELECT TOP 100
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
    FROM ${WAREHOUSE_FROM}
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      ${kwSql}
    ORDER BY [code] ASC
  `)
  return r.recordset ?? []
}
