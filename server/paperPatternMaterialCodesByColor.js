/**
 * 纸格 Material：按第 4 行 colorSources 列对齐，读取各行 N→右全码 ERP（正式导入 Bom_parts）
 */
import { normalizeErpCodeDisplay } from './paperPatternErpCodeNormalize.js'
import { readExcelColNorm } from './paperPatternImportCutRow.js'
import { excelColumnIndexFromLetters } from './paperPatternImportPreview.js'

/**
 * @param {Array<{ colorNo: string, excelCol?: string, colIndex?: number }>} colorSources
 * @returns {Array<{ colorNo: string, colIndex: number }>}
 */
export function normalizeColorSourcesForMaterialColumns(colorSources) {
  if (!Array.isArray(colorSources)) return []
  /** @type {Array<{ colorNo: string, colIndex: number }>} */
  const out = []
  for (const src of colorSources) {
    const colorNo = String(src?.colorNo ?? '').trim()
    if (!colorNo) continue
    let colIndex = Number(src?.colIndex)
    if (!Number.isFinite(colIndex) || colIndex < 1) {
      const letters = String(src?.excelCol ?? '').trim()
      colIndex = excelColumnIndexFromLetters(letters)
    }
    if (!Number.isFinite(colIndex) || colIndex < 1) continue
    out.push({ colorNo, colIndex: Math.trunc(colIndex) })
  }
  return out
}

/**
 * Material 行：与 colorSources 列对齐的全码 ERP
 * @param {{ rowIndex: number, cells: Array<{ colIndex: number, value: string }> }} row
 * @param {Array<{ colorNo: string, excelCol?: string, colIndex?: number }>} colorSources
 * @returns {Array<{ colorNo: string, colIndex: number, materialCode: string }>}
 */
export function buildMaterialCodesByColor(row, colorSources) {
  const cols = normalizeColorSourcesForMaterialColumns(colorSources)
  return cols.map(({ colorNo, colIndex }) => ({
    colorNo,
    colIndex,
    materialCode: normalizeErpCodeDisplay(readExcelColNorm(row, colIndex)),
  }))
}

/**
 * @param {Array<{ groupNo?: string, codesByColor?: Array<{ colorNo: string, materialCode?: string }> }>} materials
 * @param {string[]} colorNos
 * @returns {{ ok: true } | { ok: false, code: string, message: string, data?: object }}
 */
export function validateMaterialCodesByColorForCommit(materials, colorNos) {
  const colors = [...new Set((colorNos || []).map((c) => String(c ?? '').trim()).filter(Boolean))]
  if (colors.length === 0) {
    return { ok: false, code: 'NO_COLORS', message: '缺少颜色编码（请确认第 4 行 N 列起已填写）' }
  }
  const mats = Array.isArray(materials) ? materials : []
  /** @type {Array<{ groupNo: string, colorNo: string, colIndex?: number }>} */
  const missing = []
  for (const m of mats) {
    const groupNo = String(m?.groupNo ?? '').trim()
    if (!groupNo) continue
    const byColor = Array.isArray(m.codesByColor) ? m.codesByColor : []
    for (const colorNo of colors) {
      const hit = byColor.find((x) => String(x?.colorNo ?? '').trim() === colorNo)
      const code = String(hit?.materialCode ?? '').trim()
      if (!code) {
        missing.push({
          groupNo,
          colorNo,
          colIndex: hit?.colIndex,
        })
      }
    }
  }
  if (missing.length > 0) {
    const sample = missing
      .slice(0, 8)
      .map((x) => `分组${x.groupNo}/颜色${x.colorNo}`)
      .join('、')
    const more = missing.length > 8 ? ` 等共 ${missing.length} 处` : ''
    return {
      ok: false,
      code: 'MATERIAL_COLOR_CELL_EMPTY',
      message: `Material 行在对应颜色列 ERP 编码为空，无法导入：${sample}${more}`,
      data: { missing },
    }
  }
  return { ok: true }
}

/**
 * 正式导入：按颜色展开 materials（materialCode 为该色全码）
 * @param {Array<Record<string, unknown>>} materials
 * @param {string} colorNo
 */
export function resolveMaterialsForCommitColor(materials, colorNo) {
  const col = String(colorNo ?? '').trim()
  return (Array.isArray(materials) ? materials : []).map((m) => {
    const byColor = Array.isArray(m.codesByColor) ? m.codesByColor : []
    const hit = byColor.find((x) => String(x?.colorNo ?? '').trim() === col)
    const fullCode = String(hit?.materialCode ?? m?.materialCode ?? '').trim()
    return {
      ...m,
      materialCode: fullCode,
    }
  })
}

/**
 * 收集多色导入需校验的 ERP 全码
 * @param {Array<Record<string, unknown>>} materials
 * @param {string[]} colorNos
 */
/**
 * @param {{ colorNos?: unknown[], colorNo?: string }} body
 * @returns {string[]}
 */
export function resolveCommitColorNos(body) {
  const fromArr = Array.isArray(body?.colorNos) ? body.colorNos : []
  const list = fromArr.map((c) => String(c ?? '').trim()).filter(Boolean)
  if (list.length > 0) return [...new Set(list)]
  const single = String(body?.colorNo ?? '').trim()
  return single ? [single] : []
}

export function collectMaterialErpCodesForAllColors(materials, colorNos) {
  const codes = []
  const seen = new Set()
  for (const colorNo of colorNos) {
    const resolved = resolveMaterialsForCommitColor(materials, colorNo)
    for (const m of resolved) {
      const d = normalizeErpCodeDisplay(m?.materialCode ?? '')
      if (!d) continue
      const k = d.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      codes.push(d)
    }
  }
  return codes
}
