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
 * 主 BOM 编码：{导入类型}-{标准化厂款号}/{颜色编码}
 * @param {{ importTypeFlag5: string, styleNo: string, colorNo: string }} p styleNo 须为已标准化厂款号；colorNo 为颜色编码
 */
export function buildMainBomCode(p) {
  const prefix = norm(p.importTypeFlag5)
  const sn = norm(p.styleNo)
  const col = norm(p.colorNo)
  if (!prefix || !sn || !col) return ''
  return `${prefix}-${sn}/${col}`
}

/**
 * CUT 编码：CUT-{导入类型}{标准化厂款号}/{颜色编码}<序号>
 * @param {{ importTypeFlag5: string, styleNo: string, colorNo: string, cutSeq: string }} p
 */
export function buildCutCode(p) {
  const prefix = norm(p.importTypeFlag5)
  const sn = norm(p.styleNo)
  const col = norm(p.colorNo)
  const seq = norm(p.cutSeq)
  if (!prefix || !sn || !col || !seq) return ''
  return `CUT-${prefix}${sn}/${col}<${seq}>`
}
