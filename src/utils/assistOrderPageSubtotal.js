function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * 管理列表页底「小计」：汇总当前页各单的明细 + 额外费用（与展开区费用行口径一致）。
 * - 数量：明细 SUM(wxak03)
 * - 金额：明细 SUM(wxak05)；费用行在展开区不含税金额为空，不计入
 * - 金额（含税）：明细 SUM(wxak051) + 费用 SUM(money)
 * - 单价 / 单价（含税）：金额 ÷ 数量（数量>0 时）
 */
function buildSubtotalResult(quantity, amountEx, amountInc) {
  return {
    quantity,
    amountEx,
    amountInc,
    unitPriceEx: quantity > 0 ? amountEx / quantity : null,
    unitPriceInc: quantity > 0 ? amountInc / quantity : null,
  }
}

/** 展开子表行小计：明细行 + 接在后面的费用行 */
export function calcAssistOrderExpandSubtotal(expandedLines) {
  let quantity = 0
  let amountEx = 0
  let amountInc = 0

  for (const line of expandedLines || []) {
    if (line?._rowType === 'fee') {
      amountInc += toNumber(line?.wxak051)
      continue
    }
    quantity += toNumber(line?.wxak03)
    amountEx += toNumber(line?.wxak05)
    amountInc += toNumber(line?.wxak051)
  }

  return buildSubtotalResult(quantity, amountEx, amountInc)
}

export function calcAssistOrderPageSubtotal(rows) {
  let quantity = 0
  let amountEx = 0
  let amountInc = 0

  for (const row of rows || []) {
    quantity += toNumber(row?.totalQty)
    amountEx += toNumber(row?.taxExcludedTotal)
    amountInc += toNumber(row?.taxIncludedTotal) + toNumber(row?.extraFeeTotal)
  }

  return buildSubtotalResult(quantity, amountEx, amountInc)
}
