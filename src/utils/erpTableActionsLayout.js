/**
 * 主列表/表格操作区 Grid 列数：最多两行。
 * - 可见按钮 n < 7：每行最多 3 列
 * - n >= 7：每行 ceil(n/2) 列，保证两行内排完（如 7 → 4+3）
 */
export function getErpTableActionsColCount(buttonCount) {
  const n = Math.max(0, Number(buttonCount) || 0)
  if (n <= 0) return 1
  if (n >= 7) return Math.ceil(n / 2)
  return Math.min(3, n)
}

/** @deprecated 使用 CSS 变量；保留供测试或脚本引用 */
export function erpTableActionsGridClass(buttonCount) {
  return `erp-table-actions--cols-${getErpTableActionsColCount(buttonCount)}`
}

/** 紧凑列表（BOM 主列表等）单列按钮估宽 px */
export const ERP_TABLE_ACTIONS_BTN_WIDTH_COMPACT = 80
/** 通用主列表单列按钮估宽 px */
export const ERP_TABLE_ACTIONS_BTN_WIDTH_DEFAULT = 88
export const ERP_TABLE_ACTIONS_COL_GAP_COMPACT = 2
export const ERP_TABLE_ACTIONS_COL_GAP_DEFAULT = 4
/** 单元格左右 padding 余量（与 .cell 内边距对齐） */
/** 操作列单元格：左侧约 10px + 右侧最多 5px 的空间（合计默认 15）。 */
export const ERP_TABLE_ACTIONS_CELL_PAD_X = 15

/**
 * 操作列建议宽度（px）：按可见按钮数与 Grid 列数估宽，避免固定 400 右侧留白。
 * @param {number} buttonCount 当前视图下最多可见按钮数
 * @param {{ compact?: boolean, extraPx?: number, cellPadPx?: number }} [options]
 */
export function getErpTableActionsColMinWidth(buttonCount, options = {}) {
  const cols = getErpTableActionsColCount(buttonCount)
  const compact = options.compact === true
  const btnW = compact ? ERP_TABLE_ACTIONS_BTN_WIDTH_COMPACT : ERP_TABLE_ACTIONS_BTN_WIDTH_DEFAULT
  const colGap = compact ? ERP_TABLE_ACTIONS_COL_GAP_COMPACT : ERP_TABLE_ACTIONS_COL_GAP_DEFAULT
  const extra = Number(options.extraPx) || 0
  const cellPad = Number(options.cellPadPx ?? ERP_TABLE_ACTIONS_CELL_PAD_X)
  if (cols <= 0) return btnW + cellPad + extra
  return Math.ceil(cols * btnW + Math.max(0, cols - 1) * colGap + cellPad + extra)
}

/**
 * 按实际按钮文案估算操作列宽度。
 * 只依赖传入数据，不读取或监听 DOM，避免表格列宽与组件渲染互相触发更新。
 *
 * @param {Array<string | null | undefined | false>} actionLabels 当前会显示的按钮文案
 * @param {{ comfortable?: boolean, cellPadPx?: number, colGapPx?: number, extraPx?: number, singleRow?: boolean }} [options]
 *   singleRow=true 时按「全部按钮同一行」估宽（不按两行 Grid 折列），配合 CSS flex-nowrap 使用。
 */
export function getErpTableActionsColWidthByLabels(actionLabels, options = {}) {
  const labels = (Array.isArray(actionLabels) ? actionLabels : [])
    .filter((label) => label != null && label !== false && String(label).trim() !== '')
    .map((label) => String(label).trim())
  const comfortable = options.comfortable !== false
  const fontSize = comfortable ? 13 : 11
  const buttonPad = 18
  const minButtonWidth = comfortable ? 44 : 40
  // 与 .erp-col-actions .cell 的左右留白合计对齐；宽度只多留约 5px 量级，避免大片空白。
  const cellPad = Number(options.cellPadPx ?? ERP_TABLE_ACTIONS_CELL_PAD_X)
  const colGap = Number(options.colGapPx ?? 4)
  const extra = Number(options.extraPx) || 0
  const cols = options.singleRow === true
    ? Math.max(1, labels.length)
    : getErpTableActionsColCount(labels.length)
  const columnWidths = Array.from({ length: cols }, () => 0)

  labels.forEach((label, index) => {
    let textUnits = 0
    for (const char of Array.from(label)) textUnits += /[\u0000-\u00ff]/.test(char) ? 0.65 : 1
    const buttonWidth = Math.max(minButtonWidth, Math.ceil(textUnits * fontSize + buttonPad))
    columnWidths[index % cols] = Math.max(columnWidths[index % cols], buttonWidth)
  })

  return Math.ceil(
    columnWidths.reduce((total, width) => total + width, 0)
      + Math.max(0, cols - 1) * colGap
      + Math.max(0, cellPad)
      + extra,
  )
}

/**
 * 当前页操作列宽度：每行按实际可见按钮估宽，取最大组合。
 * 空列表仍保留一个「查看」按钮的最小宽度，避免列表加载瞬间列宽跳动。
 */
export function getErpTableActionsColWidthByRows(rows, getLabels, options = {}) {
  const list = Array.isArray(rows) ? rows : []
  const resolveLabels = typeof getLabels === 'function' ? getLabels : () => []
  const widths = list.map((row) => getErpTableActionsColWidthByLabels(resolveLabels(row), options))
  const fallbackLabels = options.fallbackLabels ?? ['查看']
  return Math.max(
    getErpTableActionsColWidthByLabels(fallbackLabels, options),
    ...widths,
  )
}
