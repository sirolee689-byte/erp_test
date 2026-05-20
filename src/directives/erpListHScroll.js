import {
  attachErpTableViewportHScroll,
  detachErpTableViewportHScroll,
  refreshErpTableViewportHScroll,
} from '@/utils/erpTableViewportHScroll'

/** 主列表 el-table：视口底部固定横向滚动条（v-erp-list-h-scroll，与 ErpTableViewportHScroll 共用逻辑） */
export const erpListHScrollDirective = {
  mounted(el) {
    attachErpTableViewportHScroll(el)
  },
  updated(el) {
    requestAnimationFrame(() => refreshErpTableViewportHScroll(el))
  },
  unmounted(el) {
    detachErpTableViewportHScroll(el)
  },
}
