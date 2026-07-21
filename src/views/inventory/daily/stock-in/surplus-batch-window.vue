<template>
  <div class="stock-surplus-batch-window">
    <header class="stock-surplus-batch-header">
      <h1 class="stock-surplus-batch-title">盘盈入库批量选材</h1>
      <p class="stock-surplus-batch-subtitle">从物料主档选择盘盈物料　当前仓库：{{ warehouseName || warehouseCode || '-' }}</p>
    </header>

    <section class="stock-surplus-batch-toolbar">
      <span class="stock-surplus-batch-label">查询条件</span>
      <el-input
        v-model="keyword"
        clearable
        class="stock-surplus-batch-query-input"
        placeholder="材料编码"
        @keyup.enter="reload"
      />
      <el-button type="primary" @click="reload">立即查询</el-button>
      <el-button @click="resetKeyword">重置</el-button>
      <el-button :disabled="!rows.some((row) => row.selectable) || saving || submitted" @click="selectAllOnPage">全选</el-button>
      <el-button type="primary" :disabled="!selectedCount || saving || submitted" :loading="saving" @click="saveSelected">
        {{ submitted ? '已提交' : '保存已选数据' }}
      </el-button>
      <el-button @click="closeWindow">关闭</el-button>
      <span class="stock-surplus-batch-selected">已选：{{ selectedCount }} 条</span>
    </section>

    <el-alert
      v-if="closeHint"
      class="stock-surplus-batch-close-hint"
      :title="closeHint"
      type="success"
      show-icon
      :closable="false"
    />

    <el-skeleton :loading="loading" animated :rows="8">
      <template #default>
        <el-empty v-if="!rows.length && !loading" :description="errorMsg || emptyText" />
        <div v-else class="stock-surplus-batch-table-wrap">
          <table class="stock-surplus-batch-table">
            <thead>
              <tr>
                <th class="col-action">操作</th>
                <th>产地</th>
                <th>材料编码</th>
                <th>名称(中文)</th>
                <th>名称(英文)</th>
                <th>名称(开票名)</th>
                <th>规格</th>
                <th>颜色</th>
                <th>单位</th>
                <th>分类</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.lineKey" :class="{ 'stock-surplus-batch-row--picked': isPicked(row) }">
                <td class="col-action">
                  <el-button
                    size="small"
                    :type="isPicked(row) ? 'info' : 'warning'"
                    :disabled="!row.selectable && !isPicked(row)"
                    @click="togglePick(row)"
                  >
                    {{ isPicked(row) ? '已选择' : row.selectLabel }}
                  </el-button>
                </td>
                <td>{{ row.location || '-' }}</td>
                <td>{{ row.kcaa01 || '-' }}</td>
                <td>{{ row.kcaa02 || '-' }}</td>
                <td>{{ row.kcaa02_en || '-' }}</td>
                <td>{{ row.kpname || '-' }}</td>
                <td>{{ row.kcaa03 || '-' }}</td>
                <td>{{ row.kcaa11 || '-' }}</td>
                <td>{{ row.kcaa04 || '-' }}</td>
                <td>{{ row.categoryName || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="stock-surplus-batch-pagination">
          <span>第{{ page }}页，共{{ totalPages }}页，共{{ total }}条，每页{{ pageSize }}条</span>
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :page-sizes="ERP_PAGE_SIZE_OPTIONS"
            :total="total"
            layout="total, sizes, prev, pager, next, jumper"
            small
            background
            @current-change="loadRows"
            @size-change="onPageSizeChange"
          />
        </div>
      </template>
    </el-skeleton>
  </div>
</template>

<script setup>
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import {
  STOCK_BATCH_MSG_ACCEPTED,
  STOCK_BATCH_MSG_APPLY,
  STOCK_BATCH_MSG_REJECTED,
  addSelectableStockBatchRows,
  readStockBatchContext,
  writeStockBatchResult,
} from '@/utils/stockInBatchAdd'

defineOptions({ name: 'inventory-daily-stock-in-surplus-batch-window' })

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId ?? '').trim())
const warehouseCode = ref('')
const warehouseName = ref('')
const inTax = ref('1')
const selectedKeysFromParent = ref([])
const keyword = ref('')
const loading = ref(false)
const saving = ref(false)
const submitted = ref(false)
const errorMsg = ref('')
const closeHint = ref('')
const rows = ref([])
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const pickedKeys = ref(new Set())
const pickedRows = ref(new Map())

const emptyText = '查询结果：没有查询到相关物料'
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value) || 1))
const selectedCount = computed(() => pickedRows.value.size)

function isPicked(row) {
  return pickedKeys.value.has(row.lineKey)
}

function togglePick(row) {
  if (!row?.lineKey) return
  if (isPicked(row)) {
    pickedKeys.value.delete(row.lineKey)
    pickedRows.value.delete(row.lineKey)
    return
  }
  if (!row.selectable) return
  pickedKeys.value.add(row.lineKey)
  pickedRows.value.set(row.lineKey, { ...row })
}

function selectAllOnPage() {
  pickedRows.value = addSelectableStockBatchRows(rows.value, pickedRows.value)
  pickedKeys.value = new Set(pickedRows.value.keys())
}

async function loadRows() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await axios.get('/api/stock-in/surplus-batch-lines', {
      params: {
        keyword: keyword.value.trim() || undefined,
        selectedKeys: [...pickedKeys.value, ...selectedKeysFromParent.value].join(','),
        page: page.value,
        pageSize: pageSize.value,
      },
    })
    const body = res?.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '读取盘盈入库批量选材失败')
    const data = body.data ?? {}
    total.value = Number(data.total ?? 0) || 0
    rows.value = Array.isArray(data.list) ? data.list : []
  } catch (err) {
    rows.value = []
    total.value = 0
    errorMsg.value = String(err?.response?.data?.msg ?? err?.message ?? '读取盘盈入库批量选材失败')
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  loadRows()
}

function resetKeyword() {
  keyword.value = ''
  reload()
}

function onPageSizeChange() {
  page.value = 1
  loadRows()
}

function closeWindow() {
  window.close()
}

function onSaveAccepted(lineCount) {
  submitted.value = true
  closeHint.value = `已保存 ${Number(lineCount) || 0} 条明细，正在关闭窗口...`
  ElMessage.success(closeHint.value)
  setTimeout(() => {
    window.close()
    setTimeout(() => {
      closeHint.value = '明细已带回入库单。如果浏览器未自动关闭，请直接关闭本窗口。'
    }, 300)
  }, 300)
}

async function saveSelected() {
  if (submitted.value || saving.value) return
  if (!pickedRows.value.size) return ElMessage.warning('请先选择明细')
  saving.value = true
  try {
    const picked = [...pickedRows.value.values()]
    const materialCodes = picked.map((row) => String(row.kcaa01 ?? '').trim()).filter(Boolean)
    const priceRes = await axios.post('/api/stock-in/surplus-batch-prices', {
      warehouseCode: warehouseCode.value,
      materialCodes,
    })
    const priceMap = priceRes?.data?.data?.priceMap ?? {}
    const taxMode = String(inTax.value) === '2' ? '2' : '1'
    const lines = picked.map((row) => {
      const code = String(row.kcaa01 ?? '').trim()
      const priceRow = priceMap[code] ?? null
      const ex = Number(priceRow?.kcao04 ?? 0)
      const inc = Number(priceRow?.kcao041 ?? 0)
      const tax = taxMode === '2' ? 0 : Number(priceRow?.tax ?? priceRow?.Tax ?? 0)
      return {
        ...row,
        batchType: 'surplus',
        kcao02: row.systemcode || row.GUID || '',
        kcan04: '',
        kcao03: 1,
        kcao031: 1,
        availableQty: 1,
        needQty: 1,
        kcao04: ex,
        kcao041: inc,
        tax,
        kcao05: Number((1 * ex).toFixed(2)),
        kcao051: Number((1 * inc).toFixed(2)),
        reference: '',
        Describe: '',
        info: '',
      }
    })
    const sid = sessionId.value
    const payload = JSON.parse(JSON.stringify({
      type: STOCK_BATCH_MSG_APPLY,
      sessionId: sid,
      batchType: 'surplus',
      openedWarehouseCode: warehouseCode.value,
      lines,
    }))
    writeStockBatchResult(sid, payload)

    const opener = window.opener
    if (!opener || opener.closed) {
      saving.value = false
      ElMessage.error('请从入库单页面重新打开批量添加')
      return
    }

    const origin = window.location.origin
    let settled = false
    let timeoutId = null
    function cleanup() {
      settled = true
      saving.value = false
      window.removeEventListener('message', onReply)
      clearTimeout(timeoutId)
    }
    function onReply(event) {
      if (settled || event.origin !== origin) return
      const data = event.data
      if (!data || data.sessionId !== sid) return
      if (data.type === STOCK_BATCH_MSG_ACCEPTED) {
        cleanup()
        onSaveAccepted(Number(data.lineCount ?? lines.length))
        return
      }
      if (data.type === STOCK_BATCH_MSG_REJECTED) {
        cleanup()
        ElMessage.warning(data.reason === 'warehouse-mismatch' ? '仓库数据错误，请检查所选仓库' : '保存失败，请重试')
      }
    }
    window.addEventListener('message', onReply)
    timeoutId = setTimeout(() => {
      if (settled) return
      cleanup()
      ElMessage.warning('父页面无响应。若入库单明细已出现新行，可直接关闭本窗口；否则请确认入库单页面仍打开后重试。')
    }, 3000)
    opener.postMessage(payload, origin)
  } catch (err) {
    saving.value = false
    ElMessage.error(String(err?.response?.data?.msg ?? err?.message ?? '保存已选数据失败'))
  }
}

onMounted(() => {
  const ctx = readStockBatchContext(sessionId.value)
  if (!ctx || ctx.batchType !== 'surplus') {
    errorMsg.value = '会话已失效，请从入库单页面重新打开批量添加'
    return
  }
  warehouseCode.value = String(ctx.warehouseCode ?? '').trim()
  warehouseName.value = String(ctx.warehouseName ?? '').trim()
  inTax.value = String(ctx.inTax ?? '1') === '2' ? '2' : '1'
  selectedKeysFromParent.value = Array.isArray(ctx.currentLineKeys) ? ctx.currentLineKeys : []
  pageSize.value = Number(ctx.pageSize ?? 10) || 10
  loadRows()
})
</script>

<style scoped>
.stock-surplus-batch-window {
  min-height: 100vh;
  padding: 20px;
  background: #f5f7fb;
  color: #1f2937;
}

.stock-surplus-batch-header { margin-bottom: 12px; }
.stock-surplus-batch-title { margin: 0 0 6px; font-size: 22px; }
.stock-surplus-batch-subtitle { margin: 0; color: var(--el-text-color-regular); font-size: 15px; }

.stock-surplus-batch-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px;
  background: var(--erp-surface, #fff);
  border-radius: 8px;
}

.stock-surplus-batch-label { color: var(--el-text-color-regular); }
.stock-surplus-batch-query-input { width: 320px; }
.stock-surplus-batch-selected { margin-left: auto; color: #409eff; }
.stock-surplus-batch-close-hint { margin-bottom: 12px; }

.stock-surplus-batch-table-wrap {
  overflow: auto;
  background: var(--erp-surface, #fff);
  border-radius: 8px;
}

.stock-surplus-batch-table {
  min-width: 1120px;
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.stock-surplus-batch-table th,
.stock-surplus-batch-table td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 8px 10px;
  white-space: nowrap;
}

.stock-surplus-batch-table th {
  background: var(--el-fill-color-light, #f5f7fa);
  font-weight: 600;
}

.stock-surplus-batch-table th.col-action,
.stock-surplus-batch-table td.col-action {
  width: 88px;
  text-align: center;
}

.stock-surplus-batch-row--picked { background: var(--el-color-success-light-9, #f0f9eb); }

.stock-surplus-batch-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--erp-surface, #fff);
  border-radius: 8px;
}
</style>
