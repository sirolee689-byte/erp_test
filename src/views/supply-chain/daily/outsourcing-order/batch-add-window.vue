<template>
  <div class="assist-batch-window">
    <header class="assist-batch-header">
      <h1 class="assist-batch-title">外协订单批量选材</h1>
      <p v-if="piNo" class="assist-batch-subtitle">PI 号：{{ piNo }}（已锁定）</p>
    </header>

    <section class="assist-batch-toolbar">
      <div class="assist-batch-toolbar-left">
        <el-form inline class="assist-batch-search" @submit.prevent>
          <el-form-item label="PI号">
            <el-input :model-value="piNo" readonly />
          </el-form-item>
        </el-form>
        <div class="assist-batch-actions">
          <el-button class="assist-batch-toolbar-btn" @click="resetSelection">重置全部</el-button>
          <el-button
            class="assist-batch-toolbar-btn"
            type="primary"
            :disabled="!selectedCount"
            @click="saveSelected"
          >
            保存已选数据
          </el-button>
          <el-button class="assist-batch-toolbar-btn" @click="selectAllAvailable">全部全选</el-button>
          <el-button class="assist-batch-toolbar-btn" @click="closeWindow">返回上一步</el-button>
        </div>
      </div>
    </section>

    <el-skeleton :loading="loading" animated :rows="10">
      <template #default>
        <el-empty v-if="!displayStyles.length && !loading" :description="errorMsg || '暂无款式数据'" />
        <div v-else class="assist-batch-table-wrap">
          <table class="assist-batch-table">
            <thead>
              <tr>
                <th class="col-seq">序号</th>
                <th class="col-action">操作</th>
                <th>PI号</th>
                <th>款号/编码</th>
                <th>名称</th>
                <th class="col-num">数量/可入</th>
                <th class="col-num">单价</th>
                <th class="col-num">单价(含税)</th>
                <th class="col-num">金额/已外协</th>
                <th class="col-num">含税额/出库</th>
                <th>版本</th>
                <th>英文名</th>
                <th>开票名</th>
                <th>规格</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="style in displayStyles" :key="style.product">
                <tr class="assist-batch-row assist-batch-row--style">
                  <td>{{ style.seq }}</td>
                  <td class="col-action">
                    <el-button size="small" disabled>选择</el-button>
                    <el-button size="small" link type="primary" @click="openPiBom(style)">查看</el-button>
                    <el-button size="small" link @click="toggleExpand(style.product)">
                      {{ expandedSet.has(style.product) ? '−' : '+' }}
                    </el-button>
                  </td>
                  <td>{{ style.piNo }}</td>
                  <td :class="codeColorClass(style.codeColor)">{{ style.product }}</td>
                  <td>{{ style.productName || '-' }}</td>
                  <td class="col-num">{{ formatNum(style.orderQty) }}</td>
                  <td class="col-num">{{ formatNum(style.unitPrice) }}</td>
                  <td class="col-num">-</td>
                  <td class="col-num">{{ formatNum(style.amount) }}</td>
                  <td class="col-num">-</td>
                  <td>{{ style.version || '-' }}</td>
                  <td>{{ style.nameEn || '-' }}</td>
                  <td>{{ style.invoiceName || '-' }}</td>
                  <td>{{ style.spec || '-' }}</td>
                </tr>
                <tr v-if="expandedSet.has(style.product)" class="assist-batch-row assist-batch-row--nested">
                  <td colspan="14" class="assist-batch-nested-cell">
                    <table class="assist-batch-subtable">
                      <thead>
                        <tr>
                          <th class="col-seq">序号</th>
                          <th class="col-action">
                            <el-button
                              size="small"
                              class="assist-batch-pick--select-all"
                              @click="selectAllForStyle(style)"
                            >
                              全选
                            </el-button>
                          </th>
                          <th>编码</th>
                          <th>名称(中文)</th>
                          <th class="col-num">未外协数量(可入数量)</th>
                          <th class="col-num">已外协数量(含未审)</th>
                          <th class="col-num">已外协出库数量</th>
                          <th>版本</th>
                          <th>名称(英文)</th>
                          <th>开票名</th>
                          <th>规格</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="mat in style.materials"
                          :key="mat.lineKey"
                          class="assist-batch-subrow"
                        >
                          <td>{{ mat.childSeq }}</td>
                          <td class="col-action">
                            <el-button
                              v-if="isPicked(mat.lineKey)"
                              size="small"
                              type="primary"
                              class="assist-batch-pick-btn assist-batch-pick--picked"
                              @click="togglePick(mat)"
                            >
                              选择成功
                            </el-button>
                            <el-button
                              v-else-if="mat.availableQty <= 0"
                              size="small"
                              disabled
                              class="assist-batch-pick-btn assist-batch-pick--disabled"
                            >
                              选择
                            </el-button>
                            <el-button
                              v-else
                              size="small"
                              type="warning"
                              class="assist-batch-pick-btn assist-batch-pick--ready"
                              @click="togglePick(mat)"
                            >
                              选择
                            </el-button>
                            <el-button size="small" link type="primary" @click="openPiBom(style)">
                              查看
                            </el-button>
                          </td>
                          <td :class="codeColorClass(mat.codeColor)">{{ mat.kcaa01 }}</td>
                          <td>{{ mat.kcaa02 || '-' }}</td>
                          <td class="col-num">{{ formatNum(mat.availableQty) }}</td>
                          <td class="col-num">{{ formatNum(mat.outsourcedQty) }}</td>
                          <td class="col-num">{{ mat.outboundQtyLabel }}</td>
                          <td>{{ mat.version || '-' }}</td>
                          <td>{{ mat.kcaa02En || '-' }}</td>
                          <td>{{ mat.invoiceName || '-' }}</td>
                          <td>{{ mat.kcaa03 || '-' }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </template>
    </el-skeleton>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import {
  ASSIST_BATCH_MSG_ACCEPTED,
  ASSIST_BATCH_MSG_APPLY,
  ASSIST_BATCH_MSG_REJECTED,
  ASSIST_BATCH_REJECT_PI_MISMATCH,
  buildAssistBatchLineKey,
  readAssistBatchContext,
  writeAssistBatchResult,
} from '@/utils/assistOrderBatchAdd'

defineOptions({ name: 'supply-chain-daily-outsourcing-order-batch-window' })

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId ?? '').trim())
const piNo = ref('')
const lockedPiNo = ref('')
const orderId = ref(0)
const loading = ref(false)
const errorMsg = ref('')
const styles = ref([])
const expandedSet = ref(new Set())
const pickedKeys = ref(new Set())
const existingKeys = ref(new Set())
const ctxDeliveryDate = ref('')
const ctxDecimalPlaces = ref(4)

const displayStyles = computed(() => styles.value ?? [])

const selectedCount = computed(() => pickedKeys.value.size)

function formatNum(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return String(n)
}

/** 未命中 Bom_code 前缀红 / 命中 flag5- 前缀蓝 */
function codeColorClass(codeColor) {
  return codeColor === 'sales_list'
    ? 'assist-batch-code--sales-list'
    : 'assist-batch-code--pi-cost'
}

function isPicked(lineKey) {
  return pickedKeys.value.has(lineKey) || existingKeys.value.has(lineKey)
}

function toggleExpand(product) {
  const key = String(product ?? '').trim()
  const next = new Set(expandedSet.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedSet.value = next
}

function togglePick(mat) {
  if (!mat?.isOutsource || mat.availableQty <= 0) return
  const key = mat.lineKey
  if (existingKeys.value.has(key)) return
  const next = new Set(pickedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  pickedKeys.value = next
}

function resetSelection() {
  pickedKeys.value = new Set()
}

function selectAllAvailable() {
  const next = new Set(pickedKeys.value)
  for (const style of styles.value ?? []) {
    for (const mat of style.materials ?? []) {
      if (!mat.isOutsource || mat.availableQty <= 0) continue
      if (existingKeys.value.has(mat.lineKey)) continue
      next.add(mat.lineKey)
    }
  }
  pickedKeys.value = next
}

function selectAllForStyle(style) {
  const next = new Set(pickedKeys.value)
  for (const mat of style?.materials ?? []) {
    if (!mat.isOutsource || mat.availableQty <= 0) continue
    if (existingKeys.value.has(mat.lineKey)) continue
    next.add(mat.lineKey)
  }
  pickedKeys.value = next
}

function openPiBom(style) {
  const oid = Number(orderId.value)
  const product = String(style?.product ?? '').trim()
  if (!Number.isFinite(oid) || oid <= 0 || !product) {
    ElMessage.warning('缺少销售订单或款号，无法打开 PI-BOM')
    return
  }
  const url = `/inventory/basic/pi-bom-data-window?mode=edit&orderId=${encodeURIComponent(oid)}&kcaa01=${encodeURIComponent(product)}`
  window.open(url, '_blank')
}

function findMaterialByKey(lineKey) {
  for (const style of styles.value ?? []) {
    for (const mat of style.materials ?? []) {
      if (mat.lineKey === lineKey) return { style, mat }
    }
  }
  return null
}

function buildSelectedLines() {
  const lines = []
  for (const key of pickedKeys.value) {
    const found = findMaterialByKey(key)
    if (!found) continue
    const { style, mat } = found
    const linePiNo = mat.piNo || piNo.value
    lines.push({
      piNo: linePiNo,
      product: style.product,
      kcaa01: mat.kcaa01,
      kcaa02: mat.kcaa02,
      kcaa02En: mat.kcaa02En,
      invoiceName: mat.invoiceName,
      kcaa03: mat.kcaa03,
      kcaa04: mat.kcaa04,
      kcaa05: mat.kcaa05,
      origin: mat.origin,
      kcaa10: mat.kcaa10,
      kcaa11: mat.kcaa11,
      version: mat.version,
      customerSupply: mat.customerSupply,
      wxak03: mat.availableQty,
      wxak04: 0,
      wxak041: 0,
      tax: 0,
      deliveryDate: ctxDeliveryDate.value,
      referenceNo: linePiNo,
    })
  }
  return lines
}

function saveSelected() {
  if (!pickedKeys.value.size) {
    ElMessage.warning('请先选择物料')
    return
  }
  const lines = buildSelectedLines()
  if (!lines.length) {
    ElMessage.warning('没有可保存的物料行')
    return
  }

  const sid = sessionId.value
  const payload = { sessionId: sid, lines }
  writeAssistBatchResult(sid, payload)

  const opener = window.opener
  if (!opener || opener.closed) {
    ElMessage.error('请从外协订单页重新打开批量选材')
    return
  }

  const origin = window.location.origin
  let settled = false

  function cleanup() {
    settled = true
    window.removeEventListener('message', onReply)
    clearTimeout(timeoutId)
  }

  function onReply(event) {
    if (settled || event.origin !== origin) return
    const data = event.data
    if (!data || data.sessionId !== sid) return

    if (data.type === ASSIST_BATCH_MSG_ACCEPTED) {
      cleanup()
      const count = Number(data.lineCount ?? lines.length)
      ElMessage.success(`已保存 ${count} 条选材`)
      setTimeout(() => window.close(), 300)
      return
    }

    if (data.type === ASSIST_BATCH_MSG_REJECTED) {
      cleanup()
      if (data.reason === ASSIST_BATCH_REJECT_PI_MISMATCH) {
        ElMessage.warning('关联 PI 已变更，请重新打开批量选材')
      } else {
        ElMessage.warning('保存失败，请重试')
      }
    }
  }

  window.addEventListener('message', onReply)
  const timeoutId = setTimeout(() => {
    if (settled) return
    cleanup()
    ElMessage.error('父页面无响应，请确认外协订单页仍打开后重试')
  }, 3000)

  opener.postMessage(
    {
      type: ASSIST_BATCH_MSG_APPLY,
      sessionId: sid,
      openedPiNo: lockedPiNo.value,
      lines,
    },
    origin,
  )
}

function closeWindow() {
  window.close()
}

async function loadTree() {
  if (!piNo.value) {
    ElMessage.error('缺少 PI 号')
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const ctx = readAssistBatchContext(sessionId.value) ?? {}
    const res = await axios.get('/api/assist-order/batch-add-tree', {
      params: {
        piNo: piNo.value,
        excludeOrderNo: ctx.excludeOrderNo ?? '',
        currentLines: JSON.stringify(ctx.currentLines ?? []),
      },
    })
    const body = res.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '读取批量选材失败')
    orderId.value = Number(body.data?.orderId ?? 0)
    styles.value = Array.isArray(body.data?.styles) ? body.data.styles : []
    if (!styles.value.length) errorMsg.value = '该 PI 下暂无款式或物料'
    expandedSet.value = new Set(styles.value.map((s) => String(s.product ?? '').trim()).filter(Boolean))
  } catch (err) {
    styles.value = []
    errorMsg.value = err?.response?.data?.msg || err?.message || '读取批量选材失败'
    ElMessage.error(errorMsg.value)
  } finally {
    loading.value = false
  }
}

function initFromContext() {
  const sid = sessionId.value
  if (!sid) {
    ElMessage.error('缺少会话参数，无法打开批量选材')
    return
  }
  const ctx = readAssistBatchContext(sid)
  if (!ctx) {
    ElMessage.error('批量选材会话已失效，请从外协订单页重新打开')
    return
  }
  piNo.value = String(ctx.piNo ?? route.query?.piNo ?? '').trim()
  lockedPiNo.value = piNo.value
  ctxDeliveryDate.value = String(ctx.deliveryDate ?? '')
  ctxDecimalPlaces.value = Number(ctx.decimalPlaces ?? 4)
  const keys = new Set()
  for (const line of ctx.currentLines ?? []) {
    keys.add(buildAssistBatchLineKey(line.piNo || piNo.value, line.product, line.kcaa01))
  }
  existingKeys.value = keys
}

onMounted(async () => {
  initFromContext()
  if (piNo.value) await loadTree()
})
</script>

<style scoped>
.assist-batch-window {
  min-height: 100vh;
  background: var(--el-bg-color);
  padding: 14px 16px 24px;
}

.assist-batch-header {
  margin-bottom: 12px;
}

.assist-batch-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.assist-batch-subtitle {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.assist-batch-toolbar {
  margin-bottom: 12px;
}

.assist-batch-toolbar-left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.assist-batch-search :deep(.el-input) {
  width: 180px;
}

.assist-batch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 工具栏按钮尺寸 DIY：batch-add-window.vue .assist-batch-toolbar-btn --assist-batch-toolbar-btn-* */
.assist-batch-actions :deep(.assist-batch-toolbar-btn) {
  height: 48px !important;
  font-size: 18px !important;
  padding: 12px 24px !important;
}

.assist-batch-table-wrap {
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}

.assist-batch-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  min-width: 1400px;
}

.assist-batch-table th,
.assist-batch-table td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 6px 8px;
  vertical-align: middle;
  white-space: nowrap;
}

.assist-batch-table th {
  background: var(--el-fill-color-light);
  font-weight: 600;
}

/* 父行边框 DIY：batch-add-window.vue .assist-batch-row--style --assist-batch-style-border */
.assist-batch-row--style {
  --assist-batch-style-border: 2px solid #66bb6a;
  background: #e8f5e9;
}

.assist-batch-row--style > td {
  border-top: var(--assist-batch-style-border);
  border-bottom: var(--assist-batch-style-border);
}

.assist-batch-row--nested {
  background: #fff;
}

.assist-batch-row--nested > td {
  border-top: none;
}

/* 子表左缩进，DIY 可调 --assist-batch-child-indent */
.assist-batch-nested-cell {
  --assist-batch-child-indent: 20px;
  padding: 0 8px 8px var(--assist-batch-child-indent);
}

.assist-batch-subtable {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.assist-batch-subtable th,
.assist-batch-subtable td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 6px 8px;
  vertical-align: middle;
  white-space: nowrap;
}

.assist-batch-subtable th {
  background: var(--el-fill-color-light);
  font-weight: 600;
}

.assist-batch-subrow {
  background: #fff;
}

.col-seq {
  width: 64px;
}

.col-action {
  min-width: 168px;
}

/* 子表操作列宽 DIY：batch-add-window.vue .assist-batch-subtable .col-action --assist-batch-sub-action-width */
.assist-batch-subtable .col-action {
  --assist-batch-sub-action-width: 128px;
  width: var(--assist-batch-sub-action-width);
  min-width: var(--assist-batch-sub-action-width);
  max-width: var(--assist-batch-sub-action-width);
}

.assist-batch-subtable .assist-batch-pick-btn {
  --assist-batch-pick-btn-min-width: 56px;
  min-width: var(--assist-batch-pick-btn-min-width);
  padding-left: 8px;
  padding-right: 8px;
}

.col-num {
  text-align: right;
}

/* 子表头「全选」棕色，DIY 可调下方变量 */
.assist-batch-pick--select-all {
  --assist-batch-select-all-bg: #c67c2e;
  --assist-batch-select-all-border: #c67c2e;
  --el-button-bg-color: var(--assist-batch-select-all-bg);
  --el-button-border-color: var(--assist-batch-select-all-border);
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: #b06f28;
  --el-button-hover-border-color: #b06f28;
  --el-button-hover-text-color: #fff;
  --el-button-active-bg-color: #9a6223;
  --el-button-active-border-color: #9a6223;
}

.assist-batch-pick--ready {
  --el-button-bg-color: #ff7800;
  --el-button-border-color: #ff7800;
  --el-button-hover-bg-color: #e66d00;
  --el-button-hover-border-color: #e66d00;
  --el-button-active-bg-color: #cc6200;
  --el-button-active-border-color: #cc6200;
}

.assist-batch-pick--picked {
  --el-button-bg-color: #409eff;
  --el-button-border-color: #409eff;
}

/* 编码颜色：未命中 Bom_code 前缀红 / 命中 flag5- 前缀蓝，DIY 可调下方变量 */
.assist-batch-code--pi-cost {
  --assist-batch-code-pi-cost: #e60000;
  color: var(--assist-batch-code-pi-cost);
  font-weight: 600;
}

.assist-batch-code--sales-list {
  --assist-batch-code-sales-list: #0066cc;
  color: var(--assist-batch-code-sales-list);
  font-weight: 600;
}
</style>
