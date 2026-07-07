/** 全站分页 pageSize 上限（与前端 ERP_PAGE_SIZE_OPTIONS 最大项一致） */
export const ERP_MAX_PAGE_SIZE = 1000

/**
 * 将请求中的 pageSize 约束在 [1, ERP_MAX_PAGE_SIZE]。
 * @param {unknown} raw 查询参数 pageSize
 * @param {number} defaultSize 缺省或非法时的默认值（各接口自定，不在此统一）
 */
export function clampErpPageSize(raw, defaultSize = 20) {
  const n = Number(raw ?? defaultSize)
  if (!Number.isFinite(n) || n <= 0) return defaultSize
  return Math.min(ERP_MAX_PAGE_SIZE, Math.max(1, Math.floor(n)))
}
