/**
 * 纸格 Accessory 区：A 列序号行 + N→右与识色列对齐；按列展平（跨列不去重，带 colorNo）
 */
import { normalizeErpCodeDisplay } from './paperPatternErpCodeNormalize.js'
import { readExcelColNorm } from './paperPatternImportCutRow.js'
import { normalizeColorSourcesForMaterialColumns } from './paperPatternMaterialCodesByColor.js'

/**
 * @param {string} seqText A 列
 */
export function isAccessorySeqToken(seqText) {
  const t = String(seqText ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return false
  return /^\d+$/.test(t)
}

/**
 * 读 N→右各识色列 ERP（每列一行，跨列不去重；空列跳过）
 * @param {{ rowIndex: number, cells: Array<{ colIndex: number, value: string }> }} row
 * @param {Array<{ colorNo: string, excelCol?: string, colIndex?: number }>} colorSources
 * @returns {Array<{ colorNo: string, colIndex: number, erpCode: string }>}
 */
export function resolveAccessoryCodesByColorFromRow(row, colorSources) {
  const cols = normalizeColorSourcesForMaterialColumns(colorSources)
  /** @type {Array<{ colorNo: string, colIndex: number, erpCode: string }>} */
  const out = []
  for (const { colorNo, colIndex } of cols) {
    const cn = String(colorNo ?? '').trim()
    if (!cn || colIndex == null) continue
    const code = normalizeErpCodeDisplay(readExcelColNorm(row, colIndex))
    if (!code) continue
    out.push({ colorNo: cn, colIndex, erpCode: code })
  }
  return out
}

/**
 * 去重后的 ERP 全码列表（仅用于兼容/调试；正式展平用 resolveAccessoryCodesByColorFromRow）
 * @param {{ rowIndex: number, cells: Array<{ colIndex: number, value: string }> }} row
 * @param {Array<{ colorNo: string, excelCol?: string, colIndex?: number }>} colorSources
 * @returns {string[]}
 */
export function resolveAccessoryErpCodesFromRow(row, colorSources) {
  const seen = new Set()
  /** @type {string[]} */
  const ordered = []
  for (const { erpCode } of resolveAccessoryCodesByColorFromRow(row, colorSources)) {
    if (seen.has(erpCode)) continue
    seen.add(erpCode)
    ordered.push(erpCode)
  }
  return ordered
}

/**
 * Accessory 序号行（A 列纯数字）
 * @param {{ rowIndex: number, cells: Array<{ colIndex: number, value: string }> }} row
 * @param {Array<{ colorNo: string, excelCol?: string, colIndex?: number }>} colorSources
 */
export function tryParseAccessoryRow(row, colorSources = []) {
  const seqNo = String(readExcelColNorm(row, 1) ?? '').trim()
  if (!isAccessorySeqToken(seqNo)) return null
  const codesByColor = resolveAccessoryCodesByColorFromRow(row, colorSources)
  if (codesByColor.length === 0) return null
  return {
    seqNo,
    codesByColor,
    accessoryName: readExcelColNorm(row, 2),
    usageQty: readExcelColNorm(row, 5),
    wastage: readExcelColNorm(row, 8),
    lineTotal: readExcelColNorm(row, 9),
    matching: readExcelColNorm(row, 12),
  }
}

/**
 * 展平为一行一 ERP + colorNo（预览表 / 提交共用）
 * @param {Array<{
 *   seqNo: string,
 *   codesByColor?: Array<{ colorNo: string, colIndex?: number, erpCode: string }>,
 *   accessoryName?: string,
 *   usageQty?: string,
 *   wastage?: string,
 *   lineTotal?: string,
 *   matching?: string
 * }>} rows
 */
export function flattenAccessoriesForDisplay(rows) {
  /** @type {Array<{
 *   seqNo: string,
 *   erpCode: string,
 *   colorNo: string,
 *   colIndex: number | null,
 *   accessoryName: string,
 *   usageQty: string,
 *   wastage: string,
 *   lineTotal: string,
 *   matching: string
 * }>} */
  const out = []
  if (!Array.isArray(rows)) return out
  for (const r of rows) {
    const seqNo = String(r?.seqNo ?? '').trim()
    const byColor = Array.isArray(r?.codesByColor) ? r.codesByColor : []
    for (const item of byColor) {
      const code = String(item?.erpCode ?? '').trim()
      const colorNo = String(item?.colorNo ?? '').trim()
      if (!code || !colorNo) continue
      out.push({
        seqNo,
        erpCode: code,
        colorNo,
        colIndex: item.colIndex != null ? Number(item.colIndex) : null,
        accessoryName: String(r?.accessoryName ?? '').trim(),
        usageQty: String(r?.usageQty ?? '').trim(),
        wastage: String(r?.wastage ?? '').trim(),
        lineTotal: String(r?.lineTotal ?? '').trim(),
        matching: String(r?.matching ?? '').trim(),
      })
    }
  }
  return out
}

/**
 * 正式导入：当前主 BOM 颜色对应的 Accessory 行
 * @param {Array<{ colorNo?: string }>} accessories
 * @param {string} colorNo
 */
export function filterAccessoriesForCommitColor(accessories, colorNo) {
  const cn = String(colorNo ?? '').trim()
  if (!cn) return []
  return (Array.isArray(accessories) ? accessories : []).filter(
    (a) => String(a?.colorNo ?? '').trim() === cn,
  )
}
