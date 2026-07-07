/** 全站分页「每页条数」下拉（单源）；各页默认 pageSize 仍由各自 ref 初始化 */
export const ERP_PAGE_SIZE_OPTIONS = Object.freeze([5, 10, 20, 50, 100, 200, 500, 1000])

/** 与后端 server/erpPagination.js 上限一致 */
export const ERP_MAX_PAGE_SIZE = 1000
