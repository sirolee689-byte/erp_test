/**
 * 纸格导入：按 ERP 编码批量读取 Bom_000 主档字段（只读，不写库）
 * kcaa04、kcaa33、kcaa02_en、location、cost_price（采购价）、sale_price（BOM价）、remark
 * 匹配：全码（含 /）精确 kcaa01；基码则 kcaa01 = 基码 OR kcaa01 LIKE「基码/%」
 * 取 id 最大且 kcaa04、kcaa33 同时有效的一条。
 * 注意：本接口为「预览补全」，不按 del 过滤；正式导入 Bom_parts 补全复用 fetchKcaa04Kcaa33ByKcaa01In。
 */
import sql from 'mssql'
import { getPool } from './db.js'
import { erpCodeLookupKey, normalizeErpCodeDisplay } from './paperPatternErpCodeNormalize.js'
import { INV_BOM_MASTER_FROM } from './bomTables.js'
/** 每批 OR 条件数上限（精确 + LIKE） */
const MATERIAL_BOM_FIELDS_BATCH_SIZE = 50

/** SQL Server 2008 R2：Bom_000 数值列安全转 float */
function bom000NumericColSql(colName) {
  const c = String(colName ?? '').trim()
  return `CASE
          WHEN b.[${c}] IS NULL THEN NULL
          WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), b.[${c}])))) = 1
            THEN CONVERT(float, LTRIM(RTRIM(CONVERT(nvarchar(100), b.[${c}]))))
          ELSE NULL
        END`
}

const KCAA33F_SQL = bom000NumericColSql('kcaa33')

const MATERIAL_BOM_FIELDS_SELECT = `
        b.id,
        LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(b.kcaa01, N'')))) AS kcaa01_disp,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.kcaa04, N'')))) AS kcaa04,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02_en, N'')))) AS kcaa02_en,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.location, N'')))) AS location,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.remark, N'')))) AS remark,
        ${KCAA33F_SQL} AS kcaa33f,
        ${bom000NumericColSql('cost_price')} AS cost_price_f,
        ${bom000NumericColSql('sale_price')} AS sale_price_f`

/** @param {unknown} raw — Bom_000 数值列；有效数保留六位小数 */
function parseBom000FloatOrNull(raw) {
  if (raw === null || raw === undefined) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 1e6) / 1e6
}

/**
 * 单条 bom_000 行是否可作为 Material 单位/损耗来源（kcaa04 非空且 kcaa33 可解析为有限数）
 * @param {string} kcaa04
 * @param {number | null | undefined} kcaa33
 */
export function rowQualifiesMaterialBomFields(kcaa04, kcaa33) {
  if (!String(kcaa04 ?? '').trim()) return false
  if (kcaa33 === null || kcaa33 === undefined) return false
  return Number.isFinite(Number(kcaa33))
}

/**
 * 请求编码 → bom_000 查询模式（参数侧已归一化，列侧用 b.kcaa01 直比以走索引）
 * @param {unknown} baseDisplay
 * @returns {{ base: string, likePrefix: string, mode: 'none' | 'exact' | 'prefix' }}
 */
export function materialBom000LookupParams(baseDisplay) {
  const base = normalizeErpCodeDisplay(baseDisplay)
  if (!base) return { base: '', likePrefix: '', mode: 'none' }
  if (base.includes('/')) return { base, likePrefix: '', mode: 'exact' }
  return { base, likePrefix: `${base}/%`, mode: 'prefix' }
}

/**
 * 库内 kcaa01 是否满足对某请求编码的匹配规则
 * @param {unknown} kcaa01FromDb
 * @param {unknown} requestDisplay
 */
export function materialBomRowMatchesRequest(kcaa01FromDb, requestDisplay) {
  const db = normalizeErpCodeDisplay(kcaa01FromDb)
  const req = normalizeErpCodeDisplay(requestDisplay)
  if (!db || !req) return false
  const { mode, base } = materialBom000LookupParams(req)
  if (mode === 'exact') return erpCodeLookupKey(db) === erpCodeLookupKey(req)
  if (mode === 'prefix') {
    if (erpCodeLookupKey(db) === erpCodeLookupKey(base)) return true
    return db.startsWith(`${base}/`)
  }
  return false
}

/**
 * @param {Record<string, unknown>} r
 */
function mapBom000RowToMaterialFields(r) {
  const kcaa04 = String(r.kcaa04 ?? '').trim()
  const kcaa33 = parseBom000FloatOrNull(r.kcaa33f)
  if (!rowQualifiesMaterialBomFields(kcaa04, kcaa33)) return null
  return {
    kcaa04,
    kcaa33,
    kcaa02_en: String(r.kcaa02_en ?? '').trim(),
    location: String(r.location ?? '').trim(),
    remark: String(r.remark ?? '').trim(),
    cost_price: parseBom000FloatOrNull(r.cost_price_f),
    sale_price: parseBom000FloatOrNull(r.sale_price_f),
  }
}

/**
 * 一批请求编码：一次 SQL 拉取可能命中的候选行（ORDER BY id DESC）
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTx
 * @param {string[]} chunk 归一化编码
 */
async function fetchMaterialBomFieldCandidatesForChunk(poolOrTx, chunk) {
  const exactSet = new Set()
  const likeSet = new Set()
  for (const code of chunk) {
    const p = materialBom000LookupParams(code)
    if (p.mode === 'exact') exactSet.add(p.base)
    else if (p.mode === 'prefix') {
      exactSet.add(p.base)
      if (p.likePrefix) likeSet.add(p.likePrefix)
    }
  }
  const exactList = [...exactSet]
  const likeList = [...likeSet]
  if (exactList.length === 0 && likeList.length === 0) return []

  const rq = new sql.Request(poolOrTx)
  const orParts = []
  let idx = 0
  for (const e of exactList) {
    const pname = `e${idx}`
    rq.input(pname, sql.NVarChar(400), e)
    orParts.push(`b.kcaa01 = @${pname}`)
    idx += 1
  }
  for (const l of likeList) {
    const pname = `l${idx}`
    rq.input(pname, sql.NVarChar(400), l)
    orParts.push(`b.kcaa01 LIKE @${pname}`)
    idx += 1
  }

  const rs = await rq.query(`
      SELECT ${MATERIAL_BOM_FIELDS_SELECT}
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE (${orParts.join(' OR ')})
        AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.kcaa04, N'')))) <> N''
        AND ${KCAA33F_SQL} IS NOT NULL
      ORDER BY b.id DESC
    `)
  return rs.recordset ?? []
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTx
 * @param {string[]} erpDisplays 归一化后的 ERP 编码（去重、非空）
 * @returns {Promise<Map<string, {
 *   kcaa04: string,
 *   kcaa33: number | null,
 *   kcaa02_en: string,
 *   location: string,
 *   cost_price: number | null,
 *   sale_price: number | null,
 *   remark: string,
 * }>>} key = erpCodeLookupKey(请求编码)
 */
export async function fetchKcaa04Kcaa33ByKcaa01In(poolOrTx, erpDisplays) {
  /** @type {Map<string, {
   *   kcaa04: string,
   *   kcaa33: number | null,
   *   kcaa02_en: string,
   *   location: string,
   *   cost_price: number | null,
   *   sale_price: number | null,
   *   remark: string,
   * }>} */
  const out = new Map()
  const uniq = [...new Set(erpDisplays.map((d) => normalizeErpCodeDisplay(d)).filter(Boolean))]
  if (uniq.length === 0) return out

  const t0 = Date.now()
  for (let i = 0; i < uniq.length; i += MATERIAL_BOM_FIELDS_BATCH_SIZE) {
    const chunk = uniq.slice(i, i + MATERIAL_BOM_FIELDS_BATCH_SIZE)
    const candidates = await fetchMaterialBomFieldCandidatesForChunk(poolOrTx, chunk)
    for (const reqCode of chunk) {
      const lk = erpCodeLookupKey(reqCode)
      if (!lk || out.has(lk)) continue

      let bestRow = null
      let bestId = -1
      for (const r of candidates) {
        if (!materialBomRowMatchesRequest(r.kcaa01_disp, reqCode)) continue
        const id = Number(r.id)
        if (!Number.isFinite(id) || id <= bestId) continue
        bestId = id
        bestRow = r
      }
      if (!bestRow) continue
      const mapped = mapBom000RowToMaterialFields(bestRow)
      if (mapped) out.set(lk, mapped)
    }
  }

  if (uniq.length > 20) {
    console.log(
      '[paper-pattern-material-bom-fields] 批量查询',
      uniq.length,
      '码，命中',
      out.size,
      '，耗时',
      Date.now() - t0,
      'ms',
    )
  }
  return out
}

/**
 * POST /api/paper-pattern/material-bom-fields
 * body: { codes: string[] }
 * 返回：{ success: true, byKey, items }（items 为调试：库内命中行）
 */
export async function handlePostPaperPatternMaterialBomFields(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const raw = body.codes
    const codes = Array.isArray(raw) ? raw.map((x) => String(x ?? '')) : []
    if (codes.length > 2000) {
      res.status(400).json({ success: false, message: '一次最多查询 2000 条编码' })
      return
    }
    const items = codes.map((raw) => {
      const display = normalizeErpCodeDisplay(raw)
      const key = erpCodeLookupKey(display)
      return { display, key }
    })
    const displaysForDb = [...new Set(items.map((x) => x.display).filter(Boolean))]

    /** 比对键 → 请求里首次出现的展示编码（日志用） */
    const keyToDisplay = new Map()
    for (const { display, key } of items) {
      if (key && !keyToDisplay.has(key)) keyToDisplay.set(key, display || key)
    }

    const t0 = Date.now()
    console.log(
      '[paper-pattern-material-bom-fields] 请求 ERP 数=',
      displaysForDb.length,
      '示例=',
      JSON.stringify(displaysForDb.slice(0, 8)),
    )

    const pool = await getPool()
    const map = await fetchKcaa04Kcaa33ByKcaa01In(pool, displaysForDb)
    const byKey = {}
    const debugItems = []
    for (const [k, v] of map.entries()) {
      byKey[k] = {
        kcaa04: v.kcaa04,
        kcaa33: v.kcaa33,
        kcaa02_en: v.kcaa02_en,
        location: v.location,
        cost_price: v.cost_price,
        sale_price: v.sale_price,
        remark: v.remark,
      }
      debugItems.push({
        code: keyToDisplay.get(k) ?? k,
        unit: v.kcaa04 || '',
        wastage: v.kcaa33,
        kcaa02_en: v.kcaa02_en,
        location: v.location,
        cost_price: v.cost_price,
        sale_price: v.sale_price,
        remark: v.remark,
      })
    }
    console.log(
      '[paper-pattern-material-bom-fields] 库命中=',
      debugItems.length,
      '耗时',
      Date.now() - t0,
      'ms',
      JSON.stringify(debugItems.slice(0, 5)),
    )

    res.json({ success: true, byKey, items: debugItems })
  } catch (e) {
    const detail = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
    console.error('POST /api/paper-pattern/material-bom-fields 失败：', detail, e)
    res.status(500).json({ success: false, message: '读取物料主档字段失败', detail })
  }
}

