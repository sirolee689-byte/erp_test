/**
 * 纸格导入：按 ERP 编码批量读取 Bom_000 材料单位 kcaa04、损耗 kcaa33（只读，不写库）
 * 匹配：bom_000.kcaa01（去首尾空白）与 Excel 侧 ERP 编码（normalizeErpCodeDisplay）一致。
 * 注意：本接口为「预览补全」，不按 del 过滤，与手工 SELECT kcaa01=… 一致；校验接口仍可按 del 过滤。
 */
import sql from 'mssql'
import { getPool } from './db.js'
import { erpCodeLookupKey, normalizeErpCodeDisplay } from './paperPatternErpCodeNormalize.js'

const INV_BOM_MASTER_TABLE = (() => {
  const raw = String(process.env.INV_BOM_MASTER_TABLE ?? 'bom_000').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'bom_000'
})()
const INV_BOM_MASTER_FROM = `dbo.[${INV_BOM_MASTER_TABLE}]`

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTx
 * @param {string[]} erpDisplays 归一化后的 ERP 展示串（去重、非空），与 Excel Material 列一致，如 NN-0021/580
 * @returns {Promise<Map<string, { kcaa04: string, kcaa33: number | null }>>} key = erpCodeLookupKey(库内 kcaa01)
 */
export async function fetchKcaa04Kcaa33ByKcaa01In(poolOrTx, erpDisplays) {
  /** @type {Map<string, { kcaa04: string, kcaa33: number | null }>} */
  const out = new Map()
  const uniq = [...new Set(erpDisplays.map((d) => normalizeErpCodeDisplay(d)).filter(Boolean))]
  if (uniq.length === 0) return out

  const chunkSize = 80
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize)
    const rq = new sql.Request(poolOrTx)
    const partsDisp = []
    const partsLow = []
    for (let j = 0; j < chunk.length; j++) {
      const dname = `d${j}`
      const lname = `l${j}`
      rq.input(dname, sql.NVarChar(400), chunk[j])
      rq.input(lname, sql.NVarChar(400), erpCodeLookupKey(chunk[j]))
      partsDisp.push(`@${dname}`)
      partsLow.push(`@${lname}`)
    }
    const inDisp = partsDisp.join(', ')
    const inLow = partsLow.join(', ')
    // kcaa33：兼容 SQL Server 2008 R2（无 TRY_CONVERT），非数字视为 NULL
    const rs = await rq.query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(b.kcaa01, N'')))) AS kcaa01_disp,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.kcaa04, N'')))) AS kcaa04,
        CASE
          WHEN b.kcaa33 IS NULL THEN NULL
          WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), b.kcaa33)))) = 1
            THEN CONVERT(float, LTRIM(RTRIM(CONVERT(nvarchar(100), b.kcaa33))))
          ELSE NULL
        END AS kcaa33f
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE (
          LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(b.kcaa01, N'')))) IN (${inDisp})
          OR LOWER(LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(b.kcaa01, N''))))) IN (${inLow})
        )
    `)
    for (const r of rs.recordset || []) {
      const disp = normalizeErpCodeDisplay(String(r.kcaa01_disp ?? ''))
      const lk = erpCodeLookupKey(disp)
      if (!lk) continue
      if (out.has(lk)) continue
      const kcaa04 = String(r.kcaa04 ?? '').trim()
      const raw33 = r.kcaa33f
      const kcaa33 =
        raw33 === null || raw33 === undefined || Number.isNaN(Number(raw33)) ? null : Number(raw33)
      out.set(lk, { kcaa04, kcaa33 })
    }
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
    /** 与 validate 一致：IN 列表用「展示用 ERP 串」，不用纯小写键 */
    const displaysForDb = [...new Set(items.map((x) => x.display).filter(Boolean))]

    /** 比对键 → 请求里首次出现的展示编码（日志用） */
    const keyToDisplay = new Map()
    for (const { display, key } of items) {
      if (key && !keyToDisplay.has(key)) keyToDisplay.set(key, display || key)
    }

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
      byKey[k] = { kcaa04: v.kcaa04, kcaa33: v.kcaa33 }
      debugItems.push({
        code: keyToDisplay.get(k) ?? k,
        unit: v.kcaa04 || '',
        wastage: v.kcaa33,
      })
    }
    console.log('[paper-pattern-material-bom-fields] 库命中=', debugItems.length, JSON.stringify(debugItems))

    res.json({ success: true, byKey, items: debugItems })
  } catch (e) {
    const detail = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
    console.error('POST /api/paper-pattern/material-bom-fields 失败：', detail, e)
    res.status(500).json({ success: false, message: '读取物料主档字段失败', detail })
  }
}
