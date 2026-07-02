import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { makeQrSvgDataUrl } from './qrCodeSvg.js'

describe('qrCodeSvg', () => {
  test('使用标准二维码库生成 SVG data url', () => {
    const url = makeQrSvgDataUrl('http://localhost:5173/view.asp?action=stocks&kcaa01=ZS-0034%2FCFL&kcao01=R26070201')
    assert.match(url, /^data:image\/svg\+xml;charset=utf-8,/)

    const svg = decodeURIComponent(url.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
    assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    assert.match(svg, /viewBox="0 0 \d+ \d+"/)
    assert.match(svg, /<rect width="/)
    assert.match(svg, /<g fill="#000">/)
  })

  test('支持较长的手机扫码链接', () => {
    const url = makeQrSvgDataUrl('http://localhost:5173/view.asp?action=stocks&kcaa01=LONG-MATERIAL-CODE-001%2FABC-20260702&kcao01=R260702040001')
    assert.match(url, /^data:image\/svg\+xml;charset=utf-8,/)
  })

  test('空内容时报明确错误', () => {
    assert.throws(() => makeQrSvgDataUrl(''), /二维码内容不能为空/)
  })
})
