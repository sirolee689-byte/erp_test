import { writeOperationLog } from './operationLogWriter.js'

export function buildStockInLogInfo({ receiptNo, sourceOrderNo, actor }) {
  const who = actor?.utruename || actor?.auditTruename || actor?.truename || actor?.uname || actor?.userName || '未知用户'
  const parts = [`入库单号：${receiptNo || ''}`]
  if (sourceOrderNo) parts.push(`关联单号：${sourceOrderNo}`)
  parts.push(`操作者：${who}`)
  return parts.join('，')
}

export async function writeStockInOperationLog(poolOrTx, { actName, info, actor, receiptNo, systemCode }) {
  return writeOperationLog(poolOrTx, {
    actName,
    actInfo: info,
    code: 'UB_ERP_Stocks_Storage',
    systemcode: systemCode || receiptNo || '',
    uname: actor?.uname || actor?.auditUserName || actor?.userName || '',
    utruename: actor?.utruename || actor?.auditTruename || actor?.truename || actor?.userName || '',
    uid: actor?.uid ?? actor?.uidInt ?? actor?.userId ?? actor?.UserID ?? '',
    ip: actor?.ip || '',
  })
}
