/**
 * 物料单 → 外协清单报表（只读）
 * 口径：销售订单主从 + UB_ERP_Bom_pi_cost（kcaa13=1 / isok=1），CUT 匹配置换片位置与皮名。
 */
import sql from 'mssql'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import { SALES_ORDER_HEADER_TABLE } from './salesOrderListQuery.js'
import { formatMaterialBillColorDisplay } from './salesOrderMaterialBillService.js'

const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'
const BOM_SALES_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'

const LEATHER_STRIP_TOKENS = ['主皮色', '副皮色', '主皮', '副皮']

/**
 * 清洗裁片名 / 材料名中的「主皮色、主皮、副皮色、副皮」等字样后再匹配。
 * @param {unknown} text
 */
export function stripLeatherTokensForMatch(text) {
  let s = String(text ?? '').trim()
  if (!s) return ''
  for (const token of LEATHER_STRIP_TOKENS) {
    s = s.split(token).join('')
  }
  return s.trim()
}

/**
 * 位置列：裁片名按空格取第一段；无空格则全名。
 * @param {unknown} cutName
 */
export function formatCutPosition(cutName) {
  const name = String(cutName ?? '').trim()
  if (!name) return '-'
  const sp = name.indexOf(' ')
  if (sp < 0) return name
  const first = name.slice(0, sp).trim()
  return first || name
}

/**
 * 裁片物料皮名及颜色：「描述或名称 + 物料编码」。
 * @param {{ Describe?: unknown, kcaa02?: unknown, kcaa01?: unknown } | null | undefined} child
 */
export function formatCutLeatherLabel(child) {
  if (!child) return '-'
  const code = String(child.kcaa01 ?? '').trim()
  const desc = String(child.Describe ?? '').trim()
  const name = String(child.kcaa02 ?? '').trim()
  const label = desc || name
  if (!label && !code) return '-'
  if (label && code) return `${label} ${code}`
  return label || code
}

/**
 * 用外协材料名称/规格模糊匹配 CUT 裁片名。
 * @param {{ kcaa02?: unknown, kcaa03?: unknown }} material
 * @param {{ kcaa02?: unknown, systemcode?: unknown, kcaa01?: unknown }[]} cutRows
 */
export function matchCutForOutsourcingMaterial(material, cutRows) {
  const list = Array.isArray(cutRows) ? cutRows : []
  const nameKey = stripLeatherTokensForMatch(material?.kcaa02)
  const specKey = stripLeatherTokensForMatch(material?.kcaa03)
  if (!nameKey && !specKey) return null
  for (const cut of list) {
    const cutKey = stripLeatherTokensForMatch(cut?.kcaa02)
    if (!cutKey) continue
    if (nameKey && (cutKey.includes(nameKey) || nameKey.includes(cutKey))) return cut
    if (specKey && (cutKey.includes(specKey) || specKey.includes(cutKey))) return cut
  }
  return null
}

/**
 * 按物料维合并：编码+颜色+名称+规格，SUM(kcac06) 为单个用量。
 * @param {Array<Record<string, unknown>>} costRows
 * @param {number} orderQty
 */
export function aggregateOutsourcingMaterials(costRows, orderQty) {
  const qty = Number(orderQty)
  const safeQty = Number.isFinite(qty) ? qty : 0
  /** @type {Map<string, { kcaa01: string, kcaa02: string, kcaa03: string, kcaa11: string, unit: string, unitUsage: number, px: number | null }>} */
  const map = new Map()
  /** @type {string[]} */
  const order = []
  for (const row of Array.isArray(costRows) ? costRows : []) {
    const kcaa01 = String(row?.kcaa01 ?? '').trim()
    if (!kcaa01) continue
    const kcaa02 = String(row?.kcaa02 ?? '').trim()
    const kcaa03 = String(row?.kcaa03 ?? '').trim()
    const kcaa11 = formatMaterialBillColorDisplay(row?.kcaa11, row?.colorName)
    const unitRaw = String(row?.kcac03 ?? '').trim() || String(row?.kcaa04 ?? '').trim()
    const usage = Number(row?.kcac06 ?? 0)
    const safeUsage = Number.isFinite(usage) ? usage : 0
    const pxRaw = row?.px
    let px = null
    if (pxRaw != null && pxRaw !== '') {
      const n = Number(pxRaw)
      if (Number.isFinite(n)) px = n
    }
    const key = `${kcaa01}\u0000${kcaa11}\u0000${kcaa02}\u0000${kcaa03}`
    let target = map.get(key)
    if (!target) {
      target = {
        kcaa01,
        kcaa02,
        kcaa03,
        kcaa11,
        unit: unitRaw,
        unitUsage: 0,
        px,
      }
      map.set(key, target)
      order.push(key)
    } else {
      if (!target.unit && unitRaw) target.unit = unitRaw
      if (target.px == null && px != null) target.px = px
      else if (target.px != null && px != null && px < target.px) target.px = px
    }
    target.unitUsage += safeUsage
  }
  const merged = order.map((key) => {
    const row = map.get(key)
    const unitUsage = Math.round((row?.unitUsage ?? 0) * 1e6) / 1e6
    const totalQty = Math.round(unitUsage * safeQty * 1e6) / 1e6
    return {
      kcaa01: row?.kcaa01 ?? '',
      kcaa02: row?.kcaa02 ?? '',
      kcaa03: row?.kcaa03 ?? '',
      kcaa11: row?.kcaa11 ?? '',
      unit: row?.unit ?? '',
      unitUsage,
      totalQty,
      px: row?.px ?? null,
      position: '-',
      cutLeather: '-',
    }
  })
  merged.sort((a, b) => {
    const pa = a.px
    const pb = b.px
    if (pa != null || pb != null) {
      if (pa == null) return 1
      if (pb == null) return -1
      if (pa !== pb) return pa - pb
    }
    return String(a.kcaa01).localeCompare(String(b.kcaa01), 'zh-Hans-CN')
  })
  return merged
}

/**
 * 给合并后的材料行补位置 / 裁片皮名。
 * @param {ReturnType<typeof aggregateOutsourcingMaterials>} materials
 * @param {{ kcaa02?: unknown, systemcode?: unknown, kcaa01?: unknown }[]} cutRows
 * @param {Map<string, Array<{ kcaa01?: unknown, kcaa02?: unknown, Describe?: unknown }>>} childrenByCutSystemcode
 */
export function attachCutInfoToMaterials(materials, cutRows, childrenByCutSystemcode) {
  const childMap = childrenByCutSystemcode instanceof Map ? childrenByCutSystemcode : new Map()
  return (Array.isArray(materials) ? materials : []).map((row) => {
    const cut = matchCutForOutsourcingMaterial(row, cutRows)
    if (!cut) {
      return { ...row, position: '-', cutLeather: '-' }
    }
    const position = formatCutPosition(cut.kcaa02)
    const sys = String(cut.systemcode ?? '').trim()
    const children = sys ? childMap.get(sys) ?? [] : []
    const firstChild = children[0] ?? null
    return {
      ...row,
      position,
      cutLeather: formatCutLeatherLabel(firstChild),
    }
  })
}

/**
 * @param {unknown} raw
 * @returns {string} yyyy-mm-dd or ''
 */
export function normalizeOutsourcingListDate(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  return `${m[1]}-${m[2]}-${m[3]}`
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
export async function fetchOutsourcingMaterialList(pool, filters) {
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

  // 日期比较：优先按字符串 yyyy-mm-dd 形态直比（与库内存放一致）；失败再 CAST 兼容
  const headerLinesR = await req.query(`
    SELECT
      h.[id] AS orderId,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj06], N'')))) AS poNo,
      h.[xsaj02] AS salesDate,
      l.[id] AS lineId,
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
  /** @type {Set<string>} */
  const pqSet = new Set()

  for (const row of rawPairs) {
    const pi = normKcaa01(row.piNo)
    if (!pi) continue
    const factoryStyleNo = normKcaa01(row.factoryStyleNo)
    if (factoryStyleNo) pqSet.add(factoryStyleNo)
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

  // 批量拉外协材料（按 sid IN）
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
      AND ISNULL(c.[kcaa13], 0) = 1
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

  // CUT 与下级皮料
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
    // 分批 IN，避免参数过多
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

  const list = piOrder.map((pi) => {
    const group = piMap.get(pi)
    const products = (group?.products ?? []).map((p) => {
      const factoryStyleNo = String(p.factoryStyleNo ?? '').trim()
      const key = `${pi}\u0000${factoryStyleNo}`
      const costRows = costByPiPq.get(key) ?? []
      const cutRows = cutsByPiPq.get(key) ?? []
      const materials = attachCutInfoToMaterials(
        aggregateOutsourcingMaterials(costRows, p.orderQty),
        cutRows,
        childrenByCutSystemcode,
      )
      return {
        factoryStyleNo,
        customerStyleNo: p.customerStyleNo,
        groupName: p.groupName,
        orderQty: Number.isFinite(Number(p.orderQty)) ? Number(p.orderQty) : 0,
        materials,
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
