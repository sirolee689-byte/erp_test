/**
 * 采购报价：UB_ERP_Buy_offer + UB_ERP_Buy_offer_list
 * 实现见 createQuotationHandlers.js（与外协报价共用工厂）
 */
import { createQuotationHandlers } from './createQuotationHandlers.js'

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
})

export const ensurePurchaseQuotationMeta = handlers.ensureMeta
export const invalidatePurchaseQuotationMetaCache = handlers.invalidateMetaCache
export const getPurchaseQuotationDisplayLabel = handlers.getDisplayLabel
export const fetchPurchaseQuotationSnapshotForAudit = handlers.fetchSnapshotForAudit
export const buildPurchaseQuotationPutDiffChinese = handlers.buildPutDiffChinese
export const fetchPurchaseQuotationHeaderFullForAudit = handlers.fetchHeaderFullForAudit
export const registerPurchaseQuotationRoutes = handlers.registerRoutes
