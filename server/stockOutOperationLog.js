import { writeOperationLog } from './operationLogWriter.js'

export function buildStockOutLogInfo({ outboundNo, sourceOrderNo, actor } = {}) {
  const parts = [`出库单号：${outboundNo || ''}`]
  if (sourceOrderNo) parts.push(`关联单号：${sourceOrderNo}`)
  const name = actor?.utruename ?? actor?.auditTruename ?? actor?.truename ?? actor?.uname ?? actor?.userName
  if (name) parts.push(`操作人：${name}`)
  return parts.join('；')
}

export async function writeStockOutOperationLog(poolOrTx, { actName, info, actor, outboundNo, systemCode }) {
  return writeOperationLog(poolOrTx, {
    act_name: actName,
    act_info: info || buildStockOutLogInfo({ outboundNo, actor }),
    code: 'UB_ERP_Stocks_out',
    systemcode: systemCode || '',
    uname: actor?.uname ?? actor?.auditUserName ?? actor?.userName ?? '',
    utruename: actor?.utruename ?? actor?.auditTruename ?? actor?.truename ?? actor?.userName ?? '',
    ip: actor?.ip ?? '',
  })
}

