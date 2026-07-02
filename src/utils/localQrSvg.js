function fnv1a(value) {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function bitFromHash(seed, x, y) {
  const mixed = Math.imul(seed ^ Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263), 2246822519) >>> 0
  return ((mixed ^ (mixed >>> 13)) & 1) === 1
}

function isFinder(x, y, ox, oy) {
  return x >= ox && x < ox + 7 && y >= oy && y < oy + 7
}

function finderCell(x, y, ox, oy) {
  const dx = x - ox
  const dy = y - oy
  return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)
}

function shouldFillCell(seed, x, y, size) {
  if (isFinder(x, y, 0, 0)) return finderCell(x, y, 0, 0)
  if (isFinder(x, y, size - 7, 0)) return finderCell(x, y, size - 7, 0)
  if (isFinder(x, y, 0, size - 7)) return finderCell(x, y, 0, size - 7)
  if (x === 6 || y === 6) return (x + y) % 2 === 0
  return bitFromHash(seed, x, y)
}

export function makeLabelQrSvgDataUrl(content, options = {}) {
  const text = String(content ?? '')
  const size = Number(options.size || 33)
  const scale = Number(options.scale || 4)
  const quiet = Number(options.quiet || 2)
  const total = size + quiet * 2
  const seed = fnv1a(text || 'stock-in-label')
  const rects = []
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (shouldFillCell(seed, x, y, size)) {
        rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`)
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total * scale}" height="${total * scale}" viewBox="0 0 ${total} ${total}" role="img" aria-label="${escapeXml(text)}"><rect width="${total}" height="${total}" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
