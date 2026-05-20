/**
 * 主列表表格约定（见 src/styles/README.md）：
 * - class="erp-list-table"
 * - 禁止 :max-height（避免表内纵滚与页面纵滚叠成双滚动条）
 * - 必须 ErpTableViewportHScroll 或 v-erp-list-h-scroll（视口底横条）
 */

/** @deprecated 勿再使用；主列表已改为页面纵滚 + 视口底横条 */
export const ERP_LIST_TABLE_MAX_HEIGHT = null

/** @deprecated 返回空对象；保留导入路径以免旧代码报错，新页勿引用 */
export function useErpListTable() {
  return {}
}
