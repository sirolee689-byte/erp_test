/**
 * 纸格导入：主 BOM / CUT 编码（与 server/paperPatternImportParse.js 保持规则一致）
 */

function norm(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/：/g, ':')
    .trim()
}

/**
 * 编码用厂款号：去掉 *、空白、中划线
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
 * 主 BOM kcaa03 / kcaa09 款色路径用厂款号：去 *、去空白；保留横线（与 server/paperPatternImportCommitBom000.js 一致）
 * @param {string|number|null|undefined} s
 */
export function normalizeFactoryStyleForBomPathDisplay(s) {
  return String(s ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, '')
    .trim()
}

/**
 * bom_000.kcaa03 款色路径：规范化厂款号/颜色编码（颜色段不加 -OUT）
 * @param {string|number|null|undefined} factoryStyleNo
 * @param {string|number|null|undefined} colorNo
 */
export function buildFactoryStyleKcaa03Path(factoryStyleNo, colorNo) {
  const path = normalizeFactoryStyleForBomPathDisplay(factoryStyleNo)
  const col = String(colorNo ?? '').trim()
  if (!path || !col) return ''
  return `${path}/${col}`
}

/**
 * 是否清仓单（生成主/CUT 编号时在颜色段末尾固定追加 -OUT）
 * @param {unknown} clearanceOrder
 */
export function isPaperPatternClearanceOrder(clearanceOrder) {
  return clearanceOrder === true || clearanceOrder === 'true' || clearanceOrder === 1
}

/**
 * 生成编号用的颜色段（选 A：选清仓单则固定 `${颜色}-OUT`，不判断是否已有 -OUT 后缀）
 * @param {string} colorNo 用户填写的颜色编码
 * @param {unknown} [clearanceOrder]
 */
export function colorNoSegmentForBomEncoding(colorNo, clearanceOrder) {
  const col = norm(colorNo)
  if (!col) return ''
  return isPaperPatternClearanceOrder(clearanceOrder) ? `${col}-OUT` : col
}

/**
 * 主 BOM 编码：{导入类型}-{标准化厂款号}/{颜色段}
 * @param {{ importTypeFlag5: string, styleNo: string, colorNo: string, clearanceOrder?: unknown }} p styleNo 须为已标准化厂款号；colorNo 为颜色编码
 */
export function buildMainBomCode(p) {
  const prefix = norm(p.importTypeFlag5)
  const sn = norm(p.styleNo)
  const col = colorNoSegmentForBomEncoding(p.colorNo, p.clearanceOrder)
  if (!prefix || !sn || !col) return ''
  return `${prefix}-${sn}/${col}`
}

/**
 * CUT 编码：CUT-{导入类型}{标准化厂款号}/{颜色段}<序号>
 * @param {{ importTypeFlag5: string, styleNo: string, colorNo: string, cutSeq: string, clearanceOrder?: unknown }} p
 */
export function buildCutCode(p) {
  const prefix = norm(p.importTypeFlag5)
  const sn = norm(p.styleNo)
  const col = colorNoSegmentForBomEncoding(p.colorNo, p.clearanceOrder)
  const seq = norm(p.cutSeq)
  if (!prefix || !sn || !col || !seq) return ''
  return `CUT-${prefix}${sn}/${col}<${seq}>`
}
