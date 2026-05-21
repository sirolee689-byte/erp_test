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
export const ERP_TABLE_ACTIONS_CELL_PAD_X = 20

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
