/**
 * 销售订单明细 / PI BOM 头：从 UB_ERP_Bom_000 抄扩展快照字段（散件单/整款单统一规则）
 */
import { bomCostParseDecimal6OrNull } from './bomCostEnrichFromBom000.js'

/** 保存时 UB_ERP_Sales_order_list 必须从 UB_ERP_Bom_000 抄写的扩展列 */
export const SALES_ORDER_LINE_BOM000_EXTENDED_COLUMNS = [
  'kcaa02_en',
  'kcaa32',
  'kcaa33',
  'kcaa34',
  'kcaa35',
  'sale_price',
  'cost_price',
]

/** 保存 PI BOM 头时从 UB_ERP_Bom_000 抄写的扩展列（与订单明细一致） */
export const PI_BOM_HEAD_BOM000_EXTENDED_COLUMNS = SALES_ORDER_LINE_BOM000_EXTENDED_COLUMNS

/** PI BOM 头 INSERT 额外需要的 UB_ERP_Bom_000 快照列（含 kcaa12） */
export const PI_BOM_HEAD_BOM000_SNAPSHOT_COLUMNS = ['kcaa12', ...PI_BOM_HEAD_BOM000_EXTENDED_COLUMNS]

/** UB_ERP_Bom_000 侧需存在的扩展列（用于保存前 schema 校验） */
export const BOM000_EXTENDED_SNAPSHOT_COLUMNS = [
  'kcaa02_en',
  'kcaa32',
  'kcaa33',
  'kcaa34',
  'kcaa35',
  'sale_price',
  'cost_price',
]

/** @param {unknown} raw */
export function resolveSalesOrderLineTypeFromBom000(raw) {
  if (raw === null || raw === undefined) return 1
  const s = String(raw).trim()
  if (s === '') return 1
  const n = Number(s)
  if (!Number.isFinite(n)) return 1
  return Math.trunc(n)
}

/** @param {unknown} raw */
function parseSnapshotNvarchar(raw, maxLen) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  return maxLen ? s.slice(0, maxLen) : s
}

/** @param {unknown} raw */
export function parseSnapshotIntOrNull(raw) {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (s === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

/**
 * UB_ERP_Bom_000 行 → 订单明细 / PI BOM 头共用扩展快照
 * @param {Record<string, unknown> | null | undefined} row
 */
export function mapBom000ExtendedSnapshotRow(row) {
  return {
    kcaa02_en: parseSnapshotNvarchar(row?.kcaa02_en, 500),
    kcaa12: parseSnapshotIntOrNull(row?.kcaa12),
    kcaa32: bomCostParseDecimal6OrNull(row?.kcaa32),
    kcaa33: bomCostParseDecimal6OrNull(row?.kcaa33),
    kcaa34: parseSnapshotNvarchar(row?.kcaa34, 80),
    kcaa35: parseSnapshotNvarchar(row?.kcaa35, 80),
    sale_price: bomCostParseDecimal6OrNull(row?.sale_price),
    cost_price: bomCostParseDecimal6OrNull(row?.cost_price),
    type: resolveSalesOrderLineTypeFromBom000(row?.type),
  }
}

/** @param {Record<string, unknown> | null | undefined} row */
export function mapSalesOrderLineExtendedFromBom000Row(row) {
  return mapBom000ExtendedSnapshotRow(row)
}
