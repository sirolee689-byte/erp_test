import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import express from 'express'
import { getRequestIp, resolveTrustProxySetting } from './requestIp.js'

function requestJson(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/ip',
        method: 'GET',
        headers,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => resolve(JSON.parse(body)))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

test('可信本机代理转发后记录原始局域网 IPv4', async (t) => {
  const app = express()
  app.set('trust proxy', resolveTrustProxySetting('loopback'))
  app.get('/ip', (req, res) => {
    res.json({ ip: getRequestIp(req) })
  })

  const server = app.listen(0, '127.0.0.1')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  await new Promise((resolve) => server.once('listening', resolve))

  const result = await requestJson(server.address().port, {
    'x-forwarded-for': '192.168.1.19',
  })
  assert.equal(result.ip, '192.168.1.19')
})

test('IPv4 映射地址统一去掉 ::ffff: 前缀', () => {
  assert.equal(
    getRequestIp({
      ip: '::ffff:192.168.1.25',
      socket: { remoteAddress: '::ffff:192.168.1.25' },
    }),
    '192.168.1.25',
  )
})

test('请求 IP 工具不直接信任客户端伪造的转发请求头', () => {
  assert.equal(
    getRequestIp({
      headers: { 'x-forwarded-for': '10.10.10.10' },
      ip: '192.168.1.88',
      socket: { remoteAddress: '192.168.1.88' },
    }),
    '192.168.1.88',
  )
})

test('可信代理配置默认仅信任本机回环地址', () => {
  assert.equal(resolveTrustProxySetting(''), 'loopback')
  assert.equal(resolveTrustProxySetting('false'), false)
  assert.equal(resolveTrustProxySetting('1'), 1)
  assert.equal(resolveTrustProxySetting('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8')
})
