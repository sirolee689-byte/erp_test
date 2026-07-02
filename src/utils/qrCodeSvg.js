import QRCode from 'qrcode'

function toPositiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function renderSvg(qr, options = {}) {
  const quiet = toPositiveNumber(options.quiet, 4)
  const scale = toPositiveNumber(options.scale, 4)
  const moduleSize = qr.modules.size
  const totalSize = moduleSize + quiet * 2
  const rects = []

  for (let y = 0; y < moduleSize; y += 1) {
    for (let x = 0; x < moduleSize; x += 1) {
      if (qr.modules.get(x, y)) {
        rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`)
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalSize * scale}" height="${totalSize * scale}" viewBox="0 0 ${totalSize} ${totalSize}" role="img">`,
    `<rect width="${totalSize}" height="${totalSize}" fill="#fff"/>`,
    `<g fill="#000">${rects.join('')}</g>`,
    `</svg>`,
  ].join('')
}

export function makeQrSvgDataUrl(content, options = {}) {
  const text = String(content ?? '').trim()
  if (!text) throw new Error('二维码内容不能为空')

  const qr = QRCode.create(text, {
    errorCorrectionLevel: options.errorCorrectionLevel || 'M',
    margin: 0,
  })
  const svg = renderSvg(qr, options)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
