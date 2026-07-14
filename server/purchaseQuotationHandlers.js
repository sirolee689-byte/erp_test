/**
 * 采购报价：UB_ERP_Buy_offer + UB_ERP_Buy_offer_list
 * 实现见 createQuotationHandlers.js（与外协报价共用工厂）
 */
import { createQuotationHandlers } from './createQuotationHandlers.js'
import { registerPurchaseQuotationSaveRoutes } from './purchaseQuotationSave.js'
import { registerPurchaseQuotationExcelImportRoutes } from './purchaseQuotationExcelImport.js'

const handlers = createQuotationHandlers({
  label: '采购报价',
  headerTable: 'UB_ERP_Buy_offer',
  lineTable: 'UB_ERP_Buy_offer_list',
  docNoCol: 'cgaa01',
  quoteDateCol: 'cgaa02',
  expiryDateCol: 'cgaa07',
  supplierCol: 'cgaa04',
  lineDocNoCol: 'cgab01',
  lineExclTaxCol: 'cgab04',
  lineInclTaxCol: 'cgab05',
  lineFkCandidates: [
    'cgab01',
    'pid',
    'purchase_quotation_id',
    'quotation_id',
    'sid',
    'master_id',
    'parent_id',
    'UB_ERP_Buy_offer_id',
  ],
  apiBase: '/api/supply-chain/purchase-quotations',
  checkDocNoQueryParam: 'cgaa01',
  // “转向物料查询”仅采购报价启用；按报价明细逐条只读展示。
  materialQuery: true,
  // 列表展开预取只需主键和报价单号，避免读取采购报价主表全部字段。
  compactBatchHeader: true,
  // 采购报价生命周期操作需要写入官方操作日志；外协报价未配置，保持原行为。
  operationLog: {
    code: 'UB_ERP_Buy_offer',
    documentName: '采购报价单',
    systemcodeCol: 'systemcode',
  },
})

export const ensurePurchaseQuotationMeta = handlers.ensureMeta
export const invalidatePurchaseQuotationMetaCache = handlers.invalidateMetaCache
export const getPurchaseQuotationDisplayLabel = handlers.getDisplayLabel
export const fetchPurchaseQuotationSnapshotForAudit = handlers.fetchSnapshotForAudit
export const buildPurchaseQuotationPutDiffChinese = handlers.buildPutDiffChinese
export const fetchPurchaseQuotationHeaderFullForAudit = handlers.fetchHeaderFullForAudit
export function registerPurchaseQuotationRoutes(app, deps) {
  // 专用保存路由先注册，读取、审核、回收站仍复用通用报价处理器。
  registerPurchaseQuotationSaveRoutes(app, deps)
  registerPurchaseQuotationExcelImportRoutes(app, deps)
  handlers.registerRoutes(app, deps)
}
