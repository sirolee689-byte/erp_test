/**
 * 纸格资料导入：厂款号/颜色编码/组别前 10 行辅助解析；厂款号固定 N2、组别优先 M2 否则「组别」标签右侧、客款号固定 L2（优先）；Material/CUT/副料为全文状态机；CUT 明细列按 Excel 第 3～13 列读取，其中「搭配」输出由同分组 Material 备注（第 12 列）汇总，不再沿用 CUT 区第 12 列；Accessory 明细按 B 名称、E 用量、H 损耗、I 合计、L 搭配、ERP 仍取行末最后一个非空格
 */
import { parsePaperPatternExcelFromBuffer, readFirstSheetCellA1FromBuffer } from './paperPatternImportPreview.js'
import { readCutMetricColumnsByExcelCol, readExcelColNorm } from './paperPatternImportCutRow.js'
import {
  buildGroupMatchingMapFromMaterialRemarks,
  cutSeqMajorForMaterialGroup,
} from './paperPatternMaterialGroupMatching.js'

/** 主 BOM（客款号/颜色编码等，Excel 内）允许辅助解析的最大行号（含），与 Excel 行号一致（从 1 起）；厂款号固定读 N2 */
const MAIN_BOM_MAX_ROW_INDEX = 10

/** 纸格模板：厂款号所在单元格（固定） */
const FACTORY_STYLE_CELL_A1 = 'N2'
/** 资料区：组别（固定 M2） */
const FIXED_CELL_GROUP_M2 = 'M2'
/** 资料区：客款号（固定 L2，优先于表内「客款号」标签扫描） */
const FIXED_CELL_CUSTOMER_L2 = 'L2'

/**
 * @param {string} s
 */
function norm(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/：/g, ':')
    .trim()
}

/**
 * @param {{ rowIndex: number, cells: Array<{ colIndex: number, value: string }> }} row
 * @returns {string[]}
 */
function rowCellValues(row) {
  return row.cells.map((c) => norm(c.value))
}

/**
 * @param {string[]} vals
 */
function rowIsAllEmpty(vals) {
  return vals.every((v) => v === '')
}

/**
 * 同一行从 startIdx 起向右找第一个非空单元格
 * @param {string[]} vals
 * @param {number} startIdx
 */
function readRightNonEmpty(vals, startIdx) {
  for (let j = startIdx; j < vals.length; j++) {
    if (vals[j] !== '') return vals[j]
  }
  return ''
}

/**
 * 本行所有非空单元格（从左到右）
 * @param {string[]} vals
 * @returns {Array<{ idx: number, v: string }>}
 */
function nonEmptyCellsLeftToRight(vals) {
  const out = []
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] !== '') out.push({ idx: i, v: vals[i] })
  }
  return out
}

/**
 * 最后一个非空单元格值
 * @param {string[]} vals
 */
function lastNonEmptyValue(vals) {
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i] !== '') return vals[i]
  }
  return ''
}

/**
 * 首个中日韩统一表意文字下标（用于颜色编码：中文颜色名前截断）
 * @param {string} s
 */
function indexOfFirstUnifiedIdeograph(s) {
  const re = /\p{Unified_Ideograph}/u
  const m = re.exec(s)
  return m ? m.index : -1
}

/**
 * 颜色编码（原色号列）：从左到右，遇到首个汉字则截断其前内容并 trim；增强：须为「英文或-」前缀 + 后续汉字（常见颜色描述）
 * @param {string} raw
 */
function normalizeColorNoFromCell(raw) {
  const s = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return ''

  const hi = indexOfFirstUnifiedIdeograph(s)
  if (hi < 0) return norm(s)

  const before = s.slice(0, hi).trim()
  const hasLatinOrHyphen = /[A-Za-z]/.test(before) || before.includes('-')
  // 增强：英文/连字符段 + 后续中文颜色名 → 仅取汉字前部分
  if (hasLatinOrHyphen && before.length > 0) return norm(before)

  return norm(s)
}

/**
 * 颜色编码推断禁用：含此类文案的单元格不作为混排颜色编码来源（避免 Collection样品名称 等标题）
 * @param {string} val
 */
function cellForbiddenForColorInference(val) {
  const t = norm(val)
  if (!t) return true
  const lower = t.toLowerCase()
  if (lower.includes('collection')) return true
  if (t.includes('样品名称')) return true
  if (lower.includes('material')) return true
  if (lower.includes('accessory')) return true
  if (t.includes('主皮')) return true
  if (t.includes('副料')) return true
  return false
}

/** 常见颜色用字：与中文颜色描述同时出现时，才允许作为混排颜色编码候选 */
const COLOR_HINT_CHARS = new Set(['黑', '蓝', '红', '绿', '白', '灰', '棕', '咖', '粉'])

/**
 * 单元格是否含「颜色提示字」（黑/蓝/红等）
 * @param {string} val
 */
function cellHasColorHintChar(val) {
  const s = String(val ?? '')
  for (const ch of s) {
    if (COLOR_HINT_CHARS.has(ch)) return true
  }
  return false
}

/**
 * 顶部区域内：像「N-TEST黑色」「BLU蓝」的混排色号候选（须含颜色提示字且非禁用文案）
 * @param {string} val
 */
function cellLooksLikeMixedColorValue(val) {
  const s = String(val ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return false
  if (cellForbiddenForColorInference(s)) return false
  if (!cellHasColorHintChar(s)) return false
  const hi = indexOfFirstUnifiedIdeograph(s)
  if (hi <= 0) return false
  const before = s.slice(0, hi)
  return /[A-Za-z]/.test(before) || before.includes('-')
}

/**
 * 前 10 行内：若关键词未取到颜色编码，再尝试混排单元格（不做全文扫）
 * @param {Array<{ rowIndex: number, cells: Array<{ colIndex: number, value: string }> }>} rows
 */
function tryFillColorNoFromMixedCellsTopRows(rows, main) {
  if (main.colorNo) return
  for (const row of rows) {
    if (row.rowIndex > MAIN_BOM_MAX_ROW_INDEX) break
    const vals = rowCellValues(row)
    for (const v of vals) {
      if (!v) continue
      if (isTopAreaLabelCell(v)) continue // 跳过明显标签格
      if (cellLooksLikeMixedColorValue(v)) {
        main.colorNo = normalizeColorNoFromCell(v)
        return
      }
    }
  }
}

/**
 * 厂款号（N2）候选禁用：标题/说明类文案
 * @param {string} val
 */
function cellForbiddenForFactoryStyleNo(val) {
  const t = norm(val)
  if (!t) return true
  const lower = t.toLowerCase()
  if (lower.includes('paper pattern')) return true
  if (t.includes('纸格号')) return true
  if (lower.includes('collection')) return true
  if (t.includes('样品名称')) return true
  if (lower.includes('accessory')) return true
  if (lower.includes('material')) return true
  return false
}

/**
 * 顶部区域列名/标题格（颜色编码混排扫描时跳过）
 * @param {string} v
 */
function isTopAreaLabelCell(v) {
  const x = norm(v)
  if (!x) return false
  if (x.includes('客款号')) return true
  if (x.includes('厂款号')) return true
  if (x.includes('款号')) return true
  if (x.includes('组别')) return true
  if (x.includes('色号')) return true
  if (x.includes('颜色编码')) return true
  if (x.includes('样品名称')) return true
  return false
}

/**
 * 编码用厂款号标准化：去掉 *、空白、中划线（与前端 `paperPatternImportCodes.js` 须保持规则一致）
 * @param {string} s
 */
export function normalizeFactoryStyleForEncoding(s) {
  return String(s ?? '')
    .replace(/\*/g, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .trim()
}

/**
 * 模板厂款号：须 PQ- 开头（不区分大小写）+ 后续字母数字与中划线；须含数字；无中文；不以「-」开头（避免客款号）
 * @param {string} compact 已去空白
 */
function isValidFactoryStyleNoCompact(compact) {
  if (!compact || compact.length < 8) return false
  if (compact.startsWith('-')) return false
  if (cellForbiddenForFactoryStyleNo(compact)) return false
  if (/\p{Unified_Ideograph}/u.test(compact)) return false
  const noStar = compact.replace(/\*/g, '')
  if (!/^PQ-[A-Za-z0-9-]+$/i.test(noStar)) return false
  if (!/[0-9]/.test(noStar)) return false
  return true
}

/**
 * 从 N2 显示文本解析厂款号 raw（保留 PQ-）与 normalized（去横线）
 * @param {string} rawDisplay
 * @returns {{ raw: string, normalized: string }}
 */
function parseFactoryStyleFromN2Display(rawDisplay) {
  const compact = String(rawDisplay ?? '')
    .replace(/\s+/g, '')
    .trim()
  if (!isValidFactoryStyleNoCompact(compact)) return { raw: '', normalized: '' }
  return { raw: compact, normalized: normalizeFactoryStyleForEncoding(compact) }
}

/**
 * 标签单元格 → 可解析字段（客款号、颜色编码、组别；厂款号固定 N2；客款号优先以 L2 为准；组别 M2 优先于标签扫描）
 * @param {string} cell
 * @returns {'customerStyleNo'|'colorNo'|'groupLabel'|null}
 */
function topAreaDataFieldFromLabelCell(cell) {
  const v = norm(cell)
  if (!v) return null
  if (v.includes('客款号')) return 'customerStyleNo'
  if (v.includes('颜色编码')) return 'colorNo'
  if (v.includes('色号')) return 'colorNo'
  if (v.includes('组别')) return 'groupLabel'
  if (v.includes('样品名称')) return 'sampleName'
  return null
}

/**
 * 前 10 行：客款号、颜色编码、组别（关键词右侧）；厂款号不从此处取；客款号最终以 L2 为准（若有值）；组别最终以 M2 为准（若有值）
 * @param {string[]} vals
 * @param {{ customerStyleNo: string, colorNo: string, groupLabel: string, sampleName: string }} main
 */
function extractTopAreaBomFromRow(vals, main) {
  for (let i = 0; i < vals.length; i++) {
    const key = topAreaDataFieldFromLabelCell(vals[i])
    if (!key) continue
    if (key === 'customerStyleNo') {
      if (main.customerStyleNo) continue
      const val = readRightNonEmpty(vals, i + 1)
      if (val) main.customerStyleNo = norm(val)
      continue
    }
    if (key === 'colorNo') {
      if (main.colorNo) continue
      const val = readRightNonEmpty(vals, i + 1)
      if (!val) continue
      if (cellForbiddenForColorInference(val)) continue
      main.colorNo = val
      continue
    }
    if (key === 'groupLabel') {
      if (main.groupLabel) continue
      const val = readRightNonEmpty(vals, i + 1)
      if (val) main.groupLabel = norm(val)
      continue
    }
    if (key === 'sampleName') {
      if (main.sampleName) continue
      const val = readRightNonEmpty(vals, i + 1)
      if (val) main.sampleName = norm(val)
    }
  }
}

/**
 * 任意单元格触发 Accessory 模式（Accessory 或 副料）
 * @param {string[]} vals
 */
function rowTriggersAccessoryMode(vals) {
  for (const v of vals) {
    if (!v) continue
    if (v.includes('副料')) return true
    if (v.toLowerCase().includes('accessory')) return true
  }
  return false
}

/**
 * @param {string} seqText
 */
function isMaterialFirstToken(seqText) {
  const t = norm(seqText)
  if (!t) return false
  return /^\d+$/.test(t)
}

/**
 * @param {string} seqText
 */
function isCutFirstToken(seqText) {
  const t = norm(seqText)
  if (!t) return false
  return /^\d+-\d+$/.test(t)
}

/**
 * 主 BOM 编码：导入类型-{标准化厂款号}/颜色编码（示例 BAG-PQ2803H1/N-TEST；厂款号不含「-」）
 * @param {{ importTypeFlag5: string, styleNo: string, colorNo: string }} p styleNo 为标准化厂款号
 */
export function buildMainBomCode(p) {
  const prefix = norm(p.importTypeFlag5)
  const sn = norm(p.styleNo)
  const col = norm(p.colorNo)
  if (!prefix || !sn || !col) return ''
  return `${prefix}-${sn}/${col}`
}

/**
 * CUT 编码：CUT-{导入类型}{标准化厂款号}/{颜色编码}<序号>（示例 CUT-BAGPQ2803H1/N-TEST<1-1>）
 * @param {{ importTypeFlag5: string, styleNo: string, colorNo: string, cutSeq: string }} p styleNo 为标准化厂款号
 */
export function buildCutCode(p) {
  const prefix = norm(p.importTypeFlag5)
  const sn = norm(p.styleNo)
  const col = norm(p.colorNo)
  const seq = norm(p.cutSeq)
  if (!prefix || !sn || !col || !seq) return ''
  return `CUT-${prefix}${sn}/${col}<${seq}>`
}

/**
 * Material 行：分组/名称/末格 ERP；备注为 Excel 绝对第 12 列（旧系统 rs(11)）
 * @param {{ rowIndex: number, cells: Array<{ colIndex: number, value: string }> }} row
 * @returns {{ groupNo: string, materialName: string, materialCode: string, remark: string, usageQty: string } | null}
 */
function tryParseMaterialRow(row) {
  const vals = rowCellValues(row)
  const cells = nonEmptyCellsLeftToRight(vals)
  if (cells.length === 0) return null
  if (!isMaterialFirstToken(cells[0].v)) return null
  const groupNo = norm(cells[0].v)
  const materialName = cells.length >= 2 ? norm(cells[1].v) : ''
  const materialCode = norm(cells[cells.length - 1].v)
  const remark = readExcelColNorm(row, 12)
  const usageQty = readExcelColNorm(row, 5)
  return { groupNo, materialName, materialCode, remark, usageQty }
}

/**
 * CUT 行：首格（从左第一个非空）须为「1-1」式序号；裁片名称优先第 2 列，否则取第二个非空格；第 3～13 列为尺寸与用量（Excel 绝对列号）
 * @param {{ rowIndex: number, cells: Array<{ colIndex: number, value: string }> }} row
 * @returns {{
 *   cutSeq: string,
 *   cutName: string,
 *   length: string,
 *   width: string,
 *   quantity: string,
 *   fabricWidth: string,
 *   unitConsumption: string,
 *   wastage: string,
 *   actualConsumption: string,
 *   unitPrice: string,
 *   totalAmount: string,
 *   matching: string,
 *   unit: string
 * } | null}
 */
function tryParseCutRow(row) {
  const vals = rowCellValues(row)
  const cells = nonEmptyCellsLeftToRight(vals)
  if (cells.length === 0) return null
  if (!isCutFirstToken(cells[0].v)) return null
  const cutSeq = norm(cells[0].v)
  const nameCol2 = readExcelColNorm(row, 2)
  const cutName = nameCol2 || (cells.length >= 2 ? norm(cells[1].v) : '')
  return { cutSeq, cutName, ...readCutMetricColumnsByExcelCol(row) }
}

/**
 * @param {Buffer} buf
 * @param {{ importTypeFlag5?: string, importTypeFlag1?: string }} [options]
 * @returns {{
 *   mainBom: {
 *     importTypeFlag5: string,
 *     importTypeFlag1: string,
 *     importTypeDisplay: string,
 *     styleNo: string,
 *     styleNoRaw: string,
 *     styleNoNormalized: string,
 *     customerStyleNo: string,
 *     groupLabel: string,
 *     sampleName: string,
 *     colorNo: string,
 *     bomCode: string
 *   },
 *   cuts: Array<{
 *     cutSeq: string,
 *     cutName: string,
 *     cutCode: string,
 *     length: string,
 *     width: string,
 *     quantity: string,
 *     fabricWidth: string,
 *     unitConsumption: string,
 *     wastage: string,
 *     actualConsumption: string,
 *     unitPrice: string,
 *     totalAmount: string,
 *     matching: string,
 *     unit: string
 *   }>,
 *   materials: Array<{ groupNo: string, materialName: string, materialCode: string, remark: string, usageQty: string }>,
 *   accessories: Array<{
 *     erpCode: string,
 *     accessoryName: string,
 *     usageQty: string,
 *     wastage: string,
 *     lineTotal: string,
 *     matching: string
 *   }>,
 *   warnings: string[]
 * }}
 */
export function parsePaperPatternImportTreeFromBuffer(buf, options = {}) {
  const { rows } = parsePaperPatternExcelFromBuffer(buf)

  const importTypeFlag5 = norm(options.importTypeFlag5 ?? '')
  const importTypeFlag1 = norm(options.importTypeFlag1 ?? '')
  const importTypeDisplay =
    importTypeFlag1 && importTypeFlag5
      ? `${importTypeFlag1}(${importTypeFlag5})`
      : importTypeFlag5 || importTypeFlag1

  /** @type {{ styleNoRaw: string, styleNoNormalized: string, customerStyleNo: string, colorNo: string, groupLabel: string, sampleName: string }} */
  const main = {
    styleNoRaw: '',
    styleNoNormalized: '',
    customerStyleNo: '',
    colorNo: '',
    groupLabel: '',
    sampleName: '',
  }

  /** @type {Array<{ cutSeq: string, cutName: string, length: string, width: string, quantity: string, fabricWidth: string, unitConsumption: string, wastage: string, actualConsumption: string, unitPrice: string, totalAmount: string, matching: string, unit: string }>} */
  const cutRows = []
  /** @type {Array<{ groupNo: string, materialName: string, materialCode: string, remark: string, usageQty: string }>} */
  const materials = []
  /** @type {Array<{ erpCode: string, accessoryName: string, usageQty: string, wastage: string, lineTotal: string, matching: string }>} */
  const accessories = []

  /** @type {'normal' | 'accessory'} */
  let mode = 'normal'
  let accessoryEmptyStreak = 0

  for (const row of rows) {
    const vals = rowCellValues(row)

    // 顶部区域：仅前 10 行解析客款号、颜色编码、组别（厂款号固定读 N2；客款号优先 L2、组别优先 M2，见文末）
    if (row.rowIndex <= MAIN_BOM_MAX_ROW_INDEX) {
      extractTopAreaBomFromRow(vals, main)
    }

    if (mode === 'accessory') {
      if (rowIsAllEmpty(vals)) {
        accessoryEmptyStreak++
        if (accessoryEmptyStreak >= 2) {
          mode = 'normal'
          accessoryEmptyStreak = 0
        }
        continue
      }
      accessoryEmptyStreak = 0
      const code = lastNonEmptyValue(vals)
      if (code) {
        accessories.push({
          erpCode: norm(code),
          // Accessory 区：B 名称、E 用量、H 损耗、I 合计、L 搭配（Excel 绝对列号，与模板列一致）
          accessoryName: readExcelColNorm(row, 2),
          usageQty: readExcelColNorm(row, 5),
          wastage: readExcelColNorm(row, 8),
          lineTotal: readExcelColNorm(row, 9),
          matching: readExcelColNorm(row, 12),
        })
      }
      continue
    }

    // normal
    if (rowTriggersAccessoryMode(vals)) {
      mode = 'accessory'
      accessoryEmptyStreak = 0
      continue
    }

    const mat = tryParseMaterialRow(row)
    if (mat) {
      materials.push(mat)
      continue
    }

    const cutRow = tryParseCutRow(row)
    if (cutRow) {
      cutRows.push({ ...cutRow })
      continue
    }
  }

  // 厂款号：固定读取模板 N2（PQ-… 格式），标准化去掉中划线；不参与客款号
  const n2Display = readFirstSheetCellA1FromBuffer(buf, FACTORY_STYLE_CELL_A1)
  const parsedN2 = parseFactoryStyleFromN2Display(n2Display)
  main.styleNoRaw = parsedN2.raw
  main.styleNoNormalized = parsedN2.normalized

  // 颜色编码：中英混排时取首个汉字之前；无标签时仅在前 10 行内尝试混排格
  main.colorNo = normalizeColorNoFromCell(main.colorNo)
  tryFillColorNoFromMixedCellsTopRows(rows, main)

  // 组别：M2 优先；M2 空时保留前 10 行「组别」标签右侧解析值
  const m2Group = norm(readFirstSheetCellA1FromBuffer(buf, FIXED_CELL_GROUP_M2))
  main.groupLabel = m2Group || main.groupLabel
  // 客款号：固定 L2（有值则覆盖前 10 行关键词解析结果）
  const l2Customer = norm(readFirstSheetCellA1FromBuffer(buf, FIXED_CELL_CUSTOMER_L2))
  if (l2Customer) main.customerStyleNo = l2Customer

  const styleNoRaw = main.styleNoRaw
  const styleNoNormalized = norm(main.styleNoNormalized)
  const customerStyleNo = norm(main.customerStyleNo)
  const colorNo = norm(main.colorNo)

  const bomCode = buildMainBomCode({ importTypeFlag5, styleNo: styleNoNormalized, colorNo })

  // CUT 预览「搭配」：与同分组 Material 备注（第 12 列）一致；无备注的分组搭配为空（不再用 CUT 区原第 12 列）
  const groupMatching = buildGroupMatchingMapFromMaterialRemarks(materials)
  const cuts = cutRows.map((c) => {
    const major = cutSeqMajorForMaterialGroup(c.cutSeq)
    const matchingFromMaterial = major ? (groupMatching.get(major) ?? '') : ''
    return {
      cutSeq: c.cutSeq,
      cutName: c.cutName,
      cutCode: buildCutCode({
        importTypeFlag5,
        styleNo: styleNoNormalized,
        colorNo,
        cutSeq: c.cutSeq,
      }),
      length: c.length,
      width: c.width,
      quantity: c.quantity,
      fabricWidth: c.fabricWidth,
      unitConsumption: c.unitConsumption,
      wastage: c.wastage,
      actualConsumption: c.actualConsumption,
      unitPrice: c.unitPrice,
      totalAmount: c.totalAmount,
      matching: matchingFromMaterial,
      unit: c.unit,
    }
  })

  /** @type {string[]} */
  const warnings = []
  if (!styleNoNormalized) {
    warnings.push('未找到厂款号（请确认模板 N2 为 PQ- 开头格式，如 PQ-2803H1）')
  }
  if (!colorNo) warnings.push('未找到颜色编码')
  if (!importTypeFlag5) warnings.push('未指定导入类型（BOM 前缀）')

  if (!bomCode && (importTypeFlag5 || styleNoNormalized || colorNo)) {
    warnings.push('主 BOM 编码无法生成：需同时具备导入类型前缀、标准化厂款号、颜色编码')
  }

  const mainBom = {
    importTypeFlag5,
    importTypeFlag1,
    importTypeDisplay,
    styleNo: styleNoNormalized,
    styleNoRaw,
    styleNoNormalized,
    customerStyleNo,
    groupLabel: main.groupLabel,
    sampleName: main.sampleName,
    colorNo,
    bomCode,
  }

  // 字段调试输出（厂款号 raw / 标准化、组别、客款号、颜色编码）
  console.log(
    '[paper-pattern-parse-debug]',
    JSON.stringify({
      styleNoRaw,
      styleNoNormalized,
      groupLabel: main.groupLabel,
      customerStyleNo,
      colorNo,
    }),
  )

  // 调试输出（真实模板联调；结构与需求一致，数组内为已解析项）
  console.log(
    '[paper-pattern-parse]',
    JSON.stringify({
      importTypeFlag5,
      styleNoRaw,
      styleNoNormalized,
      groupLabel: main.groupLabel,
      customerStyleNo,
      colorNo,
      materials: materials.map((m) => ({
        groupNo: m.groupNo,
        materialName: m.materialName,
        materialCode: m.materialCode,
        remark: m.remark,
      })),
      cuts: cuts.map((c) => ({
        cutSeq: c.cutSeq,
        cutName: c.cutName,
        cutCode: c.cutCode,
        length: c.length,
        width: c.width,
        quantity: c.quantity,
      })),
      accessories: accessories.map((a) => ({
        erpCode: a.erpCode,
        accessoryName: a.accessoryName,
        usageQty: a.usageQty,
        wastage: a.wastage,
        lineTotal: a.lineTotal,
        matching: a.matching,
      })),
    }),
  )

  return { mainBom, cuts, materials, accessories, warnings }
}
