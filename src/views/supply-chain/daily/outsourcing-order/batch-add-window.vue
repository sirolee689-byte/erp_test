<template>
  <div class="assist-batch-window">
    <header class="assist-batch-header">
      <h1 class="assist-batch-title">{{ isOtherBatch ? '其他外协批量选材' : '外协订单批量选材' }}</h1>
      <p v-if="!isOtherBatch && piNo" class="assist-batch-subtitle">PI 号：{{ piNo }}（已锁定）</p>
    </header>

    <section class="assist-batch-toolbar">
      <div class="assist-batch-toolbar-left">
        <template v-if="isOtherBatch">
          <div class="assist-batch-other-row assist-batch-other-row--1">
            <el-form inline class="assist-batch-other-form" @submit.prevent>
              <el-form-item label="分类">
                <el-select
                  v-model="bomCodeId"
                  clearable
                  filterable
                  class="assist-batch-category"
                  placeholder="全部分类"
                  @change="reloadOtherFromFirstPage"
                >
                  <el-option
                    v-for="item in bomCodeOptions"
                    :key="item.id"
                    :label="item.flag1 || item.flag5 || item.id"
                    :value="item.id"
                  />
                </el-select>
              </el-form-item>
            </el-form>
            <span class="assist-batch-selected-count">货品已选数：{{ selectedCount }}</span>
          </div>
          <div class="assist-batch-other-row assist-batch-other-row--2">
            <span class="assist-batch-query-label">查询条件</span>
            <el-input
              v-model="keyword"
              clearable
              class="assist-batch-query-input"
              placeholder="编码/名称/规格/备注"
              @keyup.enter="reloadOtherFromFirstPage"
            />
            <el-button class="assist-batch-toolbar-btn" type="primary" @click="reloadOtherFromFirstPage">
              立即查询
            </el-button>
          </div>
        </template>
        <el-form v-else inline class="assist-batch-search" @submit.prevent>
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
        <el-empty
          v-if="!displayStyles.length && !loading"
          :description="errorMsg || (isOtherBatch ? '暂无货品数据' : '暂无款式数据')"
        />
        <div v-else-if="isOtherBatch" class="assist-batch-table-wrap">
          <table class="assist-batch-table assist-batch-table--other">
            <thead>
              <tr>
                <th class="col-action-other">操作</th>
                <th class="col-code-other">编码</th>
                <th>名称(中文)</th>
                <th>名称(英文)</th>
                <th>名称(开票名)</th>
                <th>规格</th>
                <th>单位</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="style in displayStyles"
                :key="`${style.seq}-${style.product}`"
                class="assist-batch-row assist-batch-row--other"
              >
                <td class="col-action-other">
                  <el-button
                    size="small"
                    :type="isPicked(stylePickLine(style)?.lineKey) ? 'primary' : 'warning'"
                    :disabled="!canPickStyle(style) && !isPicked(stylePickLine(style)?.lineKey)"
                    class="assist-batch-pick-btn assist-batch-pick-btn--other"
                    @click="togglePickStyle(style)"
                  >
                    {{ isPicked(stylePickLine(style)?.lineKey) ? '选择成功' : '选择' }}
                  </el-button>
                </td>
                <td class="col-code-other">{{ otherRowMat(style)?.kcaa01 || style.product || '-' }}</td>
                <td>{{ otherRowMat(style)?.kcaa02 || style.productName || '-' }}</td>
                <td>{{ otherRowMat(style)?.kcaa02En || style.nameEn || '-' }}</td>
                <td>{{ otherRowMat(style)?.invoiceName || style.invoiceName || '-' }}</td>
                <td>{{ otherRowMat(style)?.kcaa03 || style.spec || '-' }}</td>
                <td>{{ otherRowMat(style)?.kcaa04 || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
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
              <template v-for="style in displayStyles" :key="`${style.seq}-${style.product}`">
                <tr class="assist-batch-row assist-batch-row--style">
                  <td>{{ style.seq }}</td>
                  <td class="col-action">
                    <el-button
                      v-if="isSingleLayerBatch"
                      size="small"
                      :type="isPicked(stylePickLine(style)?.lineKey) ? 'primary' : 'warning'"
                      :disabled="!canPickStyle(style) && !isPicked(stylePickLine(style)?.lineKey)"
                      class="assist-batch-pick-btn"
                      @click="togglePickStyle(style)"
                    >
                      {{ isPicked(stylePickLine(style)?.lineKey) ? '\u9009\u62e9\u6210\u529f' : '\u9009\u62e9' }}
                    </el-button>
                    <el-button v-else size="small" disabled>选择</el-button>
                    <el-button v-if="!isSingleLayerBatch" size="small" link type="primary" @click="openPiBom(style)">查看</el-button>
                    <el-button v-if="!isSingleLayerBatch" size="small" link @click="toggleExpand(style.product)">
                      {{ expandedSet.has(style.product) ? '−' : '+' }}
                    </el-button>
                  </td>
                  <td>{{ style.piNo }}</td>
                  <td :class="codeColorClass(style.codeColor)">{{ style.product }}</td>
                  <td>{{ style.productName || '-' }}</td>
                  <td class="col-num">{{ formatNum(isSingleLayerBatch ? styleAvailableQty(style) : style.orderQty) }}</td>
                  <td class="col-num">{{ formatNum(style.unitPrice) }}</td>
                  <td class="col-num">{{ isSingleLayerBatch ? formatNum(style.unitPriceTax) : '-' }}</td>
                  <td class="col-num">{{ formatNum(style.amount) }}</td>
                  <td class="col-num">{{ isSingleLayerBatch ? formatNum(style.amountTax) : '-' }}</td>
                  <td>{{ style.version || '-' }}</td>
                  <td>{{ style.nameEn || '-' }}</td>
                  <td>{{ style.invoiceName || '-' }}</td>
                  <td>{{ style.spec || '-' }}</td>
                </tr>
                <tr v-if="!isSingleLayerBatch && expandedSet.has(style.product)" class="assist-batch-row assist-batch-row--nested">
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
    <div v-if="isOtherBatch" class="assist-batch-pagination">
      <span class="assist-batch-pagination-info">
        第{{ otherPage }}页/共{{ otherTotalPages }}页，共{{ otherTotal }}条记录
      </span>
      <el-pagination
        v-model:current-page="otherPage"
        v-model:page-size="otherPageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="otherTotal"
        layout="prev, pager, next, sizes, jumper"
        small
        background
        @current-change="loadTree"
        @size-change="onOtherPageSizeChange"
      />
    </div>
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
  ASSIST_BATCH_REJECT_SUPPLIER_MISMATCH,
  buildAssistBatchLineKey,
  readAssistBatchContext,
  writeAssistBatchResult,
} from '@/utils/assistOrderBatchAdd'

defineOptions({ name: 'supply-chain-daily-outsourcing-order-batch-window' })

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId ?? '').trim())
const piNo = ref('')
const lockedPiNo = ref('')
const lockedSupplierCode = ref('')
const lockedAssistType = ref('1')
const orderId = ref(0)
const loading = ref(false)
const errorMsg = ref('')
const styles = ref([])
const expandedSet = ref(new Set())
const pickedKeys = ref(new Set())
const pickedRows = ref(new Map())
const existingKeys = ref(new Set())
const ctxDeliveryDate = ref('')
const ctxDecimalPlaces = ref(4)
const keyword = ref('')
const bomCodeId = ref('')
const bomCodeOptions = ref([])
const otherPage = ref(1)
const otherPageSize = ref(10)
const otherTotal = ref(0)

const displayStyles = computed(() => styles.value ?? [])
const isOutboundBatch = computed(() => lockedAssistType.value === '2')
const isOtherBatch = computed(() => lockedAssistType.value === '0')
const isSingleLayerBatch = computed(() => isOutboundBatch.value)
const otherTotalPages = computed(() => Math.max(1, Math.ceil(Number(otherTotal.value || 0) / Number(otherPageSize.value || 10))))

const selectedCount = computed(() => pickedKeys.value.size)

function formatNum(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return String(n)
}

/** 未命中 Bom_code 前缀红 / 命中 flag5- 前缀蓝 */
function codeColorClass(codeColor) {
  if (codeColor === 'outbound') return ''
  return codeColor === 'sales_list'
    ? 'assist-batch-code--sales-list'
    : 'assist-batch-code--pi-cost'
}

function isPicked(lineKey) {
  return pickedKeys.value.has(lineKey) || existingKeys.value.has(lineKey)
}

function stylePickLine(style) {
  return Array.isArray(style?.materials) ? style.materials[0] : null
}

function otherRowMat(style) {
  return stylePickLine(style)
}

function styleAvailableQty(style) {
  return Number(stylePickLine(style)?.availableQty ?? 0)
}

function canPickStyle(style) {
  const mat = stylePickLine(style)
  if (!mat?.isOutsource || existingKeys.value.has(mat.lineKey)) return false
  if (isOtherBatch.value) return true
  return Number(mat?.availableQty ?? 0) > 0
}

function togglePickStyle(style) {
  const mat = stylePickLine(style)
  if (!mat) return
  togglePick(mat, style)
}

function toggleExpand(product) {
  const key = String(product ?? '').trim()
  const next = new Set(expandedSet.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedSet.value = next
}

function togglePick(mat, style = null) {
  if (!mat?.isOutsource) return
  if (!isOtherBatch.value && mat.availableQty <= 0) return
  const key = mat.lineKey
  if (existingKeys.value.has(key)) return
  const next = new Set(pickedKeys.value)
  const nextRows = new Map(pickedRows.value)
  if (next.has(key)) {
    next.delete(key)
    nextRows.delete(key)
  } else {
    next.add(key)
    nextRows.set(key, { style, mat })
  }
  pickedKeys.value = next
  pickedRows.value = nextRows
}

function resetSelection() {
  pickedKeys.value = new Set()
  pickedRows.value = new Map()
}

function selectAllAvailable() {
  const next = new Set(pickedKeys.value)
  for (const style of styles.value ?? []) {
    for (const mat of style.materials ?? []) {
      if (!mat.isOutsource) continue
      if (!isOtherBatch.value && mat.availableQty <= 0) continue
      if (existingKeys.value.has(mat.lineKey)) continue
      next.add(mat.lineKey)
      pickedRows.value.set(mat.lineKey, { style, mat })
    }
  }
  pickedKeys.value = next
}

function selectAllForStyle(style) {
  const next = new Set(pickedKeys.value)
  for (const mat of style?.materials ?? []) {
    if (!mat.isOutsource) continue
    if (!isOtherBatch.value && mat.availableQty <= 0) continue
    if (existingKeys.value.has(mat.lineKey)) continue
    next.add(mat.lineKey)
    pickedRows.value.set(mat.lineKey, { style, mat })
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
  return pickedRows.value.get(lineKey) ?? null
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
      product: isOtherBatch.value ? '' : style.product,
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
      wxak03: isOtherBatch.value ? 0 : mat.availableQty,
      wxak04: Number(mat.wxab04 ?? mat.wxak04 ?? 0),
      wxak041: Number(mat.wxab05 ?? mat.wxak041 ?? 0),
      tax: Number(mat.tax ?? 0),
      deliveryDate: ctxDeliveryDate.value,
      referenceNo: isOtherBatch.value ? '' : linePiNo,
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
  const payload = {
    sessionId: sid,
    openedPiNo: lockedPiNo.value,
    openedSupplierCode: lockedSupplierCode.value,
    lines,
  }
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
      } else if (data.reason === ASSIST_BATCH_REJECT_SUPPLIER_MISMATCH) {
        ElMessage.warning('\u5916\u534f\u5546\u5df2\u53d8\u66f4\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u6279\u91cf\u9009\u6750')
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
      openedSupplierCode: lockedSupplierCode.value,
      lines,
    },
    origin,
  )
}

function closeWindow() {
  window.close()
}

async function loadBomCodeOptions() {
  if (!isOtherBatch.value) return
  try {
    const res = await axios.get('/api/inv/bom/bom-code-categories')
    const list = res.data?.data?.list
    bomCodeOptions.value = Array.isArray(list) ? list : []
  } catch {
    bomCodeOptions.value = []
  }
}

async function loadTree() {
  if (!isOtherBatch.value && !piNo.value) {
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
        assistType: lockedAssistType.value,
        keyword: isOtherBatch.value ? keyword.value : '',
        bomCodeId: isOtherBatch.value ? bomCodeId.value : '',
        page: isOtherBatch.value ? otherPage.value : '',
        pageSize: isOtherBatch.value ? otherPageSize.value : '',
        supplierCode: ctx.supplierCode ?? '',
        excludeOrderNo: ctx.excludeOrderNo ?? '',
        currentLines: JSON.stringify(ctx.currentLines ?? []),
      },
    })
    const body = res.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '读取批量选材失败')
    orderId.value = Number(body.data?.orderId ?? 0)
    styles.value = Array.isArray(body.data?.styles) ? body.data.styles : []
    if (isOtherBatch.value) {
      otherTotal.value = Number(body.data?.total ?? 0)
      otherPage.value = Number(body.data?.page ?? otherPage.value) || 1
      otherPageSize.value = Number(body.data?.pageSize ?? otherPageSize.value) || 10
    }
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

async function reloadOtherFromFirstPage() {
  otherPage.value = 1
  await loadTree()
}

async function onOtherPageSizeChange(size) {
  otherPageSize.value = Number(size) || 10
  otherPage.value = 1
  await loadTree()
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
  lockedAssistType.value = String(ctx.assistType ?? '1').trim() || '1'
  lockedSupplierCode.value = String(ctx.supplierCode ?? '').trim()
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
  await loadBomCodeOptions()
  if (piNo.value || isOtherBatch.value) await loadTree()
})
</script>

<style scoped>
.assist-batch-window {
  min-height: 100vh;
  background: #f4f6f8;
  padding: 12px 14px 22px;
  color: #111827;
}

.assist-batch-header {
  margin-bottom: 10px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #d8dde3;
  border-radius: 4px;
}

.assist-batch-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.assist-batch-subtitle {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.assist-batch-toolbar {
  margin-bottom: 10px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #d8dde3;
  border-radius: 4px;
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

.assist-batch-category {
  width: 150px;
}

.assist-batch-other-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  width: 100%;
}

.assist-batch-other-row--2 {
  gap: 10px;
}

.assist-batch-other-form {
  margin: 0;
}

.assist-batch-other-form :deep(.el-form-item) {
  margin-bottom: 0;
}

.assist-batch-selected-count {
  font-size: 13px;
  color: #111827;
  font-weight: 600;
  white-space: nowrap;
}

.assist-batch-query-label {
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
}

/* 查询框宽度 DIY：batch-add-window.vue .assist-batch-query-input --assist-batch-query-input-width */
.assist-batch-query-input {
  --assist-batch-query-input-width: 30%;
  flex: 0 0 var(--assist-batch-query-input-width);
  width: var(--assist-batch-query-input-width);
  min-width: 180px;
  max-width: 480px;
}

.assist-batch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 工具栏按钮尺寸 DIY：batch-add-window.vue .assist-batch-toolbar-btn --assist-batch-toolbar-btn-* */
.assist-batch-actions :deep(.assist-batch-toolbar-btn) {
  height: 32px !important;
  font-size: 13px !important;
  padding: 6px 14px !important;
  border-radius: 3px !important;
}

.assist-batch-table-wrap {
  overflow: auto;
  background: #fff;
  border: 1px solid #d3d8de;
  border-radius: 4px;
  box-shadow: 0 1px 2px rgb(17 24 39 / 5%);
}

.assist-batch-pagination {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 10px;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid #d3d8de;
  border-radius: 4px;
}

.assist-batch-pagination-info {
  color: #111827;
  font-size: 13px;
  white-space: nowrap;
}

.assist-batch-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  min-width: 1400px;
  table-layout: fixed;
}

.assist-batch-table th,
.assist-batch-table td {
  border: 1px solid #d8dde3;
  padding: 0 8px;
  height: 36px;
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}

.assist-batch-table th {
  background: #f1f2f4;
  color: #111827;
  font-weight: 600;
  height: 42px;
  line-height: 18px;
  white-space: normal;
}

/* 父行边框 DIY：batch-add-window.vue .assist-batch-row--style --assist-batch-style-border */
.assist-batch-row--style {
  --assist-batch-style-border: 1px solid #d8dde3;
  background: #fff;
}

.assist-batch-row--style > td {
  border-top: var(--assist-batch-style-border);
  border-bottom: var(--assist-batch-style-border);
}

.assist-batch-row--style:hover > td {
  background: #f8fbff;
}

.assist-batch-row--nested {
  background: #fafafa;
}

.assist-batch-row--nested > td {
  border-top: none;
}

/* 子表左缩进，DIY 可调 --assist-batch-child-indent */
.assist-batch-nested-cell {
  --assist-batch-child-indent: 20px;
  padding: 8px 8px 10px var(--assist-batch-child-indent);
  background: #fafafa;
}

.assist-batch-subtable {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.assist-batch-subtable th,
.assist-batch-subtable td {
  border: 1px solid #d8dde3;
  padding: 0 8px;
  height: 34px;
  vertical-align: middle;
  white-space: nowrap;
  text-align: center;
}

.assist-batch-subtable th {
  background: #f1f2f4;
  color: #111827;
  font-weight: 600;
  height: 38px;
  line-height: 18px;
  white-space: normal;
}

.assist-batch-subrow {
  background: #fff;
}

.col-seq {
  width: 58px;
}

.col-action {
  width: 170px;
  min-width: 170px;
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

.assist-batch-table :deep(.el-button--small),
.assist-batch-subtable :deep(.el-button--small) {
  height: 22px;
  min-height: 22px;
  padding: 2px 10px;
  border-radius: 2px;
  font-size: 12px;
  line-height: 18px;
}

.assist-batch-table :deep(.el-button + .el-button),
.assist-batch-subtable :deep(.el-button + .el-button) {
  margin-left: 6px;
}

.col-num {
  text-align: center;
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
  --el-button-bg-color: #4b9dcc;
  --el-button-border-color: #4b9dcc;
  --el-button-hover-bg-color: #3d8dbb;
  --el-button-hover-border-color: #3d8dbb;
  --el-button-active-bg-color: #327da8;
  --el-button-active-border-color: #327da8;
}

.assist-batch-pick--picked {
  --el-button-bg-color: #9ca3af;
  --el-button-border-color: #9ca3af;
  --el-button-hover-bg-color: #8b949f;
  --el-button-hover-border-color: #8b949f;
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

.assist-batch-table--other {
  min-width: 960px;
  table-layout: auto;
}

.assist-batch-table--other th,
.assist-batch-table--other td {
  text-align: left;
}

/* 操作列宽 DIY：batch-add-window.vue .col-action-other --assist-batch-other-action-width */
.col-action-other {
  --assist-batch-other-action-width: 76px;
  width: var(--assist-batch-other-action-width);
  min-width: var(--assist-batch-other-action-width);
  max-width: var(--assist-batch-other-action-width);
  text-align: center !important;
  padding-left: 4px !important;
  padding-right: 4px !important;
}

.assist-batch-pick-btn--other {
  --assist-batch-other-pick-min-width: 52px;
  min-width: var(--assist-batch-other-pick-min-width);
  padding-left: 6px !important;
  padding-right: 6px !important;
}

.assist-batch-table--other :deep(.assist-batch-pick-btn--other.el-button--small) {
  height: 22px;
  min-height: 22px;
  padding-top: 2px;
  padding-bottom: 2px;
}

/* 编码列完整展示 DIY：batch-add-window.vue .col-code-other --assist-batch-other-code-min-width */
.col-code-other {
  --assist-batch-other-code-min-width: 160px;
  min-width: var(--assist-batch-other-code-min-width);
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  word-break: break-all;
  font-weight: 600;
}
</style>
