/**
 * 物料单 → 位置裁片清单报表（只读，含非外协）
 * Part1：UB_ERP_Bom_pi_cost（isok=1，不限 kcaa13）+ CUT 匹配（复用外协清单口径）
 * Part2：UB_ERP_Bom_Sales_list 销售明细下级且 kcaa13=1，追加在 Part1 后；位置/皮名固定 -
 */
import sql from 'mssql'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import { SALES_ORDER_HEADER_TABLE } from './salesOrderListQuery.js'
import { formatMaterialBillColorDisplay } from './salesOrderMaterialBillService.js'
import {
  aggregateOutsourcingMaterials,
  attachCutInfoToMaterials,
  normalizeOutsourcingListDate,
} from './salesOrderOutsourcingListService.js'

const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'
const BOM_SALES_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'

/**
 * Part2：销售 BOM 下级 kcaa13=1，按 seq 展示；不去重；位置/皮名固定 -。
 * @param {Array<Record<string, unknown>>} bomRows
 * @param {number} orderQty
 */
export function buildBomSupplementMaterials(bomRows, orderQty) {
  const qty = Number(orderQty)
  const safeQty = Number.isFinite(qty) ? qty : 0
  const list = Array.isArray(bomRows) ? bomRows : []
  return list
    .map((row) => {
      const kcaa01 = String(row?.kcaa01 ?? '').trim()
      if (!kcaa01) return null
      const usage = Number(row?.kcac04 ?? 0)
      const unitUsage = Number.isFinite(usage) ? Math.round(usage * 1e6) / 1e6 : 0
      const totalQty = Math.round(unitUsage * safeQty * 1e6) / 1e6
      return {
        kcaa01,
        kcaa02: String(row?.kcaa02 ?? '').trim(),
        kcaa03: String(row?.kcaa03 ?? '').trim(),
        kcaa11: formatMaterialBillColorDisplay(row?.kcaa11, row?.colorName),
        unit: String(row?.kcaa04 ?? '').trim(),
        unitUsage,
        totalQty,
        px: null,
        position: '-',
        cutLeather: '-',
        source: 'bom_supplement',
      }
    })
    .filter(Boolean)
}

/**
 * 两段材料合并：先 Part1 再追加 Part2；合计 = 全部行 totalQty 之和。
 * @param {ReturnType<typeof aggregateOutsourcingMaterials>} part1
 * @param {ReturnType<typeof buildBomSupplementMaterials>} part2
 */
export function mergeCutPositionMaterials(part1, part2) {
  const materials = [
    ...(Array.isArray(part1) ? part1 : []).map((row) => ({
      ...row,
      source: row?.source ?? 'pi_cost',
    })),
    ...(Array.isArray(part2) ? part2 : []),
  ]
  let materialsTotalQty = 0
  for (const row of materials) {
    const n = Number(row?.totalQty ?? 0)
    if (Number.isFinite(n)) materialsTotalQty += n
  }
  materialsTotalQty = Math.round(materialsTotalQty * 1e6) / 1e6
  return { materials, materialsTotalQty }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 */
async function ensureSalesOrderClosedColumn(pool) {
  const r = await pool
    .request()
    .input('t', sql.NVarChar(200), SALES_ORDER_HEADER_TABLE)
    .input('c', sql.NVarChar(200), 'Closed')
    .query(`
      SELECT COUNT(1) AS total
      FROM INFORMATION_SCHEMA.COLUMNS AS c
      WHERE c.TABLE_NAME = @t
        AND LOWER(c.COLUMN_NAME) = LOWER(@c)
    `)
  return Number(r.recordset?.[0]?.total ?? 0) > 0
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ startDate: string, endDate: string, piNo?: string, poNo?: string }} filters
 */
export async function fetchCutPositionMaterialList(pool, filters) {
  const startDate = normalizeOutsourcingListDate(filters?.startDate)
  const endDate = normalizeOutsourcingListDate(filters?.endDate)
  if (!startDate || !endDate) {
    return { ok: false, status: 400, msg: '统计开始日期和统计结束日期不能为空' }
  }
  if (startDate > endDate) {
    return { ok: false, status: 400, msg: '统计开始日期不能晚于统计结束日期' }
  }

  const piNo = normKcaa01(filters?.piNo)
  const poNo = String(filters?.poNo ?? '').trim()
  const hasClosed = await ensureSalesOrderClosedColumn(pool)
  const closedExpr = hasClosed
    ? `(ISNULL(LTRIM(RTRIM(CONVERT(nvarchar(50), h.[Closed]))), N'') = N'' OR LTRIM(RTRIM(CONVERT(nvarchar(50), h.[Closed]))) = N'0')`
    : `1=1`

  const startDt = `${startDate} 00:00:00`
  const endDt = `${endDate} 23:59:59`

  const req = pool
    .request()
    .input('startDt', sql.NVarChar(30), startDt)
    .input('endDt', sql.NVarChar(30), endDt)
  let piFilter = ''
  let poFilter = ''
  if (piNo) {
    req.input('piNo', sql.NVarChar(200), piNo)
    piFilter = `AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) = @piNo`
  }
  if (poNo) {
    req.input('poNo', sql.NVarChar(200), poNo)
    poFilter = `AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj06], N'')))) = @poNo`
  }

  const headerLinesR = await req.query(`
    SELECT
      h.[id] AS orderId,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj06], N'')))) AS poNo,
      h.[xsaj02] AS salesDate,
      l.[id] AS lineId,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) AS xsak01,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[xsak02], N'')))) AS xsak02,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS factoryStyleNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa06], N'')))) AS customerStyleNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa10], N'')))) AS groupName,
      CAST(ISNULL(l.[xsak03], l.[plan_quantity]) AS decimal(18, 4)) AS orderQty,
      ISNULL(l.[seq], l.[id]) AS lineSeq
    FROM ${HEADER_FROM} AS h
    INNER JOIN ${LINE_FROM} AS l
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) =
         LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N''))))
    WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
      AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
      AND ${closedExpr}
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      AND (
        (
          LEN(LTRIM(RTRIM(CONVERT(nvarchar(30), ISNULL(h.[xsaj02], N''))))) >= 10
          AND LEFT(LTRIM(RTRIM(CONVERT(nvarchar(30), h.[xsaj02]))), 10) >= LEFT(@startDt, 10)
          AND LEFT(LTRIM(RTRIM(CONVERT(nvarchar(30), h.[xsaj02]))), 10) <= LEFT(@endDt, 10)
        )
        OR (
          ISDATE(CONVERT(nvarchar(30), h.[xsaj02])) = 1
          AND CONVERT(datetime, h.[xsaj02]) >= CONVERT(datetime, @startDt)
          AND CONVERT(datetime, h.[xsaj02]) <= CONVERT(datetime, @endDt)
        )
      )
      ${piFilter}
      ${poFilter}
    ORDER BY h.[id] ASC, ISNULL(l.[seq], l.[id]) ASC
  `)

  const rawPairs = headerLinesR.recordset ?? []
  if (!rawPairs.length) {
    return { ok: true, list: [] }
  }

  /** @type {Map<string, { orderId: number, piNo: string, poNo: string, salesDate: unknown, products: Array<Record<string, unknown>> }>} */
  const piMap = new Map()
  /** @type {string[]} */
  const piOrder = []
  /** @type {Set<string>} */
  const piSet = new Set()
  /** @type {Array<{ xsak01: string, xsak02: string }>} */
  const parentKeys = []

  for (const row of rawPairs) {
    const pi = normKcaa01(row.piNo)
    if (!pi) continue
    const factoryStyleNo = normKcaa01(row.factoryStyleNo)
    const xsak01 = String(row.xsak01 ?? '').trim() || pi
    const xsak02 = String(row.xsak02 ?? '').trim()
    if (xsak01 && xsak02) {
      parentKeys.push({ xsak01, xsak02 })
    }
    piSet.add(pi)
    let group = piMap.get(pi)
    if (!group) {
      group = {
        orderId: Number(row.orderId),
        piNo: pi,
        poNo: String(row.poNo ?? '').trim(),
        salesDate: row.salesDate ?? null,
        products: [],
      }
      piMap.set(pi, group)
      piOrder.push(pi)
    }
    group.products.push({
      lineId: Number(row.lineId),
      xsak01,
      xsak02,
      factoryStyleNo,
      customerStyleNo: String(row.customerStyleNo ?? '').trim(),
      groupName: String(row.groupName ?? '').trim(),
      orderQty: Number(row.orderQty ?? 0),
      lineSeq: Number(row.lineSeq ?? 0),
    })
  }

  const piList = [...piSet]
  if (!piList.length) {
    return { ok: true, list: [] }
  }

  // Part1：pi_cost 全材料（不限 kcaa13）
  const costReq = pool.request()
  const piParams = piList.map((pi, i) => {
    const name = `pi${i}`
    costReq.input(name, sql.NVarChar(200), pi)
    return `@${name}`
  })
  const costR = await costReq.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))) AS sid,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) AS pq,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa03], N'')))) AS kcaa03,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[kcaa04], N'')))) AS kcaa04,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(c.[kcac03], N'')))) AS kcac03,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[kcaa11], N'')))) AS kcaa11,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(color.[name], N'')))) AS colorName,
      CAST(ISNULL(c.[kcac06], 0) AS decimal(18, 6)) AS kcac06,
      CASE
        WHEN c.[px] IS NULL THEN NULL
        WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), c.[px])))) = 1
          THEN CONVERT(int, LTRIM(RTRIM(CONVERT(nvarchar(100), c.[px]))))
        ELSE NULL
      END AS px
    FROM ${PI_COST_FROM} AS c
    LEFT JOIN ${COLOR_FROM} AS color
      ON LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), c.[kcaa11]), N''))) =
         LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), color.[code]), N'')))
    WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) IN (${piParams.join(',')})
      AND ISNULL(c.[isok], 0) = 1
  `)

  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const costByPiPq = new Map()
  for (const row of costR.recordset ?? []) {
    const sid = normKcaa01(row.sid)
    const pq = normKcaa01(row.pq)
    if (!sid || !pq) continue
    const key = `${sid}\u0000${pq}`
    if (!costByPiPq.has(key)) costByPiPq.set(key, [])
    costByPiPq.get(key).push(row)
  }

  // CUT 与下级（与外协清单同口径）
  const cutReq = pool.request()
  const cutPiParams = piList.map((pi, i) => {
    const name = `cpi${i}`
    cutReq.input(name, sql.NVarChar(200), pi)
    return `@${name}`
  })
  const cutR = await cutReq.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(cut.[sid], N'')))) AS sid,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(cut.[pkcaa01], N'')))) AS pkcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(cut.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(cut.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(cut.[systemcode], N'')))) AS systemcode
    FROM ${BOM_SALES_LIST_FROM} AS cut
    WHERE LTRIM(RTRIM(ISNULL(cut.[sid], N''))) IN (${cutPiParams.join(',')})
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(cut.[kcaa01], N'')))) LIKE N'CUT-%'
      AND (ISNULL(cut.[del], N'') = N'' OR cut.[del] = N'0')
  `)

  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const cutsByPiPq = new Map()
  /** @type {string[]} */
  const cutSystemcodes = []
  for (const row of cutR.recordset ?? []) {
    const sid = normKcaa01(row.sid)
    const pq = normKcaa01(row.pkcaa01)
    if (!sid) continue
    const key = `${sid}\u0000${pq}`
    if (!cutsByPiPq.has(key)) cutsByPiPq.set(key, [])
    cutsByPiPq.get(key).push(row)
    const sc = String(row.systemcode ?? '').trim()
    if (sc) cutSystemcodes.push(sc)
  }

  /** @type {Map<string, Array<{ kcaa01: string, kcaa02: string, Describe: string }>>} */
  const childrenByCutSystemcode = new Map()
  if (cutSystemcodes.length) {
    const uniqSc = [...new Set(cutSystemcodes)]
    const BATCH = 80
    for (let i = 0; i < uniqSc.length; i += BATCH) {
      const chunk = uniqSc.slice(i, i + BATCH)
      const childReq = pool.request()
      const names = chunk.map((sc, j) => {
        const name = `sc${j}`
        childReq.input(name, sql.NVarChar(100), sc)
        return `@${name}`
      })
      const childR = await childReq.query(`
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(ch.[kcac01], N'')))) AS parentSystemcode,
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(ch.[kcaa01], N'')))) AS kcaa01,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(ch.[kcaa02], N'')))) AS kcaa02,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(ch.[Describe], N'')))) AS Describe
        FROM ${BOM_SALES_LIST_FROM} AS ch
        WHERE LTRIM(RTRIM(ISNULL(ch.[kcac01], N''))) IN (${names.join(',')})
          AND (ISNULL(ch.[del], N'') = N'' OR ch.[del] = N'0')
        ORDER BY ISNULL(ch.[seq], ch.[id]) ASC, ch.[id] ASC
      `)
      for (const row of childR.recordset ?? []) {
        const parent = String(row.parentSystemcode ?? '').trim()
        if (!parent) continue
        if (!childrenByCutSystemcode.has(parent)) childrenByCutSystemcode.set(parent, [])
        childrenByCutSystemcode.get(parent).push({
          kcaa01: String(row.kcaa01 ?? '').trim(),
          kcaa02: String(row.kcaa02 ?? '').trim(),
          Describe: String(row.Describe ?? '').trim(),
        })
      }
    }
  }

  // Part2：按销售明细 xsak01 + xsak02 拉下级 kcaa13=1
  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const bomByParent = new Map()
  const uniqParents = []
  const parentSeen = new Set()
  for (const pk of parentKeys) {
    const key = `${pk.xsak01}\u0000${pk.xsak02}`
    if (parentSeen.has(key)) continue
    parentSeen.add(key)
    uniqParents.push(pk)
  }
  if (uniqParents.length) {
    const BATCH = 40
    for (let i = 0; i < uniqParents.length; i += BATCH) {
      const chunk = uniqParents.slice(i, i + BATCH)
      const bomReq = pool.request()
      const orParts = chunk.map((pk, j) => {
        bomReq.input(`sid${j}`, sql.NVarChar(200), pk.xsak01)
        bomReq.input(`p${j}`, sql.NVarChar(100), pk.xsak02)
        return `(LTRIM(RTRIM(ISNULL(b.[sid], N''))) = @sid${j} AND LTRIM(RTRIM(ISNULL(b.[kcac01], N''))) = @p${j})`
      })
      const bomR = await bomReq.query(`
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[sid], N'')))) AS sid,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcac01], N'')))) AS kcac01,
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) AS kcaa01,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa02], N'')))) AS kcaa02,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa03], N'')))) AS kcaa03,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa04], N'')))) AS kcaa04,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa11], N'')))) AS kcaa11,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(color.[name], N'')))) AS colorName,
          CAST(ISNULL(b.[kcac04], 0) AS decimal(18, 6)) AS kcac04,
          ISNULL(b.[seq], b.[id]) AS seq
        FROM ${BOM_SALES_LIST_FROM} AS b
        LEFT JOIN ${COLOR_FROM} AS color
          ON LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), b.[kcaa11]), N''))) =
             LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), color.[code]), N'')))
        WHERE (${orParts.join(' OR ')})
          AND ISNULL(b.[kcaa13], 0) = 1
          AND (ISNULL(b.[del], N'') = N'' OR b.[del] = N'0')
        ORDER BY ISNULL(b.[seq], b.[id]) ASC, b.[id] ASC
      `)
      for (const row of bomR.recordset ?? []) {
        const sid = String(row.sid ?? '').trim()
        const parent = String(row.kcac01 ?? '').trim()
        if (!sid || !parent) continue
        const key = `${sid}\u0000${parent}`
        if (!bomByParent.has(key)) bomByParent.set(key, [])
        bomByParent.get(key).push(row)
      }
    }
  }

  const list = piOrder.map((pi) => {
    const group = piMap.get(pi)
    const products = (group?.products ?? []).map((p) => {
      const factoryStyleNo = String(p.factoryStyleNo ?? '').trim()
      const costKey = `${pi}\u0000${factoryStyleNo}`
      const costRows = costByPiPq.get(costKey) ?? []
      const cutRows = cutsByPiPq.get(costKey) ?? []
      const part1 = attachCutInfoToMaterials(
        aggregateOutsourcingMaterials(costRows, p.orderQty),
        cutRows,
        childrenByCutSystemcode,
      )
      const bomKey = `${String(p.xsak01 ?? '').trim()}\u0000${String(p.xsak02 ?? '').trim()}`
      const part2 = buildBomSupplementMaterials(bomByParent.get(bomKey) ?? [], p.orderQty)
      const { materials, materialsTotalQty } = mergeCutPositionMaterials(part1, part2)
      return {
        factoryStyleNo,
        customerStyleNo: p.customerStyleNo,
        groupName: p.groupName,
        orderQty: Number.isFinite(Number(p.orderQty)) ? Number(p.orderQty) : 0,
        materials,
        materialsTotalQty,
      }
    })
    return {
      orderId: group?.orderId ?? 0,
      piNo: pi,
      poNo: group?.poNo ?? '',
      salesDate: group?.salesDate ?? null,
      products,
    }
  })

  return { ok: true, list }
}
