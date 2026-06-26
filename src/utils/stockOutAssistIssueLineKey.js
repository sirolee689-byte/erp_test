/**
 * 外协领料批量添加去重键：与 server/stockOutAssistIssueBomExpand.buildAssistIssueLineKey 口径一致。
 */

function text(v) {
  return String(v ?? '').trim()
}

/** 外协明细 wxak02 + 子料 kcaa01 */
export function buildAssistIssueLineKey(wxak02, childKcaa01) {
  const src = text(wxak02).toLowerCase()
  const child = text(childKcaa01).toLowerCase()
  if (!src || !child) return ''
  return `${src}|${child}`
}

/** 从父页/库表明细行解析批量去重键 */
export function resolveAssistIssueBatchLineKey(line) {
  const fromRow = text(line?.lineKey).toLowerCase()
  if (fromRow) return fromRow
  const src = text(line?.sourceLineCode ?? line?.kcaq02 ?? line?.wxak02).toLowerCase()
  const mat = text(line?.kcaa01 ?? line?.materialCode).toLowerCase()
  return buildAssistIssueLineKey(src, mat) || src
}

/** 编辑态：本单已存子料编码去重键（与 server/stockOutAssistIssueBatchAdd.buildAssistIssueMaterialDedupKey 一致） */
export function buildAssistIssueMaterialDedupKey(materialCode) {
  const mat = text(materialCode).toLowerCase()
  return mat ? `*|${mat}` : ''
}
