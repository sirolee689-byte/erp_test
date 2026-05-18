/**
 * 纸格 CUT 表：按 Excel 绝对列号（1=A）读取裁片尺寸/用量等（与模板第 4、5 行表头对齐）
 * 长/宽/单位用量在解析阶段规范为 4 位小数（真实 cell 值四舍五入，非 Excel 显示文本）
 */
import { normalizePaperPatternCutMetric4Digits } from './paperPatternCutMetricNormalize.js'

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
 * @param {{ cells: Array<{ colIndex: number, value: string }> }} row
 * @param {number} colIndex1Based Excel 列号（1=A）
 */
export function readExcelColNorm(row, colIndex1Based) {
  const c = row.cells.find((x) => x.colIndex === colIndex1Based)
  return c ? norm(c.value) : ''
}

/**
 * CUT 数据行：第 3～13 列映射（长、宽、数量…）
 * @param {{ cells: Array<{ colIndex: number, value: string }> }} row
 * @returns {{
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
 * }}
 */
export function readCutMetricColumnsByExcelCol(row) {
  return {
    length: normalizePaperPatternCutMetric4Digits(readExcelColNorm(row, 3)),
    width: normalizePaperPatternCutMetric4Digits(readExcelColNorm(row, 4)),
    quantity: readExcelColNorm(row, 5),
    fabricWidth: readExcelColNorm(row, 6),
    unitConsumption: normalizePaperPatternCutMetric4Digits(readExcelColNorm(row, 7)),
    wastage: readExcelColNorm(row, 8),
    actualConsumption: readExcelColNorm(row, 9),
    unitPrice: readExcelColNorm(row, 10),
    totalAmount: readExcelColNorm(row, 11),
    matching: readExcelColNorm(row, 12),
    unit: readExcelColNorm(row, 13),
  }
}
