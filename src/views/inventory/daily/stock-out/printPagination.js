export function normalizePrintRowsPerPage(value) {
  const n = Number(value)
  if (!Number.isInteger(n)) return 0
  if (n < 2 || n > 10) return 0
  return n
}

function docKey(doc, index) {
  return String(doc?.header?.systemcode || doc?.header?.kcap01 || index)
}

export function buildStockOutPrintBlocks(docs, rowsPerPageValue) {
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
      // 自然分页受浏览器纸张和边距影响，打印前无法得出可靠物理页数。
      pageLabel: '',
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
        // 每张出库单独立计页，下一张单据从 1/X 页重新开始。
        pageLabel: `${pageNo}/${chunks.length}页`,
      }
    })
  })
}
