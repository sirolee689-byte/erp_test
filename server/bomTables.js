/**
 * BOM 物理表名单源（env 可覆盖；表名仅允许字母数字下划线，防 SQL 拼接注入）
 */

function resolveSafeTableName(envKey, defaultName) {
  const raw = String(process.env[envKey] ?? defaultName).trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : defaultName
}

function tableFrom(tableName) {
  return `dbo.[${tableName}]`
}

export const INV_BOM_MASTER_TABLE = resolveSafeTableName('INV_BOM_MASTER_TABLE', 'bom_000')
export const INV_BOM_MASTER_FROM = tableFrom(INV_BOM_MASTER_TABLE)

export const INV_BOM_PARTS_TABLE = resolveSafeTableName('INV_BOM_PARTS_TABLE', 'Bom_parts')
export const INV_BOM_PARTS_FROM = tableFrom(INV_BOM_PARTS_TABLE)

export const BOM_COST_TABLE = resolveSafeTableName('BOM_COST_TABLE', 'bom_cost')
export const BOM_COST_FROM = tableFrom(BOM_COST_TABLE)

export const BOM_CONSUMPTION_TABLE = resolveSafeTableName('BOM_CONSUMPTION_TABLE', 'Bom_consumption')
export const BOM_CONSUMPTION_FROM = tableFrom(BOM_CONSUMPTION_TABLE)

export const INV_BOM_CURRENCY_TABLE = resolveSafeTableName('INV_BOM_CURRENCY_TABLE', 'bom_currency')
export const INV_BOM_CURRENCY_FROM = tableFrom(INV_BOM_CURRENCY_TABLE)

export const INV_BOM_CODE_TABLE = resolveSafeTableName('INV_BOM_CODE_TABLE', 'Bom_code')
export const INV_BOM_CODE_FROM = tableFrom(INV_BOM_CODE_TABLE)

export const BOM_MATERIAL_TABLE = resolveSafeTableName('BOM_MATERIAL_TABLE', 'UB_ERP_Stocks_material')
export const BOM_MATERIAL_FROM = tableFrom(BOM_MATERIAL_TABLE)

/** 与 index.js / bomPartsLinePersist / bomMasterPropagate 一致 */
export const BOM_PARTS_KCAA_SYNC_NAMES = Array.from({ length: 35 }, (_, i) =>
  `kcaa${String(i + 1).padStart(2, '0')}`,
)

/** 报价 handler 等：每次调用重读 env（与原 invBomMasterFrom 行为一致） */
export function invBomMasterFrom() {
  const raw = String(process.env.INV_BOM_MASTER_TABLE ?? 'bom_000').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? `dbo.[${raw}]` : 'dbo.[bom_000]'
}
