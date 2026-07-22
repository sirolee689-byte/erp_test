<template>

  <div class="erp-module-page customs-declaration-page">

    <el-card v-if="!canView" shadow="never">

      <el-alert

        type="error"

        show-icon

        :closable="false"

        title="无权限"

        description="您没有「海关单」查看权限，无法访问本页。"

      />

    </el-card>



    <template v-else>

      <el-card shadow="never" class="block-card">

        <template #header>

          <span class="page-title">{{ pageTitle }}</span>

        </template>



        <div class="upload-row">

          <input

            ref="fileInputRef"

            type="file"

            class="hidden-file"

            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"

            @change="onFileChange"

          />

          <el-button type="primary" plain @click="triggerPickFile">选择 Excel</el-button>

          <span v-if="pickedLabel" class="picked-name">{{ pickedLabel }}</span>

          <span v-else class="picked-placeholder">未选择文件（列对齐 docs/海关单模版.md）</span>

          <el-button

            type="primary"

            :disabled="!pickedFile || !canView"

            :loading="previewLoading"

            @click="onPreview"

          >

            上传并预览

          </el-button>

          <el-button plain :disabled="!previewData" @click="onClearPreview">清除预览</el-button>

        </div>



        <el-tabs v-model="mainTab">

          <el-tab-pane label="入库单" name="inbound">

            <el-alert

              type="info"

              show-icon

              :closable="false"

              class="mb-12"

              title="上传海关 Excel → 预览匹配 → 确认后生成生产入库单（包装部 / 成品仓）。生成后自动审核进库存。"

            />



            <template v-if="previewData">

              <el-alert

                class="mb-12"

                type="success"

                show-icon

                :closable="false"

                :title="inboundSummaryText"

              />



              <div class="toolbar">

                <el-button

                  type="primary"

                  :disabled="!canGenerateInbound || !previewGroups.length"

                  :loading="generateInboundLoading"

                  :title="generateInboundDisabledTitle"

                  @click="onGenerateInbound"

                >

                  确认生成入库单

                </el-button>

                <span class="hint">车间 {{ workshopLabel }} · 仓库 {{ warehouseLabel }} · 类型生产入库</span>

              </div>



              <el-collapse v-model="openInboundGroups" class="group-collapse">

                <el-collapse-item

                  v-for="g in previewGroups"

                  :key="g.groupKey"

                  :name="g.groupKey"

                >

                  <template #title>

                    <div class="group-title">

                      <span>{{ g.formalPi }}</span>

                      <span class="sep">|</span>

                      <span>派工 {{ g.dispatchOrderNo }}</span>

                      <span class="sep">|</span>

                      <span>{{ g.lineCount }} 行</span>

                      <span class="sep">|</span>

                      <span>申报 {{ formatQty(g.totalDeclareQty) }} → 入库 {{ formatQty(g.totalInboundQty) }}</span>

                      <el-tag v-if="g.warnings?.length" size="small" type="warning" class="ml-8">有提示</el-tag>

                    </div>

                  </template>



                  <div class="group-meta">

                    <el-form :inline="true" @submit.prevent>

                      <el-form-item label="入库日期">

                        <el-date-picker

                          v-model="g.inboundDate"

                          type="date"

                          value-format="YYYY-MM-DD"

                          placeholder="入库日期"

                          style="width: 160px"

                          @change="() => onGroupInboundDateChange(g)"

                        />

                      </el-form-item>

                      <el-form-item label="来货单号(PI)">

                        <el-input :model-value="g.formalPi" disabled style="width: 140px" />

                      </el-form-item>

                      <el-form-item label="备注">

                        <el-input v-model="g.remark" style="width: 360px" />

                      </el-form-item>

                    </el-form>

                    <ul v-if="g.warnings?.length" class="warn-list">

                      <li v-for="(w, i) in g.warnings" :key="i">{{ w }}</li>

                    </ul>

                  </div>



                  <el-table :data="g.lines" border size="small" class="line-table">

                    <el-table-column prop="excelRowNo" label="行" width="56" />

                    <el-table-column prop="customsNo" label="报关单号" min-width="140" show-overflow-tooltip />

                    <el-table-column prop="shipDate" label="出货日" width="110" />

                    <el-table-column prop="kcaa01" label="成品编码" min-width="140" show-overflow-tooltip />

                    <el-table-column prop="productName" label="名称" min-width="100" show-overflow-tooltip />

                    <el-table-column label="申报数量" width="90" align="right">

                      <template #default="{ row }">{{ formatQty(row.declareQty) }}</template>

                    </el-table-column>

                    <el-table-column label="入库数量" width="90" align="right">

                      <template #default="{ row }">

                        <span :class="{ 'text-warn': row.truncated }">{{ formatQty(row.inboundQty) }}</span>

                      </template>

                    </el-table-column>

                    <el-table-column label="可入余量" width="90" align="right">

                      <template #default="{ row }">{{ formatQty(row.tempx) }}</template>

                    </el-table-column>

                    <el-table-column label="已入提示" min-width="160" show-overflow-tooltip>

                      <template #default="{ row }">

                        <span v-if="row.truncated" class="text-warn">{{ row.truncateHint }}</span>

                        <span v-else-if="row.alreadyInboundHint">{{ row.alreadyInboundHint }}</span>

                        <span v-else>-</span>

                      </template>

                    </el-table-column>

                  </el-table>

                </el-collapse-item>

              </el-collapse>



              <el-card v-if="failedRows.length" shadow="never" class="fail-card">

                <template #header>

                  <span>入库失败行（{{ failedRows.length }}）—— 不生成，成功组不受影响</span>

                </template>

                <el-table :data="failedRows" border size="small">

                  <el-table-column prop="excelRowNo" label="行" width="56" />

                  <el-table-column prop="excelPi" label="Excel PI" width="100" />

                  <el-table-column prop="kcaa01" label="成品编码" min-width="130" />

                  <el-table-column prop="declareQty" label="申报数量" width="90" align="right" />

                  <el-table-column prop="reason" label="原因" min-width="220" show-overflow-tooltip />

                </el-table>

              </el-card>



              <el-card v-if="createdInboundList.length" shadow="never" class="created-card">

                <template #header>

                  <span>已生成入库单</span>

                </template>

                <el-table :data="createdInboundList" border size="small">

                  <el-table-column prop="receiptNo" label="入库单号" min-width="120" />

                  <el-table-column prop="formalPi" label="正式 PI" width="110" />

                  <el-table-column prop="dispatchOrderNo" label="派工单" min-width="120" />

                  <el-table-column prop="inboundDate" label="入库日期" width="110" />

                  <el-table-column prop="lineCount" label="明细行数" width="90" align="right" />

                  <el-table-column label="操作" width="100">

                    <template #default="{ row }">

                      <el-button link type="primary" @click="openStockInList(row.receiptNo)">去入库单</el-button>

                    </template>

                  </el-table-column>

                </el-table>

                <el-alert

                  v-if="generateInboundErrors.length"

                  class="mt-12"

                  type="warning"

                  show-icon

                  :closable="false"

                  title="部分组生成失败"

                >

                  <ul class="warn-list">

                    <li v-for="(e, i) in generateInboundErrors" :key="i">

                      {{ e.groupKey || `组${e.groupIndex}` }}：{{ e.msg }}

                    </li>

                  </ul>

                </el-alert>

              </el-card>

            </template>

            <el-empty v-else description="请先选择 Excel 并上传预览" />

          </el-tab-pane>



          <el-tab-pane label="出库单" name="outbound">

            <el-alert

              type="info"

              show-icon

              :closable="false"

              class="mb-12"

              title="与入库共用同一份 Excel 预览；按正式 PI + 出货日期 + 派工单号拆成品出库单（与入库组一一对应）。预览已计入本批待入库数量；生成出库前须先完成入库落库。"

            />



            <template v-if="previewData">

              <el-alert

                class="mb-12"

                :type="outboundSummaryAlertType"

                show-icon

                :closable="false"

                :title="outboundSummaryText"

              />



              <div class="toolbar">

                <el-button

                  type="primary"

                  :disabled="!canGenerateOutbound || !hasOutboundGeneratableGroups"

                  :loading="generateOutboundLoading"

                  :title="generateOutboundDisabledTitle || outboundGenerateDisabledHint"

                  @click="onGenerateOutbound"

                >

                  确认生成出库单

                </el-button>

                <span class="hint">仓库 {{ warehouseLabel }} · 类型成品出库 · 不含税</span>

              </div>



              <el-collapse v-model="openOutboundGroups" class="group-collapse">

                <el-collapse-item

                  v-for="g in outboundGroups"

                  :key="g.groupKey"

                  :name="g.groupKey"

                >

                  <template #title>

                    <div class="group-title">

                      <span>{{ g.formalPi }}</span>

                      <span class="sep">|</span>

                      <span>出货 {{ g.shipDate }}</span>

                      <span class="sep">|</span>

                      <span>派工 {{ g.dispatchOrderNo }}</span>

                      <span class="sep">|</span>

                      <span>成功 {{ g.lineCount }} 行</span>

                      <span v-if="g.failedLineCount" class="sep">|</span>

                      <span v-if="g.failedLineCount" class="text-warn">失败 {{ g.failedLineCount }} 行</span>

                      <span class="sep">|</span>

                      <span>出库 {{ formatQty(g.totalOutboundQty) }}</span>

                    </div>

                  </template>



                  <div class="group-meta">

                    <el-form :inline="true" @submit.prevent>

                      <el-form-item label="出库日期">

                        <el-input :model-value="g.shipDate" disabled style="width: 140px" />

                      </el-form-item>

                      <el-form-item label="关联 PI">

                        <el-input :model-value="g.formalPi" disabled style="width: 140px" />

                      </el-form-item>

                      <el-form-item label="客户">

                        <el-input :model-value="g.customerName || '-'" disabled style="width: 200px" />

                      </el-form-item>

                      <el-form-item label="备注">

                        <el-input v-model="g.remark" style="width: 320px" />

                      </el-form-item>

                    </el-form>

                    <ul v-if="g.warnings?.length" class="warn-list">

                      <li v-for="(w, i) in g.warnings" :key="i">{{ w }}</li>

                    </ul>

                  </div>



                  <el-table :data="g.lines" border size="small" class="line-table">

                    <el-table-column prop="excelRowNo" label="行" width="56" />

                    <el-table-column prop="customsNo" label="报关单号" min-width="130" show-overflow-tooltip />

                    <el-table-column prop="kcaa01" label="成品编码" min-width="130" show-overflow-tooltip />

                    <el-table-column prop="customsModel" label="报关型号" min-width="100" show-overflow-tooltip />

                    <el-table-column label="出库数量" width="90" align="right">

                      <template #default="{ row }">{{ formatQty(row.outboundQty) }}</template>

                    </el-table-column>

                    <el-table-column label="申报单价" width="100" align="right">

                      <template #default="{ row }">{{ formatPrice(row.declarePrice) }}</template>

                    </el-table-column>

                    <el-table-column label="成品仓可出" width="100" align="right">

                      <template #default="{ row }">{{ formatQty(row.warehouseActualQty) }}</template>

                    </el-table-column>

                  </el-table>



                  <el-table

                    v-if="g.failedLines?.length"

                    :data="g.failedLines"

                    border

                    size="small"

                    class="line-table fail-inline-table"

                  >

                    <el-table-column prop="excelRowNo" label="行" width="56" />

                    <el-table-column prop="kcaa01" label="成品编码" min-width="130" show-overflow-tooltip />

                    <el-table-column label="出库数量" width="90" align="right">

                      <template #default="{ row }">{{ formatQty(row.outboundQty) }}</template>

                    </el-table-column>

                    <el-table-column prop="reason" label="失败原因" min-width="220" show-overflow-tooltip />

                  </el-table>

                </el-collapse-item>

              </el-collapse>



              <el-card v-if="outboundFailedRows.length" shadow="never" class="fail-card">

                <template #header>

                  <span>出库失败行（{{ outboundFailedRows.length }}）—— 不影响入库成功组</span>

                </template>

                <el-table :data="outboundFailedRows" border size="small">

                  <el-table-column prop="excelRowNo" label="行" width="56" />

                  <el-table-column prop="formalPi" label="正式 PI" width="110" />

                  <el-table-column prop="kcaa01" label="成品编码" min-width="130" />

                  <el-table-column label="出库数量" width="90" align="right">

                    <template #default="{ row }">{{ formatQty(row.outboundQty) }}</template>

                  </el-table-column>

                  <el-table-column prop="reason" label="原因" min-width="220" show-overflow-tooltip />

                </el-table>

              </el-card>



              <el-card v-if="createdOutboundList.length" shadow="never" class="created-card">

                <template #header>

                  <span>已生成出库单</span>

                </template>

                <el-table :data="createdOutboundList" border size="small">

                  <el-table-column prop="outboundNo" label="出库单号" min-width="120" />

                  <el-table-column prop="formalPi" label="正式 PI" width="110" />

                  <el-table-column prop="dispatchOrderNo" label="派工单" min-width="120" />

                  <el-table-column prop="shipDate" label="出货日期" width="110" />

                  <el-table-column prop="lineCount" label="明细行数" width="90" align="right" />

                  <el-table-column label="操作" width="100">

                    <template #default="{ row }">

                      <el-button link type="primary" @click="openStockOutList(row.outboundNo)">去出库单</el-button>

                    </template>

                  </el-table-column>

                </el-table>

                <el-alert

                  v-if="generateOutboundErrors.length"

                  class="mt-12"

                  type="warning"

                  show-icon

                  :closable="false"

                  title="部分组生成失败"

                >

                  <ul class="warn-list">

                    <li v-for="(e, i) in generateOutboundErrors" :key="i">

                      {{ e.groupKey || `组${e.groupIndex}` }}：{{ e.msg }}

                    </li>

                  </ul>

                </el-alert>

              </el-card>

            </template>

            <el-empty v-else description="请先选择 Excel 并上传预览" />

          </el-tab-pane>

        </el-tabs>

      </el-card>

    </template>

  </div>

</template>



<script setup>

import { computed, ref } from 'vue'

import { useRoute, useRouter } from 'vue-router'

import axios from 'axios'

import * as XLSX from 'xlsx'

import { ElMessage, ElMessageBox } from 'element-plus'

import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'

import { formatErpQtyDisplay, formatErpPriceDisplay } from '@/utils/erpNumberDisplay'



defineOptions({ name: 'supply-chain-daily-customs-declaration' })



const MENU_PATH = 'supply-chain/daily/customs-declaration'

const STOCK_IN_MENU = 'inventory/daily/stock-in'

const STOCK_OUT_MENU = 'inventory/daily/stock-out'

const HEADER_ALIASES = {

  报关单号: 'customsNo',

  出货日期: 'shipDate',

  PI号: 'excelPi',

  PI: 'excelPi',

  厂款号: 'factoryStyleNo',

  客款号: 'customerStyleNo',

  颜色: 'color',

  申报数量: 'declareQty',

  申报单价: 'declarePrice',

  报关单型号: 'customsModel',

  商品名称: 'productName',

}



const route = useRoute()

const router = useRouter()

const pageTitle = computed(() => String(route.meta?.title || '海关单'))

const permissionModel = computed(() => getPermissionModelFromStorage())

const canView = computed(() => hasPageAction(permissionModel.value, MENU_PATH, 'view'))

const canAddCustoms = computed(() => hasPageAction(permissionModel.value, MENU_PATH, 'add'))

const canStockInAdd = computed(() => hasPageAction(permissionModel.value, STOCK_IN_MENU, 'add'))

const canStockOutAdd = computed(() => hasPageAction(permissionModel.value, STOCK_OUT_MENU, 'add'))

const canGenerateInbound = computed(() => canAddCustoms.value && canStockInAdd.value)

const canGenerateOutbound = computed(() => canAddCustoms.value && canStockOutAdd.value)

const generateInboundDisabledTitle = computed(() => {

  if (!canAddCustoms.value) return '没有海关单「新增」权限'

  if (!canStockInAdd.value) return '没有入库单「新增」权限'

  return ''

})

const generateOutboundDisabledTitle = computed(() => {

  if (!canAddCustoms.value) return '没有海关单「新增」权限'

  if (!canStockOutAdd.value) return '没有出库单「新增」权限'

  return ''

})



const mainTab = ref('inbound')

const fileInputRef = ref(null)

const pickedFile = ref(null)

const pickedLabel = ref('')

const previewLoading = ref(false)

const generateInboundLoading = ref(false)

const generateOutboundLoading = ref(false)

const previewData = ref(null)

const previewGroups = ref([])

const outboundGroups = ref([])

const failedRows = ref([])

const outboundFailedRows = ref([])

const openInboundGroups = ref([])

const openOutboundGroups = ref([])

const createdInboundList = ref([])

const createdOutboundList = ref([])

const generateInboundErrors = ref([])

const generateOutboundErrors = ref([])



const workshopLabel = computed(() => {

  const w = previewData.value?.workshop

  return w ? `${w.name}(${w.code})` : '包装部'

})

const warehouseLabel = computed(() => {

  const w = previewData.value?.warehouse

  return w ? `${w.name}(${w.code})` : '成品仓'

})

const inboundSummaryText = computed(() => {

  const s = previewData.value?.summary

  if (!s) return ''

  return `入库：共 ${s.totalRows} 行，成功 ${s.successRows}，失败 ${s.failedRows}，将生成 ${s.groupCount} 张入库单`

})

const outboundSummaryText = computed(() => {

  const s = previewData.value?.summary

  if (!s) return ''

  const generatable = s.outboundGeneratableGroupCount ?? outboundGeneratableGroups.value.length

  return `出库：共 ${s.totalRows} 行，成功 ${s.outboundSuccessRows ?? 0}，失败 ${s.outboundFailedRows ?? 0}，将生成 ${generatable} 张出库单（共 ${s.outboundGroupCount ?? 0} 组）`

})

const outboundSummaryAlertType = computed(() => {

  const failed = previewData.value?.summary?.outboundFailedRows ?? 0

  return failed > 0 ? 'warning' : 'success'

})

const outboundGeneratableGroups = computed(() =>

  outboundGroups.value.filter((g) => (g.lineCount ?? g.lines?.length ?? 0) > 0),

)

const hasOutboundGeneratableGroups = computed(() => outboundGeneratableGroups.value.length > 0)

const outboundGenerateDisabledHint = computed(() => {

  if (!outboundGroups.value.length) return '请先上传 Excel 并预览'

  if (!hasOutboundGeneratableGroups.value) return '没有可生成的出库组（全部行校验失败）'

  return ''

})



function formatQty(v) {

  return formatErpQtyDisplay(v)

}



function formatPrice(v) {

  return formatErpPriceDisplay(v)

}



function triggerPickFile() {

  fileInputRef.value?.click?.()

}



function onFileChange(ev) {

  const file = ev?.target?.files?.[0]

  pickedFile.value = file || null

  pickedLabel.value = file ? file.name : ''

  if (ev?.target) ev.target.value = ''

}



function onClearPreview() {

  previewData.value = null

  previewGroups.value = []

  outboundGroups.value = []

  failedRows.value = []

  outboundFailedRows.value = []

  openInboundGroups.value = []

  openOutboundGroups.value = []

  createdInboundList.value = []

  createdOutboundList.value = []

  generateInboundErrors.value = []

  generateOutboundErrors.value = []

}



function formatYmd(d) {

  const y = d.getFullYear()

  const m = String(d.getMonth() + 1).padStart(2, '0')

  const day = String(d.getDate()).padStart(2, '0')

  return `${y}-${m}-${day}`

}



function excelSerialToYmd(n) {

  if (!Number.isFinite(n) || n < 1 || n > 80000) return null

  const parsed = XLSX.SSF?.parse_date_code?.(n)

  if (parsed && parsed.y && parsed.m && parsed.d) {

    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`

  }

  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000

  return formatYmd(new Date(ms))

}



function cellText(cell) {

  if (cell == null || cell === '') return ''

  if (cell instanceof Date) return formatYmd(cell)

  if (typeof cell === 'object') {

    if (cell.text != null) return String(cell.text).trim()

    if (cell.result != null) return cellText(cell.result)

  }

  return String(cell).trim()

}



function shipDateCellText(cell) {

  if (cell == null || cell === '') return ''

  if (cell instanceof Date) return formatYmd(cell)

  if (typeof cell === 'number') {

    const asDate = excelSerialToYmd(cell)

    if (asDate) return asDate

  }

  return cellText(cell)

}



function normalizeHeader(h) {

  const t = String(h ?? '').trim().replace(/\s+/g, '')

  return HEADER_ALIASES[t] || HEADER_ALIASES[String(h ?? '').trim()] || ''

}



async function parseExcelFile(file) {

  const name = String(file?.name ?? '')

  if (!/\.(xlsx|xls)$/i.test(name)) {

    throw new Error('请上传 .xls 或 .xlsx 格式的 Excel 文件')

  }

  const buf = await file.arrayBuffer()

  let wb

  try {

    wb = XLSX.read(buf, { type: 'array', cellDates: true })

  } catch (e) {

    throw new Error(`无法读取 Excel：${e?.message || '文件损坏或格式不支持'}`)

  }

  const sheetName = wb.SheetNames?.[0]

  if (!sheetName) {

    throw new Error('Excel 无工作表（请确认文件未损坏；也可另存为 .xlsx 再试）')

  }

  const ws = wb.Sheets[sheetName]

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })

  if (!Array.isArray(aoa) || !aoa.length) throw new Error('Excel 无工作表')



  const headerRow = aoa[0] || []

  const colMap = []

  for (let i = 0; i < headerRow.length; i += 1) {

    const key = normalizeHeader(cellText(headerRow[i]))

    if (key) colMap.push({ colIndex: i, key })

  }

  const need = ['customsNo', 'shipDate', 'excelPi', 'factoryStyleNo', 'color', 'declareQty']

  const missing = need.filter((k) => !colMap.some((c) => c.key === k))

  if (missing.length) {

    throw new Error(`表头缺少列：${missing.join('、')}（请对齐海关单模版）`)

  }



  const rows = []

  for (let r = 1; r < aoa.length; r += 1) {

    const row = aoa[r] || []

    const obj = { excelRowNo: r + 1 }

    for (const { colIndex, key } of colMap) {

      if (key === 'shipDate') {

        obj[key] = shipDateCellText(row[colIndex])

      } else if (key === 'declareQty' || key === 'declarePrice') {

        const raw = row[colIndex]

        const n = Number(typeof raw === 'object' && raw?.result != null ? raw.result : raw)

        obj[key] = Number.isFinite(n) ? n : cellText(raw)

      } else {

        obj[key] = cellText(row[colIndex])

      }

    }

    if (!obj.excelPi && !obj.factoryStyleNo && !obj.declareQty) continue

    rows.push(obj)

  }

  if (!rows.length) throw new Error('没有有效明细行')

  return rows

}



function applyPreviewData(data) {

  previewData.value = data

  previewGroups.value = (data?.groups ?? []).map((g) => ({ ...g }))

  outboundGroups.value = (data?.outboundGroups ?? []).map((g) => ({ ...g }))

  failedRows.value = data?.failedRows ?? []

  outboundFailedRows.value = data?.outboundFailedRows ?? []

  openInboundGroups.value = previewGroups.value.slice(0, 5).map((g) => g.groupKey)

  openOutboundGroups.value = outboundGroups.value.slice(0, 5).map((g) => g.groupKey)

}



/** 静默刷新预览（入库生成后刷新出库组；保留已生成入库/出库列表） */
async function refreshPreview({ silent = false } = {}) {

  if (!pickedFile.value) return false

  const rows = await parseExcelFile(pickedFile.value)

  const { data } = await axios.post('/api/customs-declaration/preview', { rows })

  if (data?.code !== 200) {

    if (!silent) ElMessage.error(data?.msg || '预览失败')

    return false

  }

  applyPreviewData(data.data)

  return true

}



async function onPreview() {

  if (!pickedFile.value) {

    ElMessage.warning('请先选择 Excel 文件')

    return

  }

  previewLoading.value = true

  createdInboundList.value = []

  createdOutboundList.value = []

  generateInboundErrors.value = []

  generateOutboundErrors.value = []

  try {

    const ok = await refreshPreview({ silent: true })

    if (!ok) {

      ElMessage.error('预览失败')

      return

    }

    ElMessage.success('预览完成')

  } catch (err) {

    console.error(err)

    ElMessage.error(err?.response?.data?.msg || err?.message || '预览失败')

  } finally {

    previewLoading.value = false

  }

}



function onGroupInboundDateChange(g) {

  const date = String(g.inboundDate || '').slice(0, 10)

  g.groupKey = `${g.formalPi}|${date}|${g.dispatchOrderNo}`

  for (const line of g.lines || []) {

    line.inboundDate = date

  }

}



async function onGenerateInbound() {

  if (!canGenerateInbound.value) {

    ElMessage.warning(generateInboundDisabledTitle.value || '无权限生成')

    return

  }

  if (!previewGroups.value.length) {

    ElMessage.warning('没有可生成的入库组')

    return

  }

  try {

    await ElMessageBox.confirm(

      `将生成 ${previewGroups.value.length} 张生产入库单，保存后自动审核进库存。是否继续？`,

      '确认生成',

      { type: 'warning', confirmButtonText: '确认生成', cancelButtonText: '取消' },

    )

  } catch {

    return

  }

  generateInboundLoading.value = true

  try {

    const payload = {

      groups: previewGroups.value.map((g) => ({

        groupKey: g.groupKey,

        formalPi: g.formalPi,

        inboundDate: String(g.inboundDate || '').slice(0, 10),

        dispatchOrderNo: g.dispatchOrderNo,

        dispatchSystemcode: g.dispatchSystemcode,

        remark: g.remark,

        customsNos: g.customsNos,

        lines: (g.lines || []).map((l) => ({

          excelRowNo: l.excelRowNo,

          customsNo: l.customsNo,

          kcaa01: l.kcaa01,

          declareQty: l.declareQty,

          inboundQty: l.inboundQty,

          productName: l.productName,

          kcao02: l.kcao02 || l.scak02,

          scak02: l.scak02 || l.kcao02,

        })),

      })),

    }

    const { data } = await axios.post('/api/customs-declaration/generate', payload)

    if (data?.code !== 200) {

      ElMessage.error(data?.msg || '生成失败')

      return

    }

    createdInboundList.value = data.data?.created ?? []

    generateInboundErrors.value = data.data?.errors ?? []

    const n = createdInboundList.value.length

    if (n) {

      ElMessage.success(`已生成 ${n} 张入库单`)

      try {

        const refreshed = await refreshPreview({ silent: true })

        if (refreshed) ElMessage.info('已刷新出库预览（库存与入库组已对齐）')

      } catch (refreshErr) {

        console.error(refreshErr)

      }

    } else ElMessage.warning(data.msg || '未生成任何入库单')

  } catch (err) {

    console.error(err)

    ElMessage.error(err?.response?.data?.msg || err?.message || '生成失败')

  } finally {

    generateInboundLoading.value = false

  }

}



async function onGenerateOutbound() {

  if (!canGenerateOutbound.value) {

    ElMessage.warning(generateOutboundDisabledTitle.value || '无权限生成')

    return

  }

  if (!hasOutboundGeneratableGroups.value) {

    ElMessage.warning(outboundGenerateDisabledHint.value || '没有可生成的出库组')

    return

  }

  const groupsToGenerate = outboundGeneratableGroups.value

  try {

    await ElMessageBox.confirm(

      `将生成 ${groupsToGenerate.length} 张成品出库单，保存后自动审核。是否继续？`,

      '确认生成',

      { type: 'warning', confirmButtonText: '确认生成', cancelButtonText: '取消' },

    )

  } catch {

    return

  }

  generateOutboundLoading.value = true

  try {

    const payload = {

      outboundGroups: groupsToGenerate.map((g) => ({

        groupKey: g.groupKey,

        formalPi: g.formalPi,

        shipDate: g.shipDate,

        dispatchOrderNo: g.dispatchOrderNo,

        dispatchSystemcode: g.dispatchSystemcode,

        remark: g.remark,

        customsNos: g.customsNos,

        poNo: g.poNo,

        customerCode: g.customerCode,

        customerName: g.customerName,

        lines: (g.lines || []).map((l) => ({

          excelRowNo: l.excelRowNo,

          customsNo: l.customsNo,

          kcaa01: l.kcaa01,

          outboundQty: l.outboundQty,

          inboundQty: l.inboundQty,

          declarePrice: l.declarePrice,

          customsModel: l.customsModel,

          productName: l.productName,

          salesLineKey: l.salesLineKey,

        })),

      })),

    }

    const { data } = await axios.post('/api/customs-declaration/generate-outbound', payload)

    if (data?.code !== 200) {

      ElMessage.error(data?.msg || '生成失败')

      return

    }

    createdOutboundList.value = data.data?.created ?? []

    generateOutboundErrors.value = data.data?.errors ?? []

    const n = createdOutboundList.value.length

    if (n) ElMessage.success(`已生成 ${n} 张出库单`)

    else {
      const firstErr = generateOutboundErrors.value?.[0]?.msg
      ElMessage.warning(firstErr ? `未生成任何出库单：${firstErr}` : (data.msg || '未生成任何出库单'))
    }

  } catch (err) {

    console.error(err)

    ElMessage.error(err?.response?.data?.msg || err?.message || '生成失败')

  } finally {

    generateOutboundLoading.value = false

  }

}



function openStockInList(receiptNo) {

  const q = receiptNo ? `?keyword=${encodeURIComponent(receiptNo)}` : ''

  const url = router.resolve(`/inventory/daily/stock-in${q}`).href

  window.open(url, '_blank')

}



function openStockOutList(outboundNo) {

  const q = outboundNo ? `?keyword=${encodeURIComponent(outboundNo)}` : ''

  const url = router.resolve(`/inventory/daily/stock-out${q}`).href

  window.open(url, '_blank')

}

</script>



<style scoped>

.customs-declaration-page .page-title {

  font-size: 16px;

  font-weight: 600;

}

.mb-12 {

  margin-bottom: 12px;

}

.mt-12 {

  margin-top: 12px;

}

.ml-8 {

  margin-left: 8px;

}

.upload-row {

  display: flex;

  flex-wrap: wrap;

  align-items: center;

  gap: 10px;

  margin-bottom: 16px;

}

.hidden-file {

  display: none;

}

.picked-name {

  color: #303133;

}

.picked-placeholder {

  color: #909399;

}

.toolbar {

  display: flex;

  flex-wrap: wrap;

  align-items: center;

  gap: 12px;

  margin-bottom: 12px;

}

.hint {

  color: #909399;

  font-size: 13px;

}

.group-title {

  display: flex;

  flex-wrap: wrap;

  align-items: center;

  gap: 4px;

  font-weight: 500;

}

.group-title .sep {

  color: #c0c4cc;

  margin: 0 4px;

}

.group-meta {

  margin-bottom: 8px;

}

.warn-list {

  margin: 0 0 8px;

  padding-left: 18px;

  color: #e6a23c;

}

.text-warn {

  color: #e6a23c;

  font-weight: 600;

}

.fail-card,

.created-card {

  margin-top: 16px;

}

.line-table {

  width: 100%;

}

.fail-inline-table {

  margin-top: 8px;

}

</style>


