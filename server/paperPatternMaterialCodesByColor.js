/**
 * 纸格 Material：按第 4 行 colorSources 列对齐，读取各行 N→右全码 ERP（正式导入 Bom_parts）
 */
import { normalizeErpCodeDisplay } from './paperPatternErpCodeNormalize.js'
import { readExcelColNorm } from './paperPatternImportCutRow.js'
import { excelColumnIndexFromLetters } from './paperPatternImportPreview.js'

export function excelColumnLettersFromIndex(index) {
  let n = Math.trunc(Number(index) || 0)
  if (n < 1) return ''
  let out = ''
  while (n > 0) {
    n -= 1
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26)
  }
  return out
}

export function materialErpPrefix(code) {
  const d = normalizeErpCodeDisplay(code)
  if (!d) return ''
  const slash = d.indexOf('/')
  return (slash >= 0 ? d.slice(0, slash) : d).trim()
}

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
/**
 * @param {Array<{ groupNo?: string, materialName?: string, codesByColor?: Array<{ colorNo: string, colIndex?: number, materialCode?: string }> }>} materials
 * @param {string[]} colorNos
 * @returns {{ ok: true } | { ok: false, code: string, message: string, data: { mismatches: Array<object> } }}
 */
export function validateMaterialPrefixConsistency(materials, colorNos) {
  const colors = [...new Set((colorNos || []).map((c) => String(c ?? '').trim()).filter(Boolean))]
  const mats = Array.isArray(materials) ? materials : []
  const mismatches = []

  for (const m of mats) {
    const groupNo = String(m?.groupNo ?? '').trim()
    if (!groupNo) continue
    const materialName = String(m?.materialName ?? '').trim()
    const byColor = Array.isArray(m.codesByColor) ? m.codesByColor : []
    const sourceColors =
      colors.length > 0
        ? colors
        : byColor.map((x) => String(x?.colorNo ?? '').trim()).filter(Boolean)
    const entries = []

    for (const colorNo of sourceColors) {
      const hit = byColor.find((x) => String(x?.colorNo ?? '').trim() === colorNo)
      const materialCode = normalizeErpCodeDisplay(hit?.materialCode ?? '')
      const prefix = materialErpPrefix(materialCode)
      if (!materialCode || !prefix) continue
      entries.push({
        groupNo,
        materialName,
        colorNo,
        colIndex: hit?.colIndex,
        excelCol: excelColumnLettersFromIndex(hit?.colIndex),
        materialCode,
        prefix,
      })
    }

    const base = entries[0]
    if (!base) continue
    for (const item of entries.slice(1)) {
      if (item.prefix === base.prefix) continue
      mismatches.push({
        ...item,
        expectedPrefix: base.prefix,
        expectedColorNo: base.colorNo,
        expectedColIndex: base.colIndex,
        expectedExcelCol: base.excelCol,
      })
    }
  }

  if (mismatches.length === 0) return { ok: true }
  const sample = mismatches
    .slice(0, 5)
    .map((x) => {
      const col = x.excelCol ? `${x.excelCol}列` : `颜色${x.colorNo}`
      return `Material 序号${x.groupNo}${x.materialName ? `（${x.materialName}）` : ''}：${col} ${x.materialCode} 的前缀 ${x.prefix} 与本行基准 ${x.expectedPrefix} 不一致`
    })
    .join('；')
  const more = mismatches.length > 5 ? ` 等共 ${mismatches.length} 处` : ''
  return {
    ok: false,
    code: 'MATERIAL_PREFIX_MISMATCH',
    message: `${sample}${more}。请检查上传的 Excel 文件是否有误。`,
    data: { mismatches },
  }
}

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
