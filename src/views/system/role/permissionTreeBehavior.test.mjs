import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

const pagePath = new URL('./index.vue', import.meta.url)

describe('角色权限树点击行为', () => {
  test('菜单文字点击不得切换叶子或父级菜单的授权勾选', async () => {
    const source = await readFile(pagePath, 'utf8')

    assert.match(source, /:check-on-click-node="false"/)
    assert.match(source, /:check-on-click-leaf="false"/)
    assert.match(source, /@node-click="onPermNodeClick"/)
    assert.match(source, /@check="onPermTreeCheck"/)
  })

  test('新勾选菜单默认只授予查看权限', async () => {
    const source = await readFile(pagePath, 'utf8')
    assert.match(source, /permActionsByPath\[path\] = \['view'\]/)
  })

  test('审核与反审在操作区独立勾选', async () => {
    const source = await readFile(pagePath, 'utf8')
    assert.match(source, /<el-checkbox label="audit">审核<\/el-checkbox>/)
    assert.match(source, /<el-checkbox label="unaudit">反审<\/el-checkbox>/)
  })
})
