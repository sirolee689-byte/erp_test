/**
 * 海关单 · 预览匹配与确认生成生产入库
 * 落单复用 createStockIn；车间/仓库按名称解析包装部、成品仓。
 */
import { sql } from './db.js'
import { nvarcharTextExpr, safeDecimalExpr } from './buyOrderSqlSafe.js'
import {
  computeAssistKsum,
  computeAssistKcao031,
  parseAssistFloatRate,
} from './stockInAssistBatchAdd.js'
import { computeProductionTempx } from './stockInProductionBatchAdd.js'
import { computeKsum } from './stockInPurchaseBatchAdd.js'
import { createStockIn } from './stockInSaveService.js'
import { createStockOut } from './stockOutSaveService.js'
import { applyStockOutLifecycleAction } from './stockOutLifecycle.js'
import {
  fetchApprovedOutByMaterial,
  fetchPendingOutByDetailKey,
  fetchWarehouseStockByMaterial,
  computeFinishedGoodsShippableQty,
} from './stockOutFinishedGoodsBatchAdd.js'
import {
  text,
  toNumber,
  roundQty,
  buildMaterialCode,
  excelPiMatchMode,
  parseShipDate,
  defaultInboundDateFromShip,
  buildGroupKey,
  buildOutboundGroupKey,
  allocateTempxAcrossLines,
  joinCustomsNos,
  buildPendingInboundByMaterial,
  initWarehouseRemaining,
  resolveOutboundQtyAgainstWarehouse,
  deductWarehouseRemaining,
  softMatchFactoryColor,
  CUSTOMS_WORKSHOP_NAME,
  CUSTOMS_WAREHOUSE_NAME,
  CUSTOMS_INBOUND_TYPE,
  CUSTOMS_OUTBOUND_TYPE,
} from './customsDeclarationLogic.js'

const SALES_HEADER = 'dbo.[UB_ERP_Sales_order]'
const SALES_LINE = 'dbo.[UB_ERP_Sales_order_list]'
const DISPATCH_HEADER = 'dbo.[UB_ERP_Dispatch_order]'
const DISPATCH_LINE = 'dbo.[UB_ERP_Dispatch_order_list]'
const STOCK_IN = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE = 'dbo.[UB_ERP_Stocks_Storage_list]'
const WORKSHOP = 'dbo.[UB_ERP_Stocks_workshop]'
const WAREHOUSE = 'dbo.[UB_ERP_Stocks_Warehouse]'
const MATERIAL_CAT = 'dbo.[New_UB_ERP_Stocks_material]'

async function resolveWorkshopByName(pool, name = CUSTOMS_WORKSHOP_NAME) {
  const r = await pool
    .request()
    .input('name', sql.NVarChar(200), text(name))
    .query(`
      SELECT TOP 1
        ${nvarcharTextExpr('w', 'code', 50)} AS code,
        ${nvarcharTextExpr('w', 'name', 200)} AS name
      FROM ${WORKSHOP} AS w
      WHERE ${nvarcharTextExpr('w', 'name', 200)} = @name
        AND (${nvarcharTextExpr('w', 'del', 20)} IN (N'', N'0') OR w.[del] IS NULL)
      ORDER BY w.[id] ASC
    `)
  const row = r.recordset?.[0]
  if (!row?.code) return { ok: false, msg: `未找到生产车间「${name}」` }
  return { ok: true, code: text(row.code), name: text(row.name) || text(name) }
}

async function resolveWarehouseByName(pool, name = CUSTOMS_WAREHOUSE_NAME) {
  const r = await pool
    .request()
    .input('name', sql.NVarChar(200), text(name))
    .query(`
      SELECT TOP 1
        ${nvarcharTextExpr('w', 'code', 50)} AS code,
        ${nvarcharTextExpr('w', 'name', 200)} AS name
      FROM ${WAREHOUSE} AS w
      WHERE ${nvarcharTextExpr('w', 'name', 200)} = @name
        AND (${nvarcharTextExpr('w', 'del', 20)} IN (N'', N'0'))
      ORDER BY w.[id] ASC
    `)
  const row = r.recordset?.[0]
  if (!row?.code) return { ok: false, msg: `未找到仓库「${name}」` }
  return { ok: true, code: text(row.code), name: text(row.name) || text(name) }
}

/**
 * 批量：成品编码 → 正式 PI（销售明细精确匹配 + Excel PI 前缀/精确）
 */
async function resolveFormalPiByMaterials(pool, items) {
  /** @type {Map<string, { formalPi?: string, orderQty?: number, error?: string }|null>} */
  const map = new Map()
  const list = (items ?? []).filter((x) => text(x.kcaa01) && text(x.excelPi))
  if (!list.length) return map

  for (const item of list) {
    const kcaa01 = text(item.kcaa01)
    const match = excelPiMatchMode(item.excelPi)
    if (!match.value) continue
    const cacheKey = `${kcaa01}|${match.mode}|${match.value}`
    if (map.has(cacheKey)) continue
    const req = pool.request().input('kcaa01', sql.NVarChar(300), kcaa01)
    let piSql
    if (match.mode === 'prefix') {
      req.input('piPrefix', sql.NVarChar(200), `${match.value}%`)
      piSql = `${nvarcharTextExpr('h', 'xsaj01', 200)} LIKE @piPrefix`
    } else {
      req.input('piExact', sql.NVarChar(200), match.value)
      piSql = `${nvarcharTextExpr('h', 'xsaj01', 200)} = @piExact`
    }
    const r = await req.query(`
      SELECT TOP 5
        ${nvarcharTextExpr('h', 'xsaj01', 200)} AS formalPi,
        CAST(ISNULL(l.[xsak03], l.[plan_quantity]) AS decimal(18, 4)) AS orderQty
      FROM ${SALES_LINE} AS l
      INNER JOIN ${SALES_HEADER} AS h
        ON ${nvarcharTextExpr('h', 'xsaj01', 200)} = ${nvarcharTextExpr('l', 'xsak01', 200)}
      WHERE (${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0'))
        AND (${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0') OR l.[del] IS NULL)
        AND ${nvarcharTextExpr('l', 'kcaa01', 300)} = @kcaa01
        AND ${piSql}
      ORDER BY CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} = N'1' THEN 0 ELSE 1 END, h.[id] DESC
    `)
    const rows = r.recordset ?? []
    if (!rows.length) {
      map.set(cacheKey, null)
      continue
    }
    const formalPis = [...new Set(rows.map((row) => text(row.formalPi)).filter(Boolean))]
    if (formalPis.length > 1) {
      map.set(cacheKey, { error: `销售明细中编码命中多个正式 PI：${formalPis.join('、')}` })
      continue
    }
    map.set(cacheKey, { formalPi: formalPis[0], orderQty: toNumber(rows[0].orderQty) })
  }
  return map
}

/**
 * 包装部 + 明细精确含编码 → 派工候选
 * @returns {Map<string, Array>}
 */
async function findPackagingDispatchesByMaterials(pool, workshopCode, materialCodes) {
  const codes = [...new Set((materialCodes ?? []).map((c) => text(c)).filter(Boolean))]
  /** @type {Map<string, Array>} */
  const map = new Map()
  if (!codes.length || !text(workshopCode)) return map

  const req = pool.request().input('workshopCode', sql.NVarChar(50), text(workshopCode))
  const inList = codes.map((c, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(300), c)
    return `@${p}`
  }).join(', ')

  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcaa01', 300)} AS kcaa01,
      ${nvarcharTextExpr('h', 'scaj01', 200)} AS dispatchOrderNo,
      ${nvarcharTextExpr('h', 'systemcode', 200)} AS dispatchSystemcode,
      ${nvarcharTextExpr('h', 'scaj04', 200)} AS headerPi,
      ${nvarcharTextExpr('l', 'pi', 200)} AS linePi,
      ${nvarcharTextExpr('l', 'scak02', 200)} AS scak02,
      CAST(ISNULL(l.[scak03], 0) AS decimal(18, 4)) AS scak03,
      l.[kcaa26] AS kcaa26,
      ${nvarcharTextExpr('l', 'kcaa27', 50)} AS kcaa27,
      ${nvarcharTextExpr('l', 'kcaa05', 100)} AS kcaa05,
      ${nvarcharTextExpr('l', 'kcaa02', 500)} AS kcaa02,
      ${nvarcharTextExpr('l', 'kcaa03', 500)} AS kcaa03,
      ${nvarcharTextExpr('l', 'kcaa04', 100)} AS kcaa04,
      ${nvarcharTextExpr('l', 'kcaa11', 100)} AS kcaa11,
      l.[id] AS lineId
    FROM ${DISPATCH_HEADER} AS h
    INNER JOIN ${DISPATCH_LINE} AS l
      ON ${nvarcharTextExpr('l', 'scak01', 200)} = ${nvarcharTextExpr('h', 'scaj01', 200)}
    WHERE ${nvarcharTextExpr('h', 'scaj05', 50)} = @workshopCode
      AND ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
      AND ${nvarcharTextExpr('h', 'closed', 20)} IN (N'', N'0')
      AND (${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0') OR l.[del] IS NULL)
      AND ${nvarcharTextExpr('l', 'kcaa01', 300)} IN (${inList})
      AND ${nvarcharTextExpr('l', 'scak02', 200)} <> N''
    ORDER BY h.[id] DESC, ISNULL(l.[seq], l.[id]) ASC
  `)

  for (const row of r.recordset ?? []) {
    const code = text(row.kcaa01)
    if (!map.has(code)) map.set(code, [])
    map.get(code).push(mapDispatchLine(row))
  }
  return map
}

function mapDispatchLine(row) {
  return {
    kcaa01: text(row.kcaa01),
    dispatchOrderNo: text(row.dispatchOrderNo),
    dispatchSystemcode: text(row.dispatchSystemcode),
    headerPi: text(row.headerPi),
    linePi: text(row.linePi),
    scak02: text(row.scak02),
    scak03: toNumber(row.scak03),
    kcaa26: row.kcaa26,
    kcaa27: text(row.kcaa27),
    kcaa05: text(row.kcaa05),
    kcaa02: text(row.kcaa02),
    kcaa03: text(row.kcaa03),
    kcaa04: text(row.kcaa04),
    kcaa11: text(row.kcaa11),
    lineId: row.lineId,
  }
}

/**
 * 按 Excel PI 查包装部全部派工明细（用于精确编码失败后的唯一明细放宽）
 * @returns {Array}
 */
async function findPackagingDispatchesByExcelPi(pool, workshopCode, excelPi) {
  const match = excelPiMatchMode(excelPi)
  if (!match.value || !text(workshopCode)) return []

  const req = pool.request().input('workshopCode', sql.NVarChar(50), text(workshopCode))
  let piSql
  if (match.mode === 'prefix') {
    req.input('piPrefix', sql.NVarChar(200), `${match.value}%`)
    piSql = `(${nvarcharTextExpr('h', 'scaj04', 200)} LIKE @piPrefix OR ${nvarcharTextExpr('l', 'pi', 200)} LIKE @piPrefix)`
  } else {
    req.input('piExact', sql.NVarChar(200), match.value)
    piSql = `(${nvarcharTextExpr('h', 'scaj04', 200)} = @piExact OR ${nvarcharTextExpr('l', 'pi', 200)} = @piExact)`
  }

  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcaa01', 300)} AS kcaa01,
      ${nvarcharTextExpr('h', 'scaj01', 200)} AS dispatchOrderNo,
      ${nvarcharTextExpr('h', 'systemcode', 200)} AS dispatchSystemcode,
      ${nvarcharTextExpr('h', 'scaj04', 200)} AS headerPi,
      ${nvarcharTextExpr('l', 'pi', 200)} AS linePi,
      ${nvarcharTextExpr('l', 'scak02', 200)} AS scak02,
      CAST(ISNULL(l.[scak03], 0) AS decimal(18, 4)) AS scak03,
      l.[kcaa26] AS kcaa26,
      ${nvarcharTextExpr('l', 'kcaa27', 50)} AS kcaa27,
      ${nvarcharTextExpr('l', 'kcaa05', 100)} AS kcaa05,
      ${nvarcharTextExpr('l', 'kcaa02', 500)} AS kcaa02,
      ${nvarcharTextExpr('l', 'kcaa03', 500)} AS kcaa03,
      ${nvarcharTextExpr('l', 'kcaa04', 100)} AS kcaa04,
      ${nvarcharTextExpr('l', 'kcaa11', 100)} AS kcaa11,
      l.[id] AS lineId
    FROM ${DISPATCH_HEADER} AS h
    INNER JOIN ${DISPATCH_LINE} AS l
      ON ${nvarcharTextExpr('l', 'scak01', 200)} = ${nvarcharTextExpr('h', 'scaj01', 200)}
    WHERE ${nvarcharTextExpr('h', 'scaj05', 50)} = @workshopCode
      AND ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
      AND ${nvarcharTextExpr('h', 'closed', 20)} IN (N'', N'0')
      AND (${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0') OR l.[del] IS NULL)
      AND ${nvarcharTextExpr('l', 'scak02', 200)} <> N''
      AND ${piSql}
    ORDER BY h.[id] DESC, ISNULL(l.[seq], l.[id]) ASC
  `)

  return (r.recordset ?? []).map(mapDispatchLine)
}

/**
 * 精确编码失败：该 PI 下包装部仅 1 条明细，且厂款/颜色松匹配 → 用真实编码
 * @returns {{ ok: true, kcaa01: string, formalPi: string, dispatch: object } | { ok: false, reason: string }}
 */
async function trySoftMatchByExcelPi(pool, workshopCode, row) {
  const lines = await findPackagingDispatchesByExcelPi(pool, workshopCode, row.excelPi)
  if (!lines.length) {
    return { ok: false, reason: `包装部派工未找到 Excel PI ${row.excelPi}（精确编码 ${row.kcaa01} 亦未命中）` }
  }
  if (lines.length !== 1) {
    const nos = [...new Set(lines.map((d) => d.dispatchOrderNo))]
    return {
      ok: false,
      reason: `精确编码 ${row.kcaa01} 未命中；该 PI 下包装部有 ${lines.length} 条明细（派工 ${nos.join('、')}），无法唯一放宽匹配`,
    }
  }
  const dispatch = lines[0]
  if (!softMatchFactoryColor(row.factoryStyleNo, row.color, dispatch.kcaa01)) {
    return {
      ok: false,
      reason: `精确编码 ${row.kcaa01} 未命中；唯一派工明细 ${dispatch.kcaa01} 与厂款号/颜色不符`,
    }
  }
  // 正式 PI：优先销售明细精确命中真实编码；否则用派工明细/主表 PI
  const piMap = await resolveFormalPiByMaterials(pool, [
    { kcaa01: dispatch.kcaa01, excelPi: row.excelPi },
  ])
  const match = excelPiMatchMode(row.excelPi)
  const cacheKey = `${dispatch.kcaa01}|${match.mode}|${match.value}`
  const salesHit = piMap.get(cacheKey)
  let formalPi = ''
  if (salesHit?.formalPi && !salesHit.error) {
    formalPi = salesHit.formalPi
  } else {
    formalPi = text(dispatch.linePi) || text(dispatch.headerPi)
  }
  if (!formalPi) {
    return { ok: false, reason: `放宽匹配到 ${dispatch.kcaa01}，但无法确定正式 PI` }
  }
  return {
    ok: true,
    kcaa01: dispatch.kcaa01,
    formalPi,
    dispatch,
    matchMode: 'soft-unique',
  }
}

async function fetchInboundAggByDetailKeys(pool, pairs) {
  /** pairs: [{ sourceOrderNo, scak02 }] */
  /** @type {Map<string, { approvedQty: number, pendingQty: number }>} */
  const map = new Map()
  const byDispatch = new Map()
  for (const p of pairs ?? []) {
    const d = text(p.sourceOrderNo)
    const k = text(p.scak02)
    if (!d || !k) continue
    if (!byDispatch.has(d)) byDispatch.set(d, new Set())
    byDispatch.get(d).add(k)
  }
  for (const [sourceOrderNo, keySet] of byDispatch.entries()) {
    const keys = [...keySet]
    const req = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    const inList = keys.map((k, i) => {
      const p = `dk${i}`
      req.input(p, sql.NVarChar(200), k)
      return `@${p}`
    }).join(', ')
    const r = await req.query(`
      SELECT
        ${nvarcharTextExpr('l', 'kcao02', 200)} AS detailKey,
        SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} = N'1' THEN ${safeDecimalExpr('l', 'kcao03')} ELSE 0 END) AS approvedQty,
        SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} <> N'1' THEN ${safeDecimalExpr('l', 'kcao03')} ELSE 0 END) AS pendingQty
      FROM ${STOCK_IN} AS h
      INNER JOIN ${STOCK_IN_LINE} AS l
        ON ${nvarcharTextExpr('l', 'kcao01', 200)} = ${nvarcharTextExpr('h', 'kcan01', 200)}
      WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('h', 'kcan03', 20)} = N'4'
        AND ${nvarcharTextExpr('h', 'kcan04', 200)} = @sourceOrderNo
        AND ${nvarcharTextExpr('l', 'kcao02', 200)} IN (${inList})
      GROUP BY l.[kcao02]
    `)
    for (const row of r.recordset ?? []) {
      map.set(`${sourceOrderNo}|${text(row.detailKey)}`, {
        approvedQty: toNumber(row.approvedQty),
        pendingQty: toNumber(row.pendingQty),
      })
    }
  }
  return map
}

async function fetchFloatRates(pool, categoryCodes) {
  const codes = [...new Set((categoryCodes ?? []).map((c) => text(c)).filter(Boolean))]
  const map = new Map()
  if (!codes.length) return map
  const req = pool.request()
  const inList = codes.map((c, i) => {
    const p = `cc${i}`
    req.input(p, sql.NVarChar(200), c)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('m', 'code', 200)} AS categoryCode,
      ${nvarcharTextExpr('m', 'stocks_in', 50)} AS stocks_in
    FROM ${MATERIAL_CAT} AS m
    WHERE ${nvarcharTextExpr('m', 'code', 200)} IN (${inList})
  `)
  for (const row of r.recordset ?? []) {
    map.set(text(row.categoryCode), parseAssistFloatRate(row.stocks_in))
  }
  return map
}

function normalizeInputRows(rows) {
  return (rows ?? []).map((row, idx) => {
    const excelRowNo = Number(row.excelRowNo ?? row.rowNo ?? idx + 1) || idx + 1
    const customsNo = text(row.customsNo ?? row['报关单号'])
    const shipDateRaw = row.shipDate ?? row['出货日期']
    const excelPi = text(row.excelPi ?? row.piNo ?? row['PI号'])
    const factoryStyleNo = text(row.factoryStyleNo ?? row['厂款号'])
    const color = text(row.color ?? row['颜色'])
    const customerStyleNo = text(row.customerStyleNo ?? row['客款号'])
    const declareQty = toNumber(row.declareQty ?? row['申报数量'])
    const declarePrice = toNumber(row.declarePrice ?? row['申报单价'])
    const customsModel = text(row.customsModel ?? row['报关单型号'])
    const productName = text(row.productName ?? row['商品名称'])
    const shipDate = parseShipDate(shipDateRaw)
    const inboundDate = defaultInboundDateFromShip(shipDateRaw, 3)
    const kcaa01 = buildMaterialCode(factoryStyleNo, color, customerStyleNo)
    return {
      excelRowNo,
      customsNo,
      shipDate,
      shipDateRaw: text(shipDateRaw),
      excelPi,
      factoryStyleNo,
      color,
      customerStyleNo,
      declareQty,
      declarePrice,
      customsModel,
      productName,
      inboundDate,
      kcaa01,
    }
  })
}

/** 正式 PI → 销售订单头（客户、PO） */
async function fetchSalesHeadersByFormalPis(pool, formalPis) {
  const pis = [...new Set((formalPis ?? []).map((p) => text(p)).filter(Boolean))]
  /** @type {Map<string, object>} */
  const map = new Map()
  if (!pis.length) return map
  for (const formalPi of pis) {
    const r = await pool.request().input('formalPi', sql.NVarChar(200), formalPi).query(`
      SELECT TOP 1
        ${nvarcharTextExpr('h', 'xsaj01', 200)} AS formalPi,
        ${nvarcharTextExpr('h', 'xsaj05', 200)} AS customerCode,
        ${nvarcharTextExpr('h', 'kehu', 500)} AS customerName,
        ${nvarcharTextExpr('h', 'xsaj06', 200)} AS poNo,
        ${nvarcharTextExpr('h', 'systemcode', 500)} AS sourceSystemcodeId
      FROM ${SALES_HEADER} AS h
      WHERE ${nvarcharTextExpr('h', 'xsaj01', 200)} = @formalPi
        AND (${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0'))
        AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[closed]), N'0'))) = N'0'
      ORDER BY h.[id] DESC
    `)
    const row = r.recordset?.[0]
    if (row?.formalPi) {
      map.set(text(row.formalPi), {
        formalPi: text(row.formalPi),
        customerCode: text(row.customerCode),
        customerName: text(row.customerName),
        poNo: text(row.poNo),
        sourceSystemcodeId: text(row.sourceSystemcodeId),
      })
    }
  }
  return map
}

/**
 * 正式 PI + 成品编码 → 唯一销售明细（xsak02=GUID）
 * @returns {Map<string, object|null>}
 */
async function resolveSalesLinesForOutbound(pool, items) {
  const list = (items ?? []).filter((x) => text(x.formalPi) && text(x.kcaa01))
  /** @type {Map<string, object|null>} */
  const map = new Map()
  for (const item of list) {
    const formalPi = text(item.formalPi)
    const kcaa01 = text(item.kcaa01)
    const cacheKey = `${formalPi}|${kcaa01}`
    if (map.has(cacheKey)) continue
    const r = await pool.request()
      .input('formalPi', sql.NVarChar(200), formalPi)
      .input('kcaa01', sql.NVarChar(300), kcaa01)
      .query(`
        SELECT TOP 5
          ${nvarcharTextExpr('l', 'xsak02', 200)} AS xsak02,
          ${nvarcharTextExpr('l', 'GUID', 200)} AS guid,
          ${nvarcharTextExpr('l', 'systemcode', 200)} AS systemcode,
          CAST(ISNULL(l.[xsak03], l.[plan_quantity]) AS decimal(18, 4)) AS xsak03,
          l.[kcaa26] AS kcaa26,
          ${nvarcharTextExpr('l', 'kcaa27', 50)} AS kcaa27,
          ${nvarcharTextExpr('l', 'kcaa02', 500)} AS kcaa02,
          ${nvarcharTextExpr('l', 'kcaa03', 500)} AS kcaa03,
          ${nvarcharTextExpr('l', 'kcaa04', 100)} AS kcaa04,
          ${nvarcharTextExpr('l', 'kcaa11', 100)} AS kcaa11
        FROM ${SALES_LINE} AS l
        WHERE ${nvarcharTextExpr('l', 'xsak01', 200)} = @formalPi
          AND (${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0') OR l.[del] IS NULL)
          AND ${nvarcharTextExpr('l', 'pass', 20)} = N'1'
          AND ${nvarcharTextExpr('l', 'kcaa01', 300)} = @kcaa01
          AND ${nvarcharTextExpr('l', 'xsak02', 200)} = ${nvarcharTextExpr('l', 'GUID', 200)}
          AND ${nvarcharTextExpr('l', 'xsak02', 200)} <> N''
      `)
    const rows = r.recordset ?? []
    if (!rows.length) {
      map.set(cacheKey, null)
      continue
    }
    if (rows.length > 1) {
      map.set(cacheKey, { error: `销售明细未唯一命中（${formalPi} / ${kcaa01} 共 ${rows.length} 条）` })
      continue
    }
    const row = rows[0]
    map.set(cacheKey, {
      xsak02: text(row.xsak02),
      systemcode: text(row.systemcode) || text(row.xsak02),
      GUID: text(row.guid) || text(row.xsak02),
      orderQty: computeKsum(row.xsak03, row.kcaa26, row.kcaa27),
      kcaa02: text(row.kcaa02),
      kcaa03: text(row.kcaa03),
      kcaa04: text(row.kcaa04),
      kcaa11: text(row.kcaa11),
    })
  }
  return map
}

/**
 * 出库预览：独立按原始 Excel 行校验并分组；失败行必须全量可见。
 */
async function buildOutboundPreview(
  pool,
  { rawRows, outboundBaseLines, inboundSuccessLines, inboundFailedRows, warehouse },
) {
  const outboundFailedRows = []
  const pendingInboundByMaterial = buildPendingInboundByMaterial(inboundSuccessLines)
  const inboundSuccessByRow = new Map(
    (inboundSuccessLines ?? []).map((line) => [Number(line.excelRowNo), line]),
  )
  const inboundFailedByRow = new Map()
  for (const line of inboundFailedRows ?? []) {
    const rowNo = Number(line.excelRowNo)
    if (!rowNo || inboundFailedByRow.has(rowNo)) continue
    inboundFailedByRow.set(rowNo, line)
  }

  const resolvedRowNos = new Set((outboundBaseLines ?? []).map((line) => Number(line.excelRowNo)))
  for (const row of rawRows ?? []) {
    const rowNo = Number(row.excelRowNo)
    if (!rowNo || resolvedRowNos.has(rowNo)) continue
    const failed = {
      ...row,
      outboundQty: 0,
      reason: inboundFailedByRow.get(rowNo)?.reason || '未命中正式 PI 或派工单，无法解析出库明细',
    }
    outboundFailedRows.push(failed)
  }

  const formalPis = [...new Set((outboundBaseLines ?? []).map((l) => text(l.formalPi)).filter(Boolean))]
  const headerMap = await fetchSalesHeadersByFormalPis(pool, formalPis)
  const salesLineMap = await resolveSalesLinesForOutbound(
    pool,
    (outboundBaseLines ?? []).map((l) => ({ formalPi: l.formalPi, kcaa01: l.kcaa01 })),
  )

  const byPi = new Map()
  for (const line of outboundBaseLines ?? []) {
    const pi = text(line.formalPi)
    if (!byPi.has(pi)) byPi.set(pi, { materials: new Set() })
    byPi.get(pi).materials.add(text(line.kcaa01))
  }

  /** @type {Map<string, Map<string, number>>} */
  const approvedOutByPi = new Map()
  /** @type {Map<string, Map<string, number>>} */
  const pendingOutByPi = new Map()
  for (const [pi, meta] of byPi.entries()) {
    const mats = [...meta.materials]
    approvedOutByPi.set(pi, await fetchApprovedOutByMaterial(pool, { sourceOrderNo: pi, materialCodes: mats }))
    const keys = []
    for (const line of outboundBaseLines ?? []) {
      if (text(line.formalPi) !== pi) continue
      const sk = `${pi}|${text(line.kcaa01)}`
      const sl = salesLineMap.get(sk)
      if (sl && !sl.error && sl.xsak02) keys.push(sl.xsak02)
    }
    pendingOutByPi.set(
      pi,
      await fetchPendingOutByDetailKey(pool, { sourceOrderNo: pi, detailKeys: [...new Set(keys)] }),
    )
  }

  const allMaterials = [...new Set((outboundBaseLines ?? []).map((l) => text(l.kcaa01)).filter(Boolean))]
  const stockMap = await fetchWarehouseStockByMaterial(pool, {
    warehouseCode: warehouse.code,
    materialCodes: allMaterials,
  })

  /** @type {Map<string, number>} */
  const stockActualByMaterial = new Map()
  for (const k of allMaterials) {
    stockActualByMaterial.set(k, roundQty(stockMap.get(k)?.actualQty ?? 0))
  }
  const warehouseRemaining = initWarehouseRemaining(stockActualByMaterial, pendingInboundByMaterial)

  /** @type {Map<number, { ok: boolean, line: any }>} */
  const lineResultMap = new Map()
  const sortedLines = [...(outboundBaseLines ?? [])].sort((a, b) => (a.excelRowNo || 0) - (b.excelRowNo || 0))

  for (const line of sortedLines) {
    const rowNo = Number(line.excelRowNo)
    const inboundHit = inboundSuccessByRow.get(rowNo)
    const inboundFailReason = text(inboundFailedByRow.get(rowNo)?.reason)
    let outboundQty = roundQty(inboundHit?.inboundQty ?? 0)
    let outboundQtySource = inboundHit ? 'inbound' : ''
    // 兼容“该行已先前入库完成”的场景：本次入库余量会是 0，但成品仓可能已有可出库存。
    // 这类行改用 Excel 申报数量走出库校验，避免把“入库余量为 0”误判成“不可出库”。
    if (
      outboundQty <= 0
      && inboundFailReason
      && /(可入余量为\s*0|该派工明细已入)/.test(inboundFailReason)
    ) {
      outboundQty = roundQty(line.declareQty)
      outboundQtySource = outboundQty > 0 ? 'declareQtyFallback' : outboundQtySource
    }
    const declarePrice = toNumber(line.declarePrice)
    const base = { ...line, outboundQty }

    // 业务规则：默认出库数量取本次可入库数量；若该行已先前入完则回退到申报数量。
    if (outboundQty <= 0 || (!inboundHit && outboundQtySource !== 'declareQtyFallback')) {
      const failed = {
        ...base,
        reason: inboundFailedByRow.get(rowNo)?.reason || '该行入库未通过，出库数量无法确定',
      }
      outboundFailedRows.push(failed)
      lineResultMap.set(rowNo, { ok: false, line: failed })
      continue
    }

    if (declarePrice <= 0) {
      const failed = { ...base, reason: '申报单价缺失或必须大于 0（出库必填）' }
      outboundFailedRows.push(failed)
      lineResultMap.set(rowNo, { ok: false, line: failed })
      continue
    }

    const header = headerMap.get(text(line.formalPi))
    if (!header?.customerCode) {
      const failed = { ...base, reason: `正式 PI ${line.formalPi} 未找到已审销售订单或客户` }
      outboundFailedRows.push(failed)
      lineResultMap.set(rowNo, { ok: false, line: failed })
      continue
    }

    const salesKey = `${text(line.formalPi)}|${text(line.kcaa01)}`
    const salesLine = salesLineMap.get(salesKey)
    if (!salesLine) {
      const failed = { ...base, reason: `销售明细未命中：${line.formalPi} / ${line.kcaa01}` }
      outboundFailedRows.push(failed)
      lineResultMap.set(rowNo, { ok: false, line: failed })
      continue
    }
    if (salesLine.error) {
      const failed = { ...base, reason: salesLine.error }
      outboundFailedRows.push(failed)
      lineResultMap.set(rowNo, { ok: false, line: failed })
      continue
    }

    const detailKey = text(salesLine.xsak02)
    const approvedOut = approvedOutByPi.get(text(line.formalPi))?.get(text(line.kcaa01)) ?? 0
    const pendingOut = pendingOutByPi.get(text(line.formalPi))?.get(detailKey) ?? 0
    const shippableQty = computeFinishedGoodsShippableQty({
      orderQty: salesLine.orderQty,
      approvedOutQty: approvedOut,
      pendingOutQty: pendingOut,
    })
    if (outboundQty > roundQty(shippableQty)) {
      const failed = {
        ...base,
        reason: `销售可出余量 ${roundQty(shippableQty)} 不足（需出 ${outboundQty}）`,
        shippableQty: roundQty(shippableQty),
      }
      outboundFailedRows.push(failed)
      lineResultMap.set(rowNo, { ok: false, line: failed })
      continue
    }

    const whCheck = resolveOutboundQtyAgainstWarehouse(
      outboundQty,
      line.kcaa01,
      warehouseRemaining,
      pendingInboundByMaterial,
    )
    if (!whCheck.ok) {
      const failed = {
        ...base,
        reason: whCheck.reason,
        warehouseActualQty: whCheck.available,
      }
      outboundFailedRows.push(failed)
      lineResultMap.set(rowNo, { ok: false, line: failed })
      continue
    }

    deductWarehouseRemaining(warehouseRemaining, line.kcaa01, outboundQty)
    const okLine = {
      ...line,
      outboundQty,
      declarePrice,
      customsModel: text(line.customsModel),
      customerCode: header.customerCode,
      customerName: header.customerName,
      poNo: header.poNo,
      sourceSystemcodeId: header.sourceSystemcodeId,
      salesLineKey: detailKey,
      kcaq02: detailKey,
      systemcode: salesLine.systemcode,
      GUID: salesLine.GUID,
      outboundQtySource,
      shippableQty: roundQty(shippableQty),
      warehouseActualQty: whCheck.available,
    }
    lineResultMap.set(rowNo, { ok: true, line: okLine })
  }

  /** @type {Map<string, any>} */
  const groupMap = new Map()
  let outboundSuccessRows = 0
  for (const line of sortedLines) {
    const groupKey = buildOutboundGroupKey(line.formalPi, line.shipDate, line.dispatchOrderNo)
    if (!groupMap.has(groupKey)) {
      const header = headerMap.get(text(line.formalPi))
      groupMap.set(groupKey, {
        groupKey,
        formalPi: line.formalPi,
        shipDate: line.shipDate,
        dispatchOrderNo: line.dispatchOrderNo,
        dispatchSystemcode: line.dispatchSystemcode,
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        outboundType: CUSTOMS_OUTBOUND_TYPE,
        customerCode: header?.customerCode || '',
        customerName: header?.customerName || '',
        poNo: header?.poNo || '',
        sourceSystemcodeId: header?.sourceSystemcodeId || '',
        customsNos: [],
        lines: [],
        failedLines: [],
        warnings: [],
      })
    }
    const g = groupMap.get(groupKey)
    const res = lineResultMap.get(Number(line.excelRowNo))
    if (!res) continue
    if (res.ok) {
      g.lines.push(res.line)
      outboundSuccessRows += 1
      if (res.line.customsNo) g.customsNos.push(res.line.customsNo)
      if (!g.customerCode) g.customerCode = res.line.customerCode || g.customerCode
      if (!g.customerName) g.customerName = res.line.customerName || g.customerName
      if (!g.poNo) g.poNo = res.line.poNo || g.poNo
      if (!g.sourceSystemcodeId) g.sourceSystemcodeId = res.line.sourceSystemcodeId || g.sourceSystemcodeId
    } else {
      g.failedLines.push(res.line)
      g.warnings.push(`第${line.excelRowNo}行：${res.line.reason}`)
      if (res.line.customsNo) g.customsNos.push(res.line.customsNo)
    }
  }

  const outboundGroups = [...groupMap.values()].map((g) => {
    const uniqCustomsNos = [...new Set(g.customsNos)]
    return {
      ...g,
      customsNos: uniqCustomsNos,
      lineCount: g.lines.length,
      failedLineCount: g.failedLines.length,
      totalOutboundQty: roundQty(g.lines.reduce((s, l) => s + toNumber(l.outboundQty), 0)),
      totalAmount: roundQty(
        g.lines.reduce((s, l) => s + toNumber(l.outboundQty) * toNumber(l.declarePrice), 0),
        2,
      ),
      warnings: [...new Set(g.warnings)],
      remark: joinCustomsNos(uniqCustomsNos) ? `海关报关单号：${joinCustomsNos(uniqCustomsNos)}` : '海关单导入',
      canGenerate: g.lines.length > 0,
    }
  })

  outboundGroups.sort((a, b) => {
    const d = text(a.shipDate).localeCompare(text(b.shipDate))
    if (d) return d
    const p = text(a.formalPi).localeCompare(text(b.formalPi))
    if (p) return p
    return text(a.dispatchOrderNo).localeCompare(text(b.dispatchOrderNo))
  })

  outboundFailedRows.sort((a, b) => (a.excelRowNo || 0) - (b.excelRowNo || 0))

  const outboundGeneratableGroupCount = outboundGroups.filter((g) => g.canGenerate).length

  return {
    outboundGroups,
    outboundFailedRows,
    outboundSuccessRows,
    outboundGeneratableGroupCount,
  }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ rows: any[] }} input
 */
export async function previewCustomsDeclaration(pool, input = {}) {
  const workshop = await resolveWorkshopByName(pool)
  if (!workshop.ok) return { ok: false, status: 400, msg: workshop.msg }
  const warehouse = await resolveWarehouseByName(pool)
  if (!warehouse.ok) return { ok: false, status: 400, msg: warehouse.msg }

  const rawRows = normalizeInputRows(input.rows)
  if (!rawRows.length) return { ok: false, status: 400, msg: '没有可解析的明细行' }

  const failedRows = []
  const candidates = []

  for (const row of rawRows) {
    if (!row.shipDate || !row.inboundDate) {
      failedRows.push({ ...row, reason: '出货日期无效，无法计算入库日期' })
      continue
    }
    if (!row.excelPi) {
      failedRows.push({ ...row, reason: 'PI号为空' })
      continue
    }
    if (!row.kcaa01) {
      failedRows.push({ ...row, reason: '厂款号或颜色为空，无法拼成品编码' })
      continue
    }
    if (row.declareQty <= 0) {
      failedRows.push({ ...row, reason: '申报数量必须大于 0' })
      continue
    }
    candidates.push(row)
  }

  const piLookupItems = candidates.map((r) => ({ kcaa01: r.kcaa01, excelPi: r.excelPi }))
  const piMap = await resolveFormalPiByMaterials(pool, piLookupItems)

  const afterPi = []
  /** 销售精确未命中，待唯一明细放宽 */
  const softCandidates = []
  for (const row of candidates) {
    const match = excelPiMatchMode(row.excelPi)
    const cacheKey = `${row.kcaa01}|${match.mode}|${match.value}`
    const hit = piMap.get(cacheKey)
    if (!hit) {
      softCandidates.push(row)
      continue
    }
    if (hit.error) {
      failedRows.push({ ...row, reason: hit.error })
      continue
    }
    afterPi.push({ ...row, formalPi: hit.formalPi, matchMode: 'exact' })
  }

  const materialCodes = [...new Set(afterPi.map((r) => r.kcaa01))]
  const dispatchMap = await findPackagingDispatchesByMaterials(pool, workshop.code, materialCodes)

  const afterDispatch = []
  for (const row of afterPi) {
    const list = dispatchMap.get(row.kcaa01) ?? []
    // 优先明细 pi / 主表 scaj04 与正式 PI 一致的派工
    const matchedPi = list.filter(
      (d) => text(d.linePi) === row.formalPi || text(d.headerPi) === row.formalPi,
    )
    const poolList = matchedPi.length ? matchedPi : list
    const uniqueNos = [...new Set(poolList.map((d) => d.dispatchOrderNo))]
    if (uniqueNos.length === 0) {
      softCandidates.push(row)
      continue
    }
    if (uniqueNos.length > 1) {
      failedRows.push({
        ...row,
        reason: `编码 ${row.kcaa01} 命中多张包装部派工单：${uniqueNos.join('、')}，请先整理派工`,
        dispatchCandidates: uniqueNos,
      })
      continue
    }
    const dispatch = poolList.find((d) => d.dispatchOrderNo === uniqueNos[0])
    afterDispatch.push({ ...row, dispatch })
  }

  // 精确失败：按 Excel PI 唯一包装部明细 + 厂款/颜色松匹配
  for (const row of softCandidates) {
    const soft = await trySoftMatchByExcelPi(pool, workshop.code, row)
    if (!soft.ok) {
      failedRows.push({ ...row, reason: soft.reason })
      continue
    }
    afterDispatch.push({
      ...row,
      kcaa01: soft.kcaa01,
      formalPi: soft.formalPi,
      dispatch: soft.dispatch,
      matchMode: soft.matchMode,
      excelBuiltCode: row.kcaa01,
    })
  }

  // 出库解析基线：与入库余量判定解耦，先保留完整匹配结果供出库模块独立给失败原因。
  const outboundBaseLines = afterDispatch.map((row) => {
    const d = row.dispatch
    return {
      ...row,
      dispatchOrderNo: d.dispatchOrderNo,
      dispatchSystemcode: d.dispatchSystemcode,
      scak02: d.scak02,
      productName: row.productName || d.kcaa02,
      kcaa02: d.kcaa02,
      kcaa03: d.kcaa03,
      kcaa04: d.kcaa04,
      kcaa11: d.kcaa11,
    }
  })

  const inboundPairs = afterDispatch.map((r) => ({
    sourceOrderNo: r.dispatch.dispatchOrderNo,
    scak02: r.dispatch.scak02,
  }))
  const inboundAgg = await fetchInboundAggByDetailKeys(pool, inboundPairs)
  const floatMap = await fetchFloatRates(
    pool,
    afterDispatch.map((r) => r.dispatch.kcaa05),
  )

  /** 预览阶段按「派工+scak02」追踪组内占用，跨组同一键也按出现顺序扣 */
  const tempxRemaining = new Map()
  const successLines = []

  for (const row of afterDispatch) {
    const d = row.dispatch
    const poolKey = `${d.dispatchOrderNo}|${d.scak02}`
    if (!tempxRemaining.has(poolKey)) {
      const orderQty = computeAssistKsum(d.scak03, d.kcaa26, d.kcaa27)
      const agg = inboundAgg.get(poolKey) ?? { approvedQty: 0, pendingQty: 0 }
      const tempx = computeProductionTempx(orderQty, agg.approvedQty, agg.pendingQty)
      tempxRemaining.set(poolKey, tempx)
    }
    const left = tempxRemaining.get(poolKey)
    const floatRate = floatMap.get(text(d.kcaa05)) ?? 0
    const kcao031 = computeAssistKcao031(left, floatRate)
    const allocated = allocateTempxAcrossLines(
      [{ ...row, kcao02: d.scak02, declareQty: row.declareQty }],
      () => left,
    )[0]
    if (!allocated.ok) {
      const alreadyQty = roundQty(
        (inboundAgg.get(poolKey)?.approvedQty ?? 0) + (inboundAgg.get(poolKey)?.pendingQty ?? 0),
      )
      failedRows.push({
        ...row,
        dispatchOrderNo: d.dispatchOrderNo,
        scak02: d.scak02,
        tempx: left,
        alreadyInboundQty: alreadyQty,
        reason:
          alreadyQty > 0 && left <= 0
            ? `${allocated.reason}（该派工明细已入 ${alreadyQty}）`
            : allocated.reason,
      })
      continue
    }
    tempxRemaining.set(poolKey, roundQty(left - allocated.inboundQty))
    const already = inboundAgg.get(poolKey) ?? { approvedQty: 0, pendingQty: 0 }
    successLines.push({
      excelRowNo: row.excelRowNo,
      customsNo: row.customsNo,
      shipDate: row.shipDate,
      excelPi: row.excelPi,
      formalPi: row.formalPi,
      factoryStyleNo: row.factoryStyleNo,
      color: row.color,
      customerStyleNo: row.customerStyleNo,
      kcaa01: row.kcaa01,
      excelBuiltCode: row.excelBuiltCode || '',
      matchMode: row.matchMode || 'exact',
      productName: row.productName || d.kcaa02,
      declareQty: row.declareQty,
      declarePrice: row.declarePrice,
      customsModel: row.customsModel,
      inboundQty: allocated.inboundQty,
      truncated: allocated.truncated,
      truncateHint: allocated.truncated ? allocated.reason : '',
      tempx: left,
      kcao031,
      kcao02: d.scak02,
      scak02: d.scak02,
      dispatchOrderNo: d.dispatchOrderNo,
      dispatchSystemcode: d.dispatchSystemcode,
      inboundDate: row.inboundDate,
      alreadyInboundQty: roundQty(already.approvedQty + already.pendingQty),
      alreadyInboundHint:
        already.approvedQty + already.pendingQty > 0
          ? `该派工明细已有生产入库 ${roundQty(already.approvedQty + already.pendingQty)}（含未审）`
          : '',
      kcaa02: d.kcaa02,
      kcaa03: d.kcaa03,
      kcaa04: d.kcaa04,
      kcaa11: d.kcaa11,
    })
  }

  /** @type {Map<string, any>} */
  const groupMap = new Map()
  for (const line of successLines) {
    const key = buildGroupKey(line.formalPi, line.inboundDate, line.dispatchOrderNo)
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        groupKey: key,
        formalPi: line.formalPi,
        inboundDate: line.inboundDate,
        dispatchOrderNo: line.dispatchOrderNo,
        dispatchSystemcode: line.dispatchSystemcode,
        workshopCode: workshop.code,
        workshopName: workshop.name,
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        inboundType: CUSTOMS_INBOUND_TYPE,
        customsNos: [],
        lines: [],
        warnings: [],
      })
    }
    const g = groupMap.get(key)
    if (line.customsNo) g.customsNos.push(line.customsNo)
    if (line.truncated) g.warnings.push(`第${line.excelRowNo}行：${line.truncateHint}`)
    if (line.alreadyInboundHint) g.warnings.push(`第${line.excelRowNo}行：${line.alreadyInboundHint}`)
    g.lines.push(line)
  }

  const groups = [...groupMap.values()].map((g) => ({
    ...g,
    customsNos: [...new Set(g.customsNos)],
    remark: joinCustomsNos(g.customsNos) ? `海关报关单号：${joinCustomsNos(g.customsNos)}` : '海关单导入',
    lineCount: g.lines.length,
    totalDeclareQty: roundQty(g.lines.reduce((s, l) => s + toNumber(l.declareQty), 0)),
    totalInboundQty: roundQty(g.lines.reduce((s, l) => s + toNumber(l.inboundQty), 0)),
    warnings: [...new Set(g.warnings)],
  }))

  groups.sort((a, b) => {
    const d = text(a.inboundDate).localeCompare(text(b.inboundDate))
    if (d) return d
    const p = text(a.formalPi).localeCompare(text(b.formalPi))
    if (p) return p
    return text(a.dispatchOrderNo).localeCompare(text(b.dispatchOrderNo))
  })

  failedRows.sort((a, b) => (a.excelRowNo || 0) - (b.excelRowNo || 0))

  const outboundPreview = await buildOutboundPreview(pool, {
    rawRows,
    outboundBaseLines,
    inboundSuccessLines: successLines,
    inboundFailedRows: failedRows,
    warehouse,
  })

  return {
    ok: true,
    workshop,
    warehouse,
    groups,
    failedRows,
    outboundGroups: outboundPreview.outboundGroups,
    outboundFailedRows: outboundPreview.outboundFailedRows,
    summary: {
      totalRows: rawRows.length,
      successRows: successLines.length,
      failedRows: failedRows.length,
      groupCount: groups.length,
      outboundSuccessRows: outboundPreview.outboundSuccessRows,
      outboundFailedRows: outboundPreview.outboundFailedRows.length,
      outboundGroupCount: outboundPreview.outboundGroups.length,
      outboundGeneratableGroupCount: outboundPreview.outboundGeneratableGroupCount,
    },
  }
}

/**
 * 确认生成：逐组 createStockIn；组内按行序扣余量，组间同一派工明细累计占用。
 */
export async function generateCustomsStockIns(pool, { groups, actor, req }) {
  if (!Array.isArray(groups) || !groups.length) {
    return { ok: false, status: 400, msg: '没有可生成的入库组' }
  }

  const workshop = await resolveWorkshopByName(pool)
  if (!workshop.ok) return { ok: false, status: 400, msg: workshop.msg }
  const warehouse = await resolveWarehouseByName(pool)
  if (!warehouse.ok) return { ok: false, status: 400, msg: warehouse.msg }

  const results = []
  const errors = []
  /** 本批次已占用：dispatch|scak02 → qty */
  const batchConsumed = new Map()

  for (let gi = 0; gi < groups.length; gi += 1) {
    const g = groups[gi]
    const formalPi = text(g.formalPi)
    const inboundDate = text(g.inboundDate)
    const dispatchOrderNo = text(g.dispatchOrderNo)
    const linesIn = Array.isArray(g.lines) ? g.lines : []
    if (!formalPi || !inboundDate || !dispatchOrderNo) {
      errors.push({ groupIndex: gi, groupKey: g.groupKey, msg: '组缺少正式 PI / 入库日期 / 派工单号' })
      continue
    }
    if (!linesIn.length) {
      errors.push({ groupIndex: gi, groupKey: g.groupKey, msg: '组内无明细' })
      continue
    }

    // 重新解析派工明细余量
    const dispatchMap = await findPackagingDispatchesByMaterials(
      pool,
      workshop.code,
      linesIn.map((l) => text(l.kcaa01)),
    )
    const inboundPairs = []
    const resolvedLines = []
    for (const line of linesIn) {
      const kcaa01 = text(line.kcaa01)
      const list = (dispatchMap.get(kcaa01) ?? []).filter((d) => d.dispatchOrderNo === dispatchOrderNo)
      if (list.length !== 1) {
        errors.push({
          groupIndex: gi,
          groupKey: g.groupKey,
          excelRowNo: line.excelRowNo,
          msg: `编码 ${kcaa01} 在派工 ${dispatchOrderNo} 上无法唯一匹配`,
        })
        continue
      }
      const d = list[0]
      inboundPairs.push({ sourceOrderNo: dispatchOrderNo, scak02: d.scak02 })
      resolvedLines.push({
        ...line,
        kcaa01,
        declareQty: toNumber(line.declareQty ?? line.inboundQty),
        dispatch: d,
        kcao02: d.scak02,
      })
    }
    if (!resolvedLines.length) continue

    const inboundAgg = await fetchInboundAggByDetailKeys(pool, inboundPairs)
    const floatMap = await fetchFloatRates(
      pool,
      resolvedLines.map((l) => l.dispatch.kcaa05),
    )

    const getTempx = (line) => {
      const d = line.dispatch
      const poolKey = `${dispatchOrderNo}|${d.scak02}`
      const orderQty = computeAssistKsum(d.scak03, d.kcaa26, d.kcaa27)
      const agg = inboundAgg.get(poolKey) ?? { approvedQty: 0, pendingQty: 0 }
      const base = computeProductionTempx(orderQty, agg.approvedQty, agg.pendingQty)
      const consumed = batchConsumed.get(poolKey) ?? 0
      return roundQty(base - consumed)
    }

    const allocated = allocateTempxAcrossLines(resolvedLines, getTempx)
    const okLines = []
    for (const a of allocated) {
      if (!a.ok) {
        errors.push({
          groupIndex: gi,
          groupKey: g.groupKey,
          excelRowNo: a.excelRowNo,
          msg: a.reason || '可入余量不足',
        })
        continue
      }
      const d = a.dispatch
      const poolKey = `${dispatchOrderNo}|${d.scak02}`
      batchConsumed.set(poolKey, roundQty((batchConsumed.get(poolKey) ?? 0) + a.inboundQty))
      const floatRate = floatMap.get(text(d.kcaa05)) ?? 0
      const kcao031 = computeAssistKcao031(a.tempxBefore, floatRate)
      okLines.push({
        kcaa01: a.kcaa01,
        kcao02: d.scak02,
        kcao03: a.inboundQty,
        kcao031: Math.max(kcao031, a.inboundQty),
        kcao04: 0,
        kcao041: 0,
        kcao05: 0,
        kcao051: 0,
        tax: 0,
        availableQty: a.tempxBefore,
        tempx: a.tempxBefore,
        reference: formalPi,
        Describe: text(a.productName || d.kcaa02),
        kcaa02: d.kcaa02,
        kcaa03: d.kcaa03,
        kcaa04: d.kcaa04,
        kcaa11: d.kcaa11,
      })
    }
    if (!okLines.length) continue

    const customsJoined = joinCustomsNos([
      ...(g.customsNos || []),
      ...linesIn.map((l) => l.customsNo),
    ])
    const customsRemark = text(g.remark) || (customsJoined ? `海关报关单号：${customsJoined}` : '海关单导入')

    try {
      const saveResult = await createStockIn({
        pool,
        req,
        actor,
        body: {
          header: {
            inboundDate,
            inboundType: CUSTOMS_INBOUND_TYPE,
            sourceOrderNo: dispatchOrderNo,
            relatedPartyCode: workshop.code,
            relatedPartyName: workshop.name,
            warehouseCode: warehouse.code,
            warehouseName: warehouse.name,
            paperNo: formalPi,
            inTax: '1',
            remark: customsRemark,
          },
          lines: okLines,
        },
      })
      if (!saveResult?.ok) {
        errors.push({
          groupIndex: gi,
          groupKey: g.groupKey,
          msg: saveResult?.msg || '保存入库单失败',
        })
        // 回滚本批占用（本组未写入成功）
        for (const a of allocated) {
          if (!a.ok) continue
          const poolKey = `${dispatchOrderNo}|${a.dispatch.scak02}`
          batchConsumed.set(poolKey, roundQty((batchConsumed.get(poolKey) ?? 0) - a.inboundQty))
        }
        continue
      }
      results.push({
        groupKey: g.groupKey,
        formalPi,
        inboundDate,
        dispatchOrderNo,
        receiptNo: saveResult.receiptNo,
        pass: saveResult.pass,
        lineCount: okLines.length,
        autoApproved: saveResult.autoApproved,
      })
    } catch (err) {
      const detail = String(err?.message ?? err?.originalError?.message ?? err)
      errors.push({ groupIndex: gi, groupKey: g.groupKey, msg: `保存入库单异常：${detail}` })
      for (const a of allocated) {
        if (!a.ok) continue
        const poolKey = `${dispatchOrderNo}|${a.dispatch.scak02}`
        batchConsumed.set(poolKey, roundQty((batchConsumed.get(poolKey) ?? 0) - a.inboundQty))
      }
    }
  }

  return {
    ok: true,
    created: results,
    errors,
    summary: {
      requestedGroups: groups.length,
      createdCount: results.length,
      errorCount: errors.length,
    },
  }
}

/** 新建出库单后按单号回查主键（createStockOut 新建时不回传 id） */
async function fetchStockOutIdByOutboundNo(pool, outboundNo) {
  const no = text(outboundNo)
  if (!no) return null
  const r = await pool.request().input('outboundNo', sql.NVarChar(200), no).query(`
    SELECT TOP 1 [id]
    FROM dbo.[UB_ERP_Stocks_out]
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcap01], N'')))) = @outboundNo
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
    ORDER BY [id] DESC
  `)
  const id = Number(r.recordset?.[0]?.id)
  return Number.isFinite(id) && id > 0 ? id : null
}

/**
 * 确认生成成品出库：逐组 createStockOut + 自动审核
 */
export async function generateCustomsStockOuts(pool, { outboundGroups, actor, req }) {
  if (!Array.isArray(outboundGroups) || !outboundGroups.length) {
    return { ok: false, status: 400, msg: '没有可生成的出库组' }
  }

  const warehouse = await resolveWarehouseByName(pool)
  if (!warehouse.ok) return { ok: false, status: 400, msg: warehouse.msg }

  const results = []
  const errors = []

  for (let gi = 0; gi < outboundGroups.length; gi += 1) {
    const g = outboundGroups[gi]
    const formalPi = text(g.formalPi)
    const shipDate = text(g.shipDate)
    const dispatchOrderNo = text(g.dispatchOrderNo)
    const linesIn = Array.isArray(g.lines) ? g.lines : []
    if (!formalPi || !shipDate || !dispatchOrderNo) {
      errors.push({ groupIndex: gi, groupKey: g.groupKey, msg: '组缺少正式 PI / 出货日期 / 派工单号' })
      continue
    }
    if (!linesIn.length) {
      errors.push({ groupIndex: gi, groupKey: g.groupKey, msg: '组内无明细' })
      continue
    }

    const headerMap = await fetchSalesHeadersByFormalPis(pool, [formalPi])
    const header = headerMap.get(formalPi)
    if (!header?.customerCode) {
      errors.push({ groupIndex: gi, groupKey: g.groupKey, msg: `正式 PI ${formalPi} 销售订单或客户不可用` })
      continue
    }

    const salesLineMap = await resolveSalesLinesForOutbound(
      pool,
      linesIn.map((l) => ({ formalPi, kcaa01: text(l.kcaa01) })),
    )
    const materialCodes = [...new Set(linesIn.map((l) => text(l.kcaa01)).filter(Boolean))]
    const detailKeys = []
    const okLines = []

    for (const line of linesIn) {
      const kcaa01 = text(line.kcaa01)
      const outboundQty = roundQty(line.outboundQty ?? line.inboundQty)
      const declarePrice = toNumber(line.declarePrice)
      if (outboundQty <= 0) {
        errors.push({ groupIndex: gi, groupKey: g.groupKey, excelRowNo: line.excelRowNo, msg: '出库数量必须大于 0' })
        continue
      }
      if (declarePrice <= 0) {
        errors.push({ groupIndex: gi, groupKey: g.groupKey, excelRowNo: line.excelRowNo, msg: '申报单价无效' })
        continue
      }
      const sk = `${formalPi}|${kcaa01}`
      const salesLine = salesLineMap.get(sk)
      if (!salesLine || salesLine.error) {
        errors.push({
          groupIndex: gi,
          groupKey: g.groupKey,
          excelRowNo: line.excelRowNo,
          msg: salesLine?.error || `销售明细未命中：${kcaa01}`,
        })
        continue
      }
      detailKeys.push(salesLine.xsak02)
      // sourceLineCode/lineKey：createStockOut 校验「关联单据明细」只认这两个字段，不只认 kcaq02
      okLines.push({
        kcaa01,
        kcaq02: salesLine.xsak02,
        sourceLineCode: salesLine.xsak02,
        lineKey: salesLine.xsak02,
        systemcode: salesLine.systemcode,
        GUID: salesLine.GUID,
        kcaq03: outboundQty,
        kcaq04: declarePrice,
        kcaq08: declarePrice,
        tax: 0,
        reference: text(line.customsNo),
        Describe: text(line.customsModel) || text(line.productName) || salesLine.kcaa02,
        kcaa02: salesLine.kcaa02,
        kcaa03: salesLine.kcaa03,
        kcaa04: salesLine.kcaa04,
        kcaa11: salesLine.kcaa11,
      })
    }
    if (!okLines.length) {
      errors.push({ groupIndex: gi, groupKey: g.groupKey, msg: '组内明细均未通过销售明细匹配，无法生成' })
      continue
    }

    const [approvedOutMap, pendingOutMap, stockMap] = await Promise.all([
      fetchApprovedOutByMaterial(pool, { sourceOrderNo: formalPi, materialCodes }),
      fetchPendingOutByDetailKey(pool, { sourceOrderNo: formalPi, detailKeys }),
      fetchWarehouseStockByMaterial(pool, { warehouseCode: warehouse.code, materialCodes }),
    ])

    const finalLines = []
    for (const line of okLines) {
      const salesKey = `${formalPi}|${line.kcaa01}`
      const salesLine = salesLineMap.get(salesKey)
      const shippableQty = computeFinishedGoodsShippableQty({
        orderQty: salesLine.orderQty,
        approvedOutQty: approvedOutMap.get(line.kcaa01) ?? 0,
        pendingOutQty: pendingOutMap.get(line.kcaq02) ?? 0,
      })
      const stock = stockMap.get(line.kcaa01)
      const warehouseActualQty = roundQty(stock?.actualQty ?? 0)
      if (line.kcaq03 > roundQty(shippableQty)) {
        errors.push({
          groupIndex: gi,
          groupKey: g.groupKey,
          excelRowNo: linesIn.find((l) => text(l.kcaa01) === line.kcaa01)?.excelRowNo,
          msg: `销售可出余量不足（${roundQty(shippableQty)}）`,
        })
        continue
      }
      if (line.kcaq03 > warehouseActualQty) {
        errors.push({
          groupIndex: gi,
          groupKey: g.groupKey,
          excelRowNo: linesIn.find((l) => text(l.kcaa01) === line.kcaa01)?.excelRowNo,
          msg: `成品仓库存不足（${warehouseActualQty}），请先生成入库`,
        })
        continue
      }
      finalLines.push(line)
    }
    if (!finalLines.length) {
      errors.push({ groupIndex: gi, groupKey: g.groupKey, msg: '组内明细均未通过销售可出/成品仓库存校验，无法生成' })
      continue
    }

    const customsJoined = joinCustomsNos([
      ...(g.customsNos || []),
      ...linesIn.map((l) => l.customsNo),
    ])
    const customsRemark = text(g.remark) || (customsJoined ? `海关报关单号：${customsJoined}` : '海关单导入')

    try {
      const saveResult = await createStockOut({
        pool,
        req,
        actor,
        body: {
          header: {
            outboundDate: shipDate,
            outboundType: CUSTOMS_OUTBOUND_TYPE,
            sourceOrderNo: formalPi,
            relatedPartyCode: header.customerCode,
            relatedPartyName: header.customerName,
            warehouseCode: warehouse.code,
            warehouseName: warehouse.name,
            paperNo: text(g.poNo) || header.poNo,
            inTax: '2',
            remark: customsRemark,
          },
          lines: finalLines,
        },
      })
      if (!saveResult?.ok) {
        errors.push({ groupIndex: gi, groupKey: g.groupKey, msg: saveResult?.msg || '保存出库单失败' })
        continue
      }
      // createStockOut 新建不回传 id，审核前按出库单号回查
      const stockOutId = saveResult.id || (await fetchStockOutIdByOutboundNo(pool, saveResult.outboundNo))
      if (!stockOutId) {
        errors.push({
          groupIndex: gi,
          groupKey: g.groupKey,
          outboundNo: saveResult.outboundNo,
          msg: `出库单已保存（${saveResult.outboundNo}）但无法定位单据 id，自动审核失败`,
        })
        continue
      }
      const auditResult = await applyStockOutLifecycleAction({
        pool,
        id: stockOutId,
        action: 'audit',
        actor,
      })
      if (!auditResult?.ok) {
        errors.push({
          groupIndex: gi,
          groupKey: g.groupKey,
          outboundNo: saveResult.outboundNo,
          msg: `出库单已保存但自动审核失败：${auditResult?.msg || '未知错误'}`,
        })
        continue
      }
      results.push({
        groupKey: g.groupKey,
        formalPi,
        shipDate,
        dispatchOrderNo,
        outboundNo: saveResult.outboundNo,
        pass: '1',
        lineCount: finalLines.length,
        autoApproved: true,
      })
    } catch (err) {
      const detail = String(err?.message ?? err?.originalError?.message ?? err)
      errors.push({ groupIndex: gi, groupKey: g.groupKey, msg: `保存出库单异常：${detail}` })
    }
  }

  return {
    ok: true,
    created: results,
    errors,
    summary: {
      requestedGroups: outboundGroups.length,
      createdCount: results.length,
      errorCount: errors.length,
    },
  }
}
