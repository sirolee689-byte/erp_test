/**
 * 外协报价：UB_ERP_assist_offer + UB_ERP_assist_offer_list
 * 实现见 createQuotationHandlers.js（与采购报价共用工厂）
 */
import { createQuotationHandlers } from './createQuotationHandlers.js'

const handlers = createQuotationHandlers({
  label: '外协报价',
  headerTable: 'UB_ERP_assist_offer',
  lineTable: 'UB_ERP_assist_offer_list',
  docNoCol: 'wxaa01',
  quoteDateCol: 'wxaa02',
  expiryDateCol: 'wxaa07',
  supplierCol: 'wxaa04',
  lineDocNoCol: 'wxab01',
  lineExclTaxCol: 'wxab04',
  lineInclTaxCol: 'wxab05',
  lineFkCandidates: [
    'wxab01',
    'pid',
    'UB_ERP_assist_offer_id',
    'outsourcing_quotation_id',
    'quotation_id',
    'sid',
    'master_id',
    'parent_id',
  ],
  apiBase: '/api/supply-chain/outsourcing-quotations',
  checkDocNoQueryParam: 'wxaa01',
})

export const ensureOutsourcingQuotationMeta = handlers.ensureMeta
export const invalidateOutsourcingQuotationMetaCache = handlers.invalidateMetaCache
export const getOutsourcingQuotationDisplayLabel = handlers.getDisplayLabel
export const fetchOutsourcingQuotationSnapshotForAudit = handlers.fetchSnapshotForAudit
export const buildOutsourcingQuotationPutDiffChinese = handlers.buildPutDiffChinese
export const fetchOutsourcingQuotationHeaderFullForAudit = handlers.fetchHeaderFullForAudit
export const registerOutsourcingQuotationRoutes = handlers.registerRoutes
