/**
 * 销售订单 PI BOM 查看与维护（issue 06）
 */
import { sql } from './db.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import { formatSalesOrderAuditTime, collectPiBomSubtreeParentCodes } from './salesOrderPiBom.js'
import {
  buildPiBomUsageTreeForProduct,
  fetchPiBomHeadSystemcode,
} from './salesOrderPiBomUsageTree.js'
import { SALES_ORDER_HEADER_TABLE } from './salesOrderListQuery.js'
import {
  flattenPiBomTreeForEdit,
  parsePiBomMaintainKcaa01,
  parsePiBomMaintainLines,
  validatePiBomLineIdsBelongToProduct,
  validatePiBomMaintainLineOnOrder,
  validatePiBomMaintainOrderState,
} from './salesOrderPiBomMaintainLogic.js'
import { INV_BOM_MASTER_FROM as BOM_MASTER_FROM, INV_BOM_MASTER_TABLE as BOM_MASTER_TABLE } from './bomTables.js'

const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_BOM_HEAD_FROM = 'dbo.[UB_ERP_Bom_Sales]'
const PI_BOM_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
async function fetchOrderHeaderForPiBom(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      h.[id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo,
      LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL(h.[del], N''))) AS del
    FROM ${HEADER_FROM} AS h
    WHERE h.[id] = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 */
async function fetchOrderLineProducts(pool, piNo) {
  const pi = normKcaa01(piNo)
  const r = await pool.request().input('pi', sql.NVarChar(200), pi).query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) AS kcaa01
    FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsak01], N'')))) = @pi
    ORDER BY [id] ASC
  `)
  return (r.recordset ?? []).map((row) => normKcaa01(row.kcaa01)).filter(Boolean)
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 * @param {string[]} products
 */
async function fetchPiBomExistsByProduct(pool, piNo, products) {
  const pi = normKcaa01(piNo)
  if (!products.length) return new Set()
  const req = pool.request().input('pi', sql.NVarChar(200), pi)
  const or = []
  for (let i = 0; i < products.length; i++) {
    const p = `p${i}`
    req.input(p, sql.NVarChar(300), products[i])
    or.push(`LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @${p}`)
  }
  const r = await req.query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) AS kcaa01
    FROM ${PI_BOM_HEAD_FROM} AS h
    WHERE LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
      AND (${or.join(' OR ')})
  `)
  return new Set((r.recordset ?? []).map((row) => normKcaa01(row.kcaa01)).filter(Boolean))
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string[]} kcaa01List
 */
async function enrichBom000DisplayByKcaa01(pool, kcaa01List) {
  const codes = [...new Set(kcaa01List.map((x) => normKcaa01(x)).filter(Boolean))]
  /** @type {Map<string, { kcaa02: string, kcaa03: string, kcaa04: string, kcaa05: string }>} */
  const map = new Map()
  if (!codes.length) return map
  for (let i = 0; i < codes.length; i += 40) {
    const chunk = codes.slice(i, i + 40)
    const req = pool.request()
    const or = []
    for (let j = 0; j < chunk.length; j++) {
      const p = `c${i}_${j}`
      req.input(p, sql.NVarChar(300), chunk[j])
      or.push(`LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) = @${p}`)
    }
    const r = await req.query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa02], N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa03], N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa04], N'')))) AS kcaa04,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa05], N'')))) AS kcaa05
      FROM ${BOM_MASTER_FROM} AS b
      WHERE (${or.join(' OR ')})
        AND (ISNULL(b.[del], N'') = N'' OR b.[del] = N'0')
    `)
    for (const row of r.recordset ?? []) {
      const code = normKcaa01(row.kcaa01)
      if (!code) continue
      map.set(code, {
        kcaa02: String(row.kcaa02 ?? ''),
        kcaa03: String(row.kcaa03 ?? ''),
        kcaa04: String(row.kcaa04 ?? ''),
        kcaa05: String(row.kcaa05 ?? ''),
      })
    }
  }
  return map
}

/**
 * @param {any[]} nodes
 * @param {Map<string, { kcaa02: string, kcaa03: string, kcaa04: string, kcaa05: string }>} displayMap
 */
function applyDisplayToPiBomTree(nodes, displayMap) {
  for (const node of nodes ?? []) {
    const code = normKcaa01(node.kcaa01)
    const d = displayMap.get(code)
    if (d) {
      node.kcaa02 = d.kcaa02
      node.kcaa03 = d.kcaa03
      node.kcaa04 = d.kcaa04
      node.kcaa05Display = d.kcaa05
    }
    if (Array.isArray(node.children) && node.children.length) {
      applyDisplayToPiBomTree(node.children, displayMap)
    }
  }
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 * @param {string} productKcaa01
 */
async function fetchPiBomListRowIdsForProduct(tx, piNo, productKcaa01) {
  const headSc = await fetchPiBomHeadSystemcode(tx, piNo, productKcaa01)
  if (!headSc) return []
  const subtree = await collectPiBomSubtreeParentCodes(tx, piNo, headSc)
  const parents = [...subtree]
  if (!parents.length) return []

  /** @type {number[]} */
  const ids = []
  for (let i = 0; i < parents.length; i += 40) {
    const batch = parents.slice(i, i + 40)
    const req = new sql.Request(tx)
    req.input('pi', sql.NVarChar(200), normKcaa01(piNo))
    const or = []
    for (let j = 0; j < batch.length; j++) {
      const p = `pp${i}_${j}`
      req.input(p, sql.NVarChar(500), batch[j])
      or.push(`LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) = @${p}`)
    }
    const r = await req.query(`
      SELECT l.[id]
      FROM ${PI_BOM_LIST_FROM} AS l
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND (${or.join(' OR ')})
    `)
    for (const row of r.recordset ?? []) {
      const id = Number(row.id)
      if (Number.isFinite(id) && id > 0) ids.push(id)
    }
  }
  return ids
}

/**
 * @param {{
 *   pool: import('mssql').ConnectionPool,
 *   id: number,
 *   kcaa01?: unknown,
 * }} opts
 */
export async function fetchSalesOrderPiBom(opts) {
  const { pool, id } = opts
  const header = await fetchOrderHeaderForPiBom(pool, id)
  if (!header) return { ok: false, status: 404, msg: '记录不存在' }

  const stateErr = validatePiBomMaintainOrderState(header)
  if (stateErr && String(header.del ?? '').trim() === '1') {
    return { ok: false, status: 400, msg: stateErr }
  }

  const piNo = normKcaa01(header.piNo)
  const products = await fetchOrderLineProducts(pool, piNo)
  const existsSet = await fetchPiBomExistsByProduct(pool, piNo, products)

  const parsed = parsePiBomMaintainKcaa01(opts.kcaa01)
  if (!parsed.ok) {
    return {
      ok: true,
      piNo,
      products: products.map((kcaa01) => ({
        kcaa01,
        hasBom: existsSet.has(kcaa01),
      })),
    }
  }

  const lineErr = validatePiBomMaintainLineOnOrder(parsed.kcaa01, products)
  if (lineErr) return { ok: false, status: 400, msg: lineErr }

  const headSc = await fetchPiBomHeadSystemcode(pool, piNo, parsed.kcaa01)
  if (!headSc) {
    return { ok: false, status: 404, msg: `货品「${parsed.kcaa01}」尚未建立 PI BOM，请先保存订单` }
  }

  let tree
  try {
    tree = await buildPiBomUsageTreeForProduct(pool, piNo, parsed.kcaa01)
  } catch (err) {
    if (err?.code === 'PI_BOM_MISSING') {
      return { ok: false, status: 404, msg: String(err.message) }
    }
    if (err?.code === 'BOM_CYCLE' || err?.code === 'BOM_DEPTH') {
      return { ok: false, status: 400, msg: String(err.message) }
    }
    throw err
  }

  const flat = flattenPiBomTreeForEdit(tree)
  const displayMap = await enrichBom000DisplayByKcaa01(
    pool,
    flat.map((r) => r.kcaa01),
  )
  applyDisplayToPiBomTree(tree, displayMap)
  for (const row of flat) {
    const d = displayMap.get(normKcaa01(row.kcaa01))
    if (d) {
      row.kcaa02 = d.kcaa02
      row.kcaa03 = d.kcaa03
      row.unit = d.kcaa04
      row.color = d.kcaa05
    }
  }

  const headReq = await pool
    .request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('product', sql.NVarChar(300), parsed.kcaa01)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(ISNULL(CAST(h.[systemcode] AS nvarchar(500)), N''))) AS systemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaa02], N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaa03], N'')))) AS kcaa03
      FROM ${PI_BOM_HEAD_FROM} AS h
      WHERE LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @product
    `)

  return {
    ok: true,
    piNo,
    kcaa01: parsed.kcaa01,
    head: headReq.recordset?.[0] ?? null,
    tree,
    flat,
    products: products.map((kcaa01) => ({
      kcaa01,
      hasBom: existsSet.has(kcaa01),
    })),
  }
}

/**
 * @param {{
 *   pool: import('mssql').ConnectionPool,
 *   id: number,
 *   kcaa01: unknown,
 *   lines: unknown,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   ip: string,
 * }} opts
 */
export async function saveSalesOrderPiBom(opts) {
  const { pool, id, actor, ip } = opts
  const parsedProduct = parsePiBomMaintainKcaa01(opts.kcaa01)
  if (!parsedProduct.ok) return { ok: false, status: 400, msg: parsedProduct.msg }

  const parsedLines = parsePiBomMaintainLines(opts.lines)
  if (!parsedLines.ok) return { ok: false, status: 400, msg: parsedLines.msg }

  const header = await fetchOrderHeaderForPiBom(pool, id)
  if (!header) return { ok: false, status: 404, msg: '记录不存在' }

  const stateErr = validatePiBomMaintainOrderState(header)
  if (stateErr) return { ok: false, status: 400, msg: stateErr }

  const piNo = normKcaa01(header.piNo)
  const lineCodes = await fetchOrderLineProducts(pool, piNo)
  const lineErr = validatePiBomMaintainLineOnOrder(parsedProduct.kcaa01, lineCodes)
  if (lineErr) return { ok: false, status: 400, msg: lineErr }

  const headSc = await fetchPiBomHeadSystemcode(pool, piNo, parsedProduct.kcaa01)
  if (!headSc) {
    return { ok: false, status: 404, msg: `货品「${parsedProduct.kcaa01}」尚未建立 PI BOM，请先保存订单` }
  }

  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const validIds = await fetchPiBomListRowIdsForProduct(tx, piNo, parsedProduct.kcaa01)
    const idErr = validatePiBomLineIdsBelongToProduct(validIds, parsedLines.lines)
    if (idErr) {
      await tx.rollback()
      return { ok: false, status: 400, msg: idErr }
    }

    let updated = 0
    for (const row of parsedLines.lines) {
      const up = new sql.Request(tx)
      up.input('id', sql.Int, row.id)
      up.input('pi', sql.NVarChar(200), piNo)
      up.input('kcac04', sql.Decimal(18, 6), row.kcac04)
      up.input('kcac05', sql.Decimal(18, 6), row.kcac05)
      up.input('Describe', sql.NVarChar(500), row.Describe)
      const ur = await up.query(`
        UPDATE l
        SET l.[kcac04] = @kcac04,
            l.[kcac05] = @kcac05,
            l.[Describe] = @Describe
        FROM ${PI_BOM_LIST_FROM} AS l
        WHERE l.[id] = @id
          AND LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
      `)
      updated += Number(ur.rowsAffected?.[0] ?? 0)
    }

    if (updated === 0) {
      await tx.rollback()
      return { ok: false, status: 400, msg: '未更新任何 PI BOM 行，请刷新后重试' }
    }

    const now = formatSalesOrderAuditTime()
    const hdrUp = new sql.Request(tx)
    hdrUp.input('id', sql.Int, id)
    hdrUp.input('uname', sql.NVarChar(100), String(actor.uname ?? ''))
    hdrUp.input('utruename', sql.NVarChar(100), String(actor.utruename ?? ''))
    hdrUp.input('uid', sql.NVarChar(50), actor.uidInt != null ? String(actor.uidInt) : '')
    hdrUp.input('edittime', sql.NVarChar(50), now)
    hdrUp.input('ip', sql.NVarChar(100), ip)
    await hdrUp.query(`
      UPDATE ${HEADER_FROM}
      SET [is_pur] = N'0',
          [uname] = @uname,
          [utruename] = @utruename,
          [uid] = @uid,
          [edittime] = @edittime,
          [ip] = @ip
      WHERE [id] = @id
    `)

    await tx.commit()
    return {
      ok: true,
      piNo,
      kcaa01: parsedProduct.kcaa01,
      updated,
      markUncalc: true,
    }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {
      // ignore
    }
    throw err
  }
}
