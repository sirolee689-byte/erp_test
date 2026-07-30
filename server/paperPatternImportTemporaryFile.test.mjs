import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  PAPER_PATTERN_TEMP_FILE_MAX_AGE_MS,
  discardPaperPatternTemporaryUpload,
  pruneExpiredPaperPatternTemporaryUploads,
} from './paperPatternImportTemporaryFile.js'

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'paper-pattern-temp-'))
}

test('过期清理只删除超过 24 小时的 UUID 临时 Excel', () => {
  const dir = makeTempDir()
  const now = Date.now()
  const oldUuid = '1b773a9e-8d84-4d41-a0cf-ec8774de361e.xls'
  const freshUuid = '2b773a9e-8d84-4d41-a0cf-ec8774de361e.xlsx'
  const archived = '20260730123000.xls'
  const other = 'notes.txt'
  try {
    for (const name of [oldUuid, freshUuid, archived, other]) {
      fs.writeFileSync(path.join(dir, name), 'test')
    }
    fs.utimesSync(path.join(dir, oldUuid), new Date(now - PAPER_PATTERN_TEMP_FILE_MAX_AGE_MS - 1), new Date(now - PAPER_PATTERN_TEMP_FILE_MAX_AGE_MS - 1))
    fs.utimesSync(path.join(dir, freshUuid), new Date(now - PAPER_PATTERN_TEMP_FILE_MAX_AGE_MS + 1), new Date(now - PAPER_PATTERN_TEMP_FILE_MAX_AGE_MS + 1))

    assert.equal(pruneExpiredPaperPatternTemporaryUploads({ uploadDir: dir, now }), 1)
    assert.equal(fs.existsSync(path.join(dir, oldUuid)), false)
    assert.equal(fs.existsSync(path.join(dir, freshUuid)), true)
    assert.equal(fs.existsSync(path.join(dir, archived)), true)
    assert.equal(fs.existsSync(path.join(dir, other)), true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('丢弃接口底层只删除 UUID 临时 Excel，不处理归档文件或非法标识', () => {
  const dir = makeTempDir()
  const oldDir = process.env.PAPER_PATTERN_UPLOAD_DIR
  const uuid = '1b773a9e-8d84-4d41-a0cf-ec8774de361e.xls'
  try {
    process.env.PAPER_PATTERN_UPLOAD_DIR = dir
    fs.writeFileSync(path.join(dir, uuid), 'test')
    fs.writeFileSync(path.join(dir, '20260730123000.xls'), 'archive')

    assert.equal(discardPaperPatternTemporaryUpload('invalid').deleted, false)
    assert.equal(discardPaperPatternTemporaryUpload('20260730123000').deleted, false)
    assert.equal(discardPaperPatternTemporaryUpload(uuid.slice(0, -4)).deleted, true)
    assert.equal(fs.existsSync(path.join(dir, uuid)), false)
    assert.equal(fs.existsSync(path.join(dir, '20260730123000.xls')), true)
  } finally {
    if (oldDir === undefined) delete process.env.PAPER_PATTERN_UPLOAD_DIR
    else process.env.PAPER_PATTERN_UPLOAD_DIR = oldDir
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
