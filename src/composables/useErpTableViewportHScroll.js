import { nextTick, onMounted, onUnmounted, unref, watch } from 'vue'
import {
  attachErpTableViewportHScroll,
  detachErpTableViewportHScroll,
  refreshErpTableViewportHScroll,
} from '@/utils/erpTableViewportHScroll'

/**
 * 解析 el-table 根 DOM（支持组件实例 ref、HTMLElement、包装组件 $el）
 * @param {*} refVal
 * @returns {HTMLElement|null}
 */
export function resolveErpTableElement(refVal) {
  const raw = unref(refVal)
  if (!raw) return null
  if (raw instanceof HTMLElement) {
    return raw.classList.contains('el-table') ? raw : raw.querySelector('.el-table')
  }
  const el = raw.$el ?? raw
  if (el instanceof HTMLElement) {
    return el.classList.contains('el-table') ? el : el.querySelector('.el-table')
  }
  return null
}

/**
 * 视口底部固定横向滚动条（与 Element Plus el-table 表体联动）
 *
 * @param {import('vue').Ref} tableRef - el-table 的 ref 或根 HTMLElement
 * @param {import('vue').Ref|(() => object)} [options] - { bottomOffset?: number }
 */
export function useErpTableViewportHScroll(tableRef, options = {}) {
  let detach = null

  const getOptions = () => {
    const o = typeof options === 'function' ? options() : unref(options)
    return o && typeof o === 'object' ? o : {}
  }

  const connect = async () => {
    await nextTick()
    const el = resolveErpTableElement(tableRef)
    detach?.()
    detach = null
    if (!el) return
    detach = attachErpTableViewportHScroll(el, getOptions())
  }

  const refresh = () => {
    const el = resolveErpTableElement(tableRef)
    if (el) refreshErpTableViewportHScroll(el)
    else connect()
  }

  onMounted(connect)
  watch(tableRef, connect, { flush: 'post' })
  onUnmounted(() => {
    const el = resolveErpTableElement(tableRef)
    if (el) detachErpTableViewportHScroll(el)
    detach = null
  })

  return { refresh, reconnect: connect }
}
