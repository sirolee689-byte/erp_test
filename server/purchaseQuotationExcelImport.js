/**
 * 采购报价 Excel 批量添加：只核验 BOM 主档并返回页面所需快照，不写任何业务表。
 * 前端已完成逐行格式、重复编码和当前报价明细重复的校验；本接口只做一次性物料匹配。
 */
import { sql } from './db.js'

const API = '/api/supply-chain/purchase-quotations/excel-import/materials'
const BOM = 'dbo.[UB_ERP_Bom_000]'
export const PURCHASE_QUOTE_EXCEL_IMPORT_MAX_CODES = 1000

function text(value) { return String(value ?? '').trim() }
function keyOf(value) { return text(value).toLocaleLowerCase() }
function isActive(value) { const v = text(value); return v === '' || v === '0' }
function isAudited(value) { return text(value) === '1' }
function isCutCode(value) { return text(value).toUpperCase().startsWith('CUT-') }

/** 归类单个编码的所有物料候选，保证“多个有效物料”不会被静默取第一条。 */
export function classifyPurchaseQuoteExcelMaterial(code, rows) {
  const all = Array.isArray(rows) ? rows : []
  if (!all.length) return { code, status: 'not-found', message: '物料编码不存在' }

  const active = all.filter((row) => isActive(row.del))
  const eligible = active.filter((row) => isAudited(row.pass) && !isCutCode(row.kcaa01))
  if (eligible.length > 1) return { code, status: 'duplicate', message: '编码对应多个有效物料，无法唯一匹配' }
  if (eligible.length === 1) return { code, status: 'ok', message: '', material: eligible[0] }
  if (!active.length) return { code, status: 'deleted', message: '物料已删除' }
  if (active.some((row) => !isAudited(row.pass))) return { code, status: 'unapproved', message: '物料未审核' }
  return { code, status: 'not-selectable', message: '物料不符合采购报价可选条件' }
}

function normalizeCodes(input) {
  if (!Array.isArray(input)) throw new Error('参数错误：codes 必须是编码数组')
  if (input.length > PURCHASE_QUOTE_EXCEL_IMPORT_MAX_CODES) {
    throw new Error(`单次最多核验 ${PURCHASE_QUOTE_EXCEL_IMPORT_MAX_CODES} 条物料编码`)
  }
  const result = []
  const seen = new Set()
  for (const raw of input) {
    const code = text(raw)
    if (!code) continue
    const key = keyOf(code)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(code)
  }
  return result
}

export async function fetchPurchaseQuoteExcelMaterials(pool, inputCodes) {
  const codes = normalizeCodes(inputCodes)
  if (!codes.length) return []

  // SQL Server 2008 R2 无 JSON/TVP 依赖；1000 个参数低于 2100 参数上限，避免逐条查询。
  const request = pool.request()
  const params = codes.map((code, index) => {
    const name = `code_${index}`
    request.input(name, sql.NVarChar(500), code)
    return `@${name}`
  })
  const query = await request.query(`
    SELECT
      [id], [GUID], [systemcode], [kcaa01], [kcaa02], [kcaa02_en], [kcaa03],
      [kcaa04], [kcaa05], [kcaa11], [kcaa25], [mq], [zq], [del], [pass]
    FROM ${BOM}
    WHERE [kcaa01] IN (${params.join(', ')})
    ORDER BY [id] DESC
  `)

  const grouped = new Map()
  for (const row of query.recordset ?? []) {
    const key = keyOf(row.kcaa01)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(row)
  }
  return codes.map((code) => classifyPurchaseQuoteExcelMaterial(code, grouped.get(keyOf(code)) ?? []))
}

export function registerPurchaseQuotationExcelImportRoutes(app, deps) {
  app.post(API, async (req, res) => {
    try {
      const list = await fetchPurchaseQuoteExcelMaterials(await deps.getPool(), req.body?.codes)
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      const message = String(err?.message ?? 'Excel 物料核验失败')
      res.status(400).json({ code: 400, msg: `Excel 物料核验失败：${message}`, data: null })
    }
  })
}

export const __purchaseQuotationExcelImportForTest = {
  classifyPurchaseQuoteExcelMaterial,
  normalizeCodes,
}
