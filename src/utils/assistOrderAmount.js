function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function clampDecimals(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(6, Math.max(0, Math.trunc(n)))
}

function roundTo(value, decimals) {
  const d = clampDecimals(decimals, 2)
  const factor = 10 ** d
  return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor
}

function normalizeOptions(options = {}) {
  return {
    priceDecimals: clampDecimals(options.priceDecimals, 4),
  }
}

export function recalcAssistOrderLineFromTaxExcluded(line, options = {}) {
  const opts = normalizeOptions(options)
  const qty = roundTo(toNumber(line?.wxak03), 2)
  const tax = toNumber(line?.tax)
  const taxExcludedPrice = roundTo(toNumber(line?.wxak04), opts.priceDecimals)
  const taxIncludedPrice = roundTo(taxExcludedPrice * (1 + tax), opts.priceDecimals)

  return {
    ...line,
    wxak03: qty,
    wxak04: taxExcludedPrice,
    tax,
    wxak041: taxIncludedPrice,
    wxak05: roundTo(qty * taxExcludedPrice, 2),
    wxak051: roundTo(qty * taxIncludedPrice, 2),
  }
}

export function recalcAssistOrderLineFromTaxIncluded(line, options = {}) {
  const opts = normalizeOptions(options)
  const qty = roundTo(toNumber(line?.wxak03), 2)
  const tax = toNumber(line?.tax)
  const taxIncludedPrice = roundTo(toNumber(line?.wxak041), opts.priceDecimals)
  const taxExcludedPrice = roundTo(taxIncludedPrice / (1 + tax || 1), opts.priceDecimals)

  return {
    ...line,
    wxak03: qty,
    wxak04: taxExcludedPrice,
    tax,
    wxak041: taxIncludedPrice,
    wxak05: roundTo(qty * taxExcludedPrice, 2),
    wxak051: roundTo(qty * taxIncludedPrice, 2),
  }
}

export function recalcAssistOrderLineFromQuotedPrices(line, options = {}) {
  const opts = normalizeOptions(options)
  const qty = roundTo(toNumber(line?.wxak03), 2)
  const tax = toNumber(line?.tax)
  const taxExcludedPrice = roundTo(toNumber(line?.wxak04), opts.priceDecimals)
  const taxIncludedPrice = roundTo(toNumber(line?.wxak041), opts.priceDecimals)

  return {
    ...line,
    wxak03: qty,
    wxak04: taxExcludedPrice,
    tax,
    wxak041: taxIncludedPrice,
    wxak05: roundTo(qty * taxExcludedPrice, 2),
    wxak051: roundTo(qty * taxIncludedPrice, 2),
  }
}
