<template>
  <div class="erp-module-page paper-pattern-manage-page">
    <el-card shadow="never">
      <template #header>
        <span class="page-title">管理纸格导入资料</span>
      </template>
      <p class="page-desc">
        数据表 <code>System_uplod_file</code>（<code>filepath</code> 含 <code>ub_bom</code>）；上传/下载目录由服务端
        <code>.env</code> 配置 <code>PAPER_PATTERN_UPLOAD_DIR</code>、<code>PAPER_PATTERN_DOWNLOAD_ROOT</code>。
      </p>

      <div class="search-panel">
        <div class="search-field">
          <span class="search-label">查询条件</span>
          <el-input
            v-model="keyword"
            class="search-input"
            clearable
            placeholder="上传者、原始文件名、上传时间、文件大小（KB）"
            @keyup.enter="onSearchNow"
          />
        </div>
        <div class="search-actions">
          <el-button type="primary" :loading="loading" @click="onSearchNow">立即查询</el-button>
          <el-button @click="onReset">重置</el-button>
          <el-button type="primary" plain :loading="loading" @click="onSearchAll">查询全部</el-button>
        </div>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />

      <div class="pagination-row pagination-row--top">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100, 200]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="onPageChange"
          @size-change="onPageSizeChange"
        />
      </div>

      <div class="list-panel">
        <h3 class="list-title">纸格资料列表</h3>
        <el-skeleton :loading="loading && !hasLoadedOnce" animated :rows="4">
          <template #default>
            <div v-if="hasLoadedOnce && total === 0" class="empty-hint">
              查询结果：没有查询到相关信息
            </div>
            <template v-else-if="hasLoadedOnce && total > 0">
              <p class="list-summary">
                共 <strong>{{ total }}</strong> 条记录（当前第 {{ page }} 页，每页 {{ pageSize }} 条）
              </p>
              <el-table :data="previewRows" border stripe size="small" class="preview-table">
                <el-table-column prop="uploaderName" label="上传者" width="120" show-overflow-tooltip />
                <el-table-column prop="addtime" label="上传时间" width="168" show-overflow-tooltip />
                <el-table-column prop="truefilename" label="文件名" min-width="200" show-overflow-tooltip />
                <el-table-column label="下载" width="88" align="center">
                  <template #default="{ row }">
                    <el-button
                      type="primary"
                      link
                      :loading="downloadingId === row.id"
                      @click="onDownload(row)"
                    >
                      下载
                    </el-button>
                  </template>
                </el-table-column>
                <el-table-column prop="filesizeDisplay" label="文件大小" width="100" />
              </el-table>
              <div class="pagination-row pagination-row--bottom">
                <el-pagination
                  v-model:current-page="page"
                  v-model:page-size="pageSize"
                  :total="total"
                  :page-sizes="[20, 50, 100, 200]"
                  layout="total, sizes, prev, pager, next, jumper"
                  background
                  @current-change="onPageChange"
                  @size-change="onPageSizeChange"
                />
              </div>
            </template>
          </template>
        </el-skeleton>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'

const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const tableList = ref([])
const loading = ref(false)
const errorMessage = ref('')
const hasLoadedOnce = ref(false)
/** 当前列表对应的查询模式（重置输入框时不改） */
const activeQueryAll = ref(true)
const activeKeyword = ref('')
const downloadingId = ref(null)

const previewRows = computed(() => tableList.value)

function parseFilenameFromContentDisposition(header) {
  const raw = String(header ?? '')
  const star = raw.match(/filename\*=UTF-8''([^;\s]+)/i)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      /* 忽略 */
    }
  }
  const plain = raw.match(/filename="([^"]+)"/i) || raw.match(/filename=([^;\s]+)/i)
  return plain?.[1] ? plain[1].replace(/^"|"$/g, '') : ''
}

async function onDownload(row) {
  const id = Number(row?.id ?? 0)
  if (!id) return
  downloadingId.value = id
  try {
    const res = await axios.get('/api/paper-pattern/import/files/download', {
      params: { id },
      responseType: 'blob',
    })
    const blob = res.data
    const ct = String(res.headers?.['content-type'] ?? '').toLowerCase()
    if (ct.includes('application/json') || ct.includes('text/json')) {
      const text = await blob.text()
      let msg = '下载失败'
      try {
        const j = JSON.parse(text)
        msg = j?.msg || j?.message || msg
      } catch {
        msg = text || msg
      }
      ElMessage.error(msg)
      return
    }
    const disp = res.headers?.['content-disposition'] ?? ''
    const name =
      parseFilenameFromContentDisposition(disp) ||
      String(row.filename ?? '').trim() ||
      'download.xls'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    const blob = e?.response?.data
    if (blob instanceof Blob) {
      try {
        const text = await blob.text()
        const j = JSON.parse(text)
        ElMessage.error(j?.msg || j?.message || '下载失败')
        return
      } catch {
        /* 忽略 */
      }
    }
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '下载失败'))
  } finally {
    downloadingId.value = null
  }
}

async function fetchList() {
  loading.value = true
  errorMessage.value = ''
  try {
    const params = {
      page: page.value,
      pageSize: pageSize.value,
    }
    if (activeQueryAll.value) {
      params.queryAll = '1'
    } else {
      params.keyword = activeKeyword.value
    }
    const res = await axios.get('/api/paper-pattern/import/files/list', { params })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = body?.msg || '加载失败'
      return
    }
    const data = body.data ?? {}
    total.value = Number(data.total ?? 0)
    tableList.value = Array.isArray(data.list) ? data.list : []
    hasLoadedOnce.value = true
  } catch (e) {
    errorMessage.value = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
  } finally {
    loading.value = false
  }
}

function onSearchNow() {
  const q = String(keyword.value ?? '').trim()
  if (!q) {
    ElMessage.warning('请填写查询条件')
    return
  }
  activeQueryAll.value = false
  activeKeyword.value = q
  page.value = 1
  fetchList()
}

function onReset() {
  keyword.value = ''
}

function onSearchAll() {
  keyword.value = ''
  activeQueryAll.value = true
  activeKeyword.value = ''
  page.value = 1
  fetchList()
}

function onPageChange() {
  if (!hasLoadedOnce.value) return
  fetchList()
}

function onPageSizeChange() {
  page.value = 1
  if (!hasLoadedOnce.value) return
  fetchList()
}

onMounted(() => {
  onSearchAll()
})
</script>

<style scoped>
.paper-pattern-manage-page .page-title {
  font-size: 16px;
  font-weight: 600;
}
.page-desc {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.search-panel {
  padding: 16px;
  margin-bottom: 16px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}
.search-field {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.search-label {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.search-input {
  flex: 1;
  max-width: 720px;
}
.search-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.error-alert {
  margin-bottom: 12px;
}
.list-panel {
  margin-top: 8px;
}
.list-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
}
.empty-hint {
  padding: 24px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
.list-summary {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.preview-table {
  margin-bottom: 12px;
}
</style>
