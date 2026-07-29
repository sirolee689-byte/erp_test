export function normalizePrintRowsPerPage(value) {
  const n = Number(value)
  if (!Number.isInteger(n)) return 0
  if (n < 2 || n > 10) return 0
  return n
}

function docIndexText(doc, index) {
  const value = Number(doc?.pageIndex)
  return Number.isFinite(value) && value > 0 ? String(value) : String(index + 1)
}

function docTotalText(doc, total) {
  const value = Number(doc?.pageTotal)
  return Number.isFinite(value) && value > 0 ? String(value) : String(total)
}

function docKey(doc, index) {
  return String(doc?.header?.kcan01 || doc?.header?.systemcode || index)
}

export function buildStockInPrintBlocks(docs, rowsPerPageValue) {
  const list = Array.isArray(docs) ? docs : []
  const rowsPerPage = normalizePrintRowsPerPage(rowsPerPageValue)
  if (!rowsPerPage) {
    return list.map((doc, index) => ({
      ...doc,
      blockKey: `${docKey(doc, index)}-natural`,
      chunkIndex: 1,
      chunkTotal: 1,
      showTotal: true,
      manualPageBreak: false,
      // 自然分页受浏览器纸张和边距影响，打印前无法得出可靠物理页数；
      // 入库打印这里沿用单据维度页码，与出库单保持同口径展示。
      pageLabel: `${docIndexText(doc, index)}/${docTotalText(doc, list.length)}页`,
    }))
  }

  return list.flatMap((doc, index) => {
    const lines = Array.isArray(doc?.lines) ? doc.lines : []
    const chunks = []
    for (let start = 0; start < lines.length; start += rowsPerPage) {
      chunks.push(lines.slice(start, start + rowsPerPage))
    }
    if (!chunks.length) chunks.push([])

    return chunks.map((chunkLines, chunkIndex) => {
      const pageNo = chunkIndex + 1
      return {
        ...doc,
        lines: chunkLines,
        blockKey: `${docKey(doc, index)}-manual-${pageNo}`,
        chunkIndex: pageNo,
        chunkTotal: chunks.length,
        showTotal: pageNo === chunks.length,
        manualPageBreak: true,
        pageLabel: `${pageNo}/${chunks.length}页`,
      }
    })
  })
}
