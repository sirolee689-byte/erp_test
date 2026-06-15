"""One-off: extract BOM routes/helpers from server/index.js into server/bom/registerBomRoutes.js"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "server" / "index.js"
OUT = ROOT / "server" / "bom" / "registerBomRoutes.js"

lines = INDEX.read_text(encoding="utf-8").splitlines(keepends=True)

# 0-based slices (end exclusive)
CHUNKS = [
    (3502, 3790),   # bomParts helpers
    (4139, 4140),   # INV_BOM_MASTER_COLSET_PROMISE
    (4262, 4331),   # getInvBomMaster/Parts/Del column set
    (7267, 10334),  # BOM list helpers + routes
]

body_parts = []
for start, end in CHUNKS:
    body_parts.append("".join(lines[start:end]))

header = '''/**
 * BOM 模块路由注册（从 server/index.js 机械抽出，零行为变更）
 */
import crypto from 'node:crypto'
import { getPool, sql } from '../db.js'
import { getActorAuditTripletFromReq } from '../businessAuditFields.js'
import { writeLog } from '../operationLogWriter.js'
import { mapSqlServerWriteError } from '../sqlServerWriteErrors.js'
import { getSysUsersColumnsMeta } from '../sysUsersDb.js'
import {
  BOM_CONSUMPTION_FROM,
  BOM_COST_FROM,
  BOM_COST_TABLE,
  BOM_PARTS_KCAA_SYNC_NAMES,
  INV_BOM_CODE_FROM,
  INV_BOM_CURRENCY_FROM,
  INV_BOM_MASTER_FROM,
  INV_BOM_MASTER_TABLE,
  INV_BOM_PARTS_FROM,
  INV_BOM_PARTS_TABLE,
} from '../bomTables.js'
import { buildBomCostInsertPayloadFromFlatUsage } from '../bomUsageYl.js'
import {
  applyBomCostPxForPqRows,
  applyBomCostAuditToRows,
  enrichBomCostInsertRowsFromBom000,
  fetchBomMaterialPxByCategoryCodes,
  fetchBom000ForBomCostEnrich,
  formatBomCostAuditTimestamp,
  insertBomCostBulkEnriched,
  isPqBomCostHead,
} from '../bomCostEnrichFromBom000.js'
import { buildBomPartsUsageTreeNodes } from '../bomUsageTreeBuild.js'
import { flattenBomPartsCostUsageFlat } from '../bomUsageFlatten.js'
import { handlePostBomMasterPropagate } from '../bomMasterPropagate.js'
import { markCurrentBomCostStale } from '../bomCostImpactScope.js'

const BOM_UNIT_CHANGE_FROM = 'dbo.[UB_ERP_Stocks_unit_change]'
const BOM_MATERIAL_FROM = 'dbo.[UB_ERP_Stocks_material]'
const BOM_STOCKS_WORKSHOP_FROM = 'dbo.[UB_ERP_Stocks_workshop]'
const SYS_SUPPLIER_FROM = 'dbo.[System_supplier]'

/**
 * @param {import('express').Express} app
 * @param {{
 *   getCurrentUserFromReq: (req: import('express').Request) => unknown,
 *   escapeSqlLikePattern: (s: string) => string,
 *   formatBomColorcodeTimestamp: (date?: Date) => string,
 * }} deps
 */
export function registerBomRoutes(app, deps) {
  const { getCurrentUserFromReq, escapeSqlLikePattern, formatBomColorcodeTimestamp } = deps

'''

footer = "\n}\n"

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(header + "".join(body_parts) + footer, encoding="utf-8")
print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")
