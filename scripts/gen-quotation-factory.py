"""One-shot: generate createQuotationHandlers.js from purchaseQuotationHandlers.js"""
import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
src = (ROOT / "server/purchaseQuotationHandlers.js").read_text(encoding="utf-8")

header = """/**
 * 报价 handler 工厂：采购/外协共用实现，由 createQuotationHandlers(config) 参数化差异列与路由。
 * 零行为变更：逻辑与原先 purchaseQuotationHandlers.js 一致，仅抽取重复。
 */
import { sql } from './db.js'
import { applySupplierCodeColumnFromKehu } from './supplierSCodeLookup.js'
import { invBomMasterFrom } from './bomTables.js'

/**
 * @typedef {{
 *   label: string,
 *   headerTable: string,
 *   lineTable: string,
 *   docNoCol: string,
 *   quoteDateCol: string,
 *   expiryDateCol: string,
 *   supplierCol: string,
 *   lineDocNoCol: string,
 *   lineExclTaxCol: string,
 *   lineInclTaxCol: string,
 *   lineFkCandidates: string[],
 *   apiBase: string,
 *   checkDocNoQueryParam: string,
 * }} QuotationHandlerConfig
 */

/**
 * @param {QuotationHandlerConfig} config
 */
export function createQuotationHandlers(config) {
  const {
    label,
    headerTable: HEADER_TABLE,
    lineTable: LINE_TABLE,
    docNoCol,
    quoteDateCol,
    expiryDateCol,
    supplierCol,
    lineDocNoCol,
    lineExclTaxCol,
    lineInclTaxCol,
    lineFkCandidates,
    apiBase,
    checkDocNoQueryParam,
  } = config

  const HEADER_FROM = `dbo.[${HEADER_TABLE}]`
  const LINE_FROM = `dbo.[${LINE_TABLE}]`
  const SYS_SUPPLIER_FROM = 'dbo.[System_supplier]'

"""

body = src
body = re.sub(r"^/\*\*[\s\S]*?\*/\n", "", body, count=1)
body = re.sub(r"import \{ sql \} from '\./db\.js'\n", "", body)
body = re.sub(
    r"import \{ applySupplierCodeColumnFromKehu \} from '\./supplierSCodeLookup\.js'\n\n",
    "",
    body,
)
body = re.sub(
    r"const HEADER_TABLE = 'UB_ERP_Buy_offer'\n"
    r"const LINE_TABLE = 'UB_ERP_Buy_offer_list'\n"
    r"const HEADER_FROM = `dbo\.\[\$\{HEADER_TABLE\}\]`\n"
    r"const LINE_FROM = `dbo\.\[\$\{LINE_TABLE\}\]`\n"
    r"const SYS_SUPPLIER_FROM = 'dbo\.\[System_supplier\]'\n\n",
    "",
    body,
)

replacements = [
    ("normalizePurchaseQuotationHeaderBody", "normalizeQuotationHeaderBody"),
    ("appendPurchaseQuotationLineAuditTriplet", "appendQuotationLineAuditTriplet"),
    ("PurchaseQuotationMeta", "QuotationMeta"),
    ("loadPurchaseQuotationMeta", "loadQuotationMeta"),
    ("ensurePurchaseQuotationMeta", "ensureQuotationMeta"),
    ("invalidatePurchaseQuotationMetaCache", "invalidateQuotationMetaCache"),
    ("getPurchaseQuotationDisplayLabel", "getQuotationDisplayLabel"),
    ("fetchPurchaseQuotationSnapshotForAudit", "fetchQuotationSnapshotForAudit"),
    ("buildPurchaseQuotationPutDiffChinese", "buildQuotationPutDiffChinese"),
    ("fetchPurchaseQuotationHeaderFullForAudit", "fetchQuotationHeaderFullForAudit"),
    ("hasUbErpPurchaseListAgg", "hasUbErpQuotationListAgg"),
    ("ubPurchaseListAggSelectFragments", "ubQuotationListAggSelectFragments"),
    ("registerPurchaseQuotationRoutes", "registerQuotationRoutes"),
    ("'cgaa01'", "docNoCol"),
    ("'cgaa02'", "quoteDateCol"),
    ("'cgaa07'", "expiryDateCol"),
    ("'cgaa04'", "supplierCol"),
    ("'cgab01'", "lineDocNoCol"),
    ("'cgab04'", "lineExclTaxCol"),
    ("'cgab05'", "lineInclTaxCol"),
    ("[采购报价]", "`[${label}]`"),
    ("采购报价", "${label}"),
    ("/api/supply-chain/purchase-quotations", "${apiBase}"),
    ("?cgaa01=", "?${checkDocNoQueryParam}="),
    ("参数错误：cgaa01", "参数错误：${checkDocNoQueryParam}"),
    ("主表缺少单号列（cgaa01 等）", "主表缺少单号列（${docNoCol} 等）"),
    ("请填写采购报价单号（cgaa01）", "请填写${label}单号（${docNoCol}）"),
    ("主表缺少 cgaa01/单号列", "主表缺少 ${docNoCol}/单号列"),
]

for old, new in replacements:
    body = body.replace(old, new)

body = body.replace(
    """  const quoteDateCol = pickBodyField(h, quoteDateCol)
  if (
    meta.headerColNames.has(quoteDateCol) &&
    (quoteDateCol === undefined || quoteDateCol === null || cellStr(quoteDateCol) === '') &&
    addStr
  ) {
    h.quoteDateCol = addStr""",
    """  const quoteDateVal = pickBodyField(h, quoteDateCol)
  if (
    meta.headerColNames.has(quoteDateCol) &&
    (quoteDateVal === undefined || quoteDateVal === null || cellStr(quoteDateVal) === '') &&
    addStr
  ) {
    h[quoteDateCol] = addStr""",
)

body = re.sub(
    r"/\*\* BOM 主档表[\s\S]*?function invBomMasterFrom\(\) \{[\s\S]*?\}\n\n",
    "",
    body,
)

body = re.sub(
    r"    const candidates = \[\n"
    r"      lineDocNoCol,\n"
    r"      'pid',\n"
    r"      'purchase_quotation_id',\n"
    r"      'quotation_id',\n"
    r"      'sid',\n"
    r"      'master_id',\n"
    r"      'parent_id',\n"
    r"      'UB_ERP_Buy_offer_id',\n"
    r"    \]",
    "    const candidates = lineFkCandidates",
    body,
)

body = body.replace("let META_PROMISE = null", "let metaPromise = null")
body = body.replace(
    "if (!META_PROMISE) META_PROMISE = loadQuotationMeta(pool)",
    "if (!metaPromise) metaPromise = loadQuotationMeta(pool)",
)
body = body.replace("return await META_PROMISE", "return await metaPromise")
body = body.replace("META_PROMISE = null", "metaPromise = null")

for fn in [
    "ensureQuotationMeta",
    "invalidateQuotationMetaCache",
    "getQuotationDisplayLabel",
    "fetchQuotationSnapshotForAudit",
    "buildQuotationPutDiffChinese",
    "fetchQuotationHeaderFullForAudit",
    "registerQuotationRoutes",
]:
    body = body.replace(f"export async function {fn}", f"async function {fn}")
    body = body.replace(f"export function {fn}", f"function {fn}")

footer = """
  return {
    ensureMeta: ensureQuotationMeta,
    invalidateMetaCache: invalidateQuotationMetaCache,
    getDisplayLabel: getQuotationDisplayLabel,
    fetchSnapshotForAudit: fetchQuotationSnapshotForAudit,
    buildPutDiffChinese: buildQuotationPutDiffChinese,
    fetchHeaderFullForAudit: fetchQuotationHeaderFullForAudit,
    registerRoutes: registerQuotationRoutes,
  }
}
"""

out_path = ROOT / "server/createQuotationHandlers.js"
out_path.write_text(header + body + footer, encoding="utf-8")
print(f"written {out_path} ({len(header + body + footer)} chars)")
