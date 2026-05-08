<template>
  <div class="erp-module-page">
    <!--
      v1.1.8：BOM 主档列表（bom_000），严格服务端分页；合并关键词搜索（kcaa01/kcaa02 全模糊 OR）。
      性能约定：关键词仅在后端「满 3 字」时生效（参数化 LIKE），降低大表扫描风险。
    -->
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">
        数据来自物理表 <code>bom_000</code>（可通过环境变量 <code>INV_BOM_MASTER_TABLE</code> 覆盖表名）。默认每页 10 条，仅加载当前页数据。
      </p>

      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="输入编码或名称关键词（支持全模糊）"
          clearable
          class="bom-keyword-input"
          @keyup.enter="onSearch"
        />
        <el-select
          v-model="searchQuery.bom_cut"
          placeholder="裁片过滤"
          style="width: 200px"
          @change="onSearch"
        >
          <el-option label="不包含裁片编码（排除 CUT- 开头）" :value="0" />
          <el-option label="仅裁片编码（仅 CUT- 开头）" :value="1" />
        </el-select>
        <div class="audit-switch">
          <span class="switch-label">显示未审核</span>
          <el-switch v-model="showUnAudited" @change="onSearch" />
        </div>
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>

      <el-alert
        v-if="hintShort"
        type="info"
        show-icon
        :closable="false"
        class="hint-alert"
        title="提示：关键词不足 3 个字时不会作为筛选条件（避免大表慢查询）。"
      />

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />

      <el-alert
        v-if="showUnAudited"
        title="当前显示：未审核（pass=0）的 BOM 行"
        type="warning"
        show-icon
        class="audit-view-alert"
      />

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <el-table
            :data="tableList"
            border
            stripe
            style="width: 100%"
            row-key="rowKey"
            :empty-text="loading ? '加载中…' : '暂无数据'"
          >
            <el-table-column prop="code" label="编码" min-width="120" show-overflow-tooltip />
            <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
            <el-table-column prop="spec" label="规格" min-width="120" show-overflow-tooltip />
            <el-table-column prop="unit" label="单位" width="72" show-overflow-tooltip />
            <el-table-column label="成本用量,成品用量" min-width="210">
              <template #default="{ row }">
                <div v-if="row.calcStatus === 'not_needed'" class="usage-sum-muted"></div>
                <div v-else class="usage-sum-cell">
                  <div>成本：{{ row.sumCost04 ?? '0.0000' }}，{{ row.sumCost06 ?? '0.0000' }}</div>
                  <div>成品：{{ row.sumCons04 ?? '0.0000' }}，{{ row.sumCons06 ?? '0.0000' }}</div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="是否运算用量" width="110">
              <template #default="{ row }">
                <el-tag v-if="row.calcStatus === 'done'" type="success" size="small">已运算</el-tag>
                <el-tag v-else-if="row.calcStatus === 'not_done'" type="danger" size="small">未运算</el-tag>
                <el-tag v-else type="info" size="small">不需运算</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="addtime" label="输入时间" width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ formatDateTime(row.addtime) }}</template>
            </el-table-column>
            <el-table-column prop="edittime" label="修改时间" width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ formatDateTime(row.edittime) }}</template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
            <el-table-column label="采购" width="72" align="center">
              <template #default="{ row }">{{ ynText(row.isPurchase) }}</template>
            </el-table-column>
            <el-table-column label="外协" width="72" align="center">
              <template #default="{ row }">{{ ynText(row.isSubcontract) }}</template>
            </el-table-column>
            <el-table-column label="自产" width="72" align="center">
              <template #default="{ row }">{{ ynText(row.isSelfProduced) }}</template>
            </el-table-column>
            <el-table-column label="审核" width="88">
              <template #default="{ row }">
                <el-tag v-if="rowIsAudited(row)" type="success" size="small">已审</el-tag>
                <el-tag v-else type="info" size="small">未审</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="260" fixed="right">
              <template #default="{ row }">
                <el-button v-permission="'view'" size="small" @click="openDetail(row)">查看详情</el-button>
                <el-button v-permission="'view'" size="small" type="primary" plain @click="copyRow(row)">复制</el-button>
                <el-button v-permission="'edit'" size="small" :disabled="rowIsAudited(row)" @click="onEdit(row)">
                  编辑
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-row">
            <el-pagination
              background
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              :current-page="page"
              :page-size="pageSize"
              :page-sizes="[10, 20, 50, 100]"
              @size-change="onPageSizeChange"
              @current-change="onPageChange"
            />
          </div>
        </template>
      </el-skeleton>
    </el-card>

    <el-dialog
      v-model="detailVisible"
      :title="detailDialogTitle"
      width="85%"
      destroy-on-close
      class="bom-detail-dialog"
      @closed="onDetailClosed"
    >
      <el-skeleton :loading="detailLoading" animated :rows="10">
        <template #default>
          <el-alert v-if="detailError" :title="detailError" type="error" show-icon class="bom-detail-alert" />
          <template v-else-if="bomBasic">
            <el-tabs v-model="detailActiveTab">
              <el-tab-pane label="基础资料" name="basic">
                <el-form class="bom-detail-form" label-position="right" label-width="112px" size="default">
                  <!-- Row1 核心：编码 + 名称类（名称 / 英文名称 / 开票名称）四列栅格 -->
                  <el-row :gutter="16">
                    <el-col :xs="24" :sm="12" :md="6">
                      <el-form-item label="编码">
                        <el-input :model-value="dVal(bomBasic.kcaa01)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="6">
                      <el-form-item label="名称">
                        <el-input :model-value="dVal(bomBasic.kcaa02)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="6">
                      <el-form-item label="英文名称">
                        <el-input :model-value="dVal(bomBasic.kcaa02_en)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="6">
                      <el-form-item label="开票名称">
                        <el-input :model-value="dVal(bomBasic.kpname)" readonly />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <!-- Row2 规格 -->
                  <el-row :gutter="16">
                    <el-col :xs="24" :sm="12" :md="8">
                      <el-form-item label="规格">
                        <el-input :model-value="dVal(bomBasic.kcaa03)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="8">
                      <el-form-item label="颜色">
                        <el-input :model-value="dVal(bomBasic.kcaa11)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="8">
                      <el-form-item label="分类">
                        <el-input :model-value="dVal(bomBasic.categoryName)" readonly />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <!-- Row3 款号（四项一行：大屏四列） -->
                  <el-row :gutter="16">
                    <el-col :xs="24" :sm="12" :md="6">
                      <el-form-item label="组别">
                        <el-input :model-value="dVal(bomBasic.kcaa10)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="6">
                      <el-form-item label="产地">
                        <el-input :model-value="dVal(bomBasic.location)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="6">
                      <el-form-item label="客户款号">
                        <el-input :model-value="dVal(bomBasic.kcaa06)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="6">
                      <el-form-item label="工厂款号">
                        <el-input :model-value="dVal(bomBasic.kcaa09)" readonly />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-row :gutter="16">
                    <el-col :xs="24" :sm="12" :md="12">
                      <el-form-item label="生产车间">
                        <el-input :model-value="dVal(bomBasic.workshop_display)" readonly />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <!-- 单位与转换 -->
                  <div class="bom-section-title">单位与转换</div>
                  <el-row :gutter="16">
                    <el-col :xs="24" :sm="12" :md="8">
                      <el-form-item label="使用单位">
                        <el-input :model-value="dVal(bomBasic.kcaa04)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="8">
                      <el-form-item label="采购单位">
                        <el-input :model-value="dVal(bomBasic.kcaa25)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="8">
                      <el-form-item label="报价单位">
                        <el-input :model-value="dVal(bomBasic.kcaa29)" readonly />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <div class="bom-sub-block-title">采购转换</div>
                  <el-row :gutter="16">
                    <el-col :xs="24" :sm="12" :md="12">
                      <el-form-item label="转换方向">
                        <el-select
                          :model-value="purchaseDirModel"
                          disabled
                          placeholder="—"
                          style="width: 100%"
                          :clearable="false"
                        >
                          <el-option
                            v-for="opt in purchaseDirOptions"
                            :key="opt.value"
                            :label="opt.label"
                            :value="opt.value"
                          />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="12">
                      <el-form-item label="转换率">
                        <el-input :model-value="dVal(ucPurchaseRate)" readonly />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <div class="bom-sub-block-title">报价转换</div>
                  <el-row :gutter="16">
                    <el-col :xs="24" :sm="12" :md="12">
                      <el-form-item label="转换方向">
                        <el-select
                          :model-value="quoteDirModel"
                          disabled
                          placeholder="—"
                          style="width: 100%"
                          :clearable="false"
                        >
                          <el-option
                            v-for="opt in quoteDirOptions"
                            :key="opt.value"
                            :label="opt.label"
                            :value="opt.value"
                          />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="12">
                      <el-form-item label="转换率">
                        <el-input :model-value="dVal(ucQuoteRate)" readonly />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <!-- 财务 -->
                  <el-row :gutter="16">
                    <el-col :xs="24" :sm="12" :md="8">
                      <el-form-item label="采购价格">
                        <el-input :model-value="dVal(bomBasic.cost_price)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="8">
                      <el-form-item label="币别">
                        <el-input :model-value="dVal(bomBasic.kcaa35)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="8">
                      <el-form-item label="小数点配置">
                        <el-input :model-value="dVal(bomBasic.decimal)" readonly />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-row :gutter="16">
                    <el-col :xs="24" :sm="12" :md="8">
                      <el-form-item label="BOM 价格">
                        <el-input :model-value="dVal(bomBasic.sale_price)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="8">
                      <el-form-item label="BOM 币别">
                        <el-input :model-value="dVal(bomBasic.kcaa34_display)" readonly />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <!-- 损耗 -->
                  <el-row :gutter="16">
                    <el-col :xs="24" :sm="12" :md="12">
                      <el-form-item label="报价损耗">
                        <el-input :model-value="dVal(bomBasic.kcaa32)" readonly />
                      </el-form-item>
                    </el-col>
                    <el-col :xs="24" :sm="12" :md="12">
                      <el-form-item label="物价损耗">
                        <el-input :model-value="dVal(bomBasic.kcaa33)" readonly />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <!-- 工作方式 -->
                  <el-row :gutter="16">
                    <el-col :span="24">
                      <el-form-item label="工作方式">
                        <div class="bom-detail-check-row">
                          <el-checkbox :model-value="bomBasic.kcaa12_checked" disabled>采购</el-checkbox>
                          <el-checkbox :model-value="bomBasic.kcaa13_checked" disabled>外协</el-checkbox>
                          <el-checkbox :model-value="bomBasic.kcaa14_checked" disabled>自产</el-checkbox>
                          <el-checkbox :model-value="bomBasic.customer_supply_checked" disabled>客供</el-checkbox>
                        </div>
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <!-- 备注 -->
                  <el-row :gutter="16">
                    <el-col :span="24">
                      <el-form-item label="备注">
                        <el-input :model-value="dVal(bomBasic.remark)" type="textarea" :rows="3" readonly />
                      </el-form-item>
                    </el-col>
                  </el-row>
                </el-form>
              </el-tab-pane>
              <el-tab-pane label="配件明细" name="parts" :disabled="!bomBasic">
                <el-alert
                  v-if="!bomSystemcode && bomBasic"
                  type="warning"
                  show-icon
                  :closable="false"
                  class="bom-parts-alert"
                  title="主档缺少 systemcode，无法加载或保存配件明细。"
                />
                <div v-else class="bom-parts-toolbar">
                  <el-button
                    type="primary"
                    :disabled="partsReadOnly || !bomSystemcode"
                    @click="materialSelectorVisible = true"
                  >
                    添加配件
                  </el-button>
                  <el-button :disabled="partsReadOnly || !bomSystemcode || partsLoading" @click="loadBomParts">
                    刷新
                  </el-button>
                  <el-button
                    type="success"
                    :disabled="partsReadOnly || !bomSystemcode || partsLoading"
                    @click="saveBomParts"
                  >
                    保存配件明细
                  </el-button>
                </div>
                <el-alert v-if="partsError" :title="partsError" type="error" show-icon class="bom-parts-alert" />
                <div class="bom-parts-table-wrap">
                  <el-table
                    v-loading="partsLoading"
                    :data="partsList"
                    border
                    stripe
                    size="small"
                    class="bom-parts-table"
                    :empty-text="partsLoading ? '加载中…' : '暂无配件'"
                    :row-key="partsRowKey"
                    max-height="calc(100vh - 320px)"
                  >
                    <el-table-column
                      type="index"
                      label="序号"
                      width="56"
                      align="center"
                      fixed="left"
                      :index="partsRowIndex"
                    />
                    <el-table-column label="操作" width="88" align="center" fixed="left">
                      <template #default="{ row }">
                        <el-button
                          type="primary"
                          size="small"
                          class="bom-part-view-action-btn"
                          :disabled="!String(row.kcaa01 ?? '').trim()"
                          @click="openLinkedBomDetailFromPart(row)"
                        >
                          查看
                        </el-button>
                      </template>
                    </el-table-column>
                    <el-table-column prop="kcaa01" label="配件编码" min-width="120" fixed="left" show-overflow-tooltip />
                    <el-table-column prop="kcaa02" label="名称" min-width="120" show-overflow-tooltip />
                    <el-table-column prop="kcaa03" label="规格" min-width="100" show-overflow-tooltip />
                    <el-table-column prop="kcaa04" label="单位" width="72" show-overflow-tooltip />
                    <el-table-column prop="kcaa11" label="颜色" width="88" show-overflow-tooltip />
                    <el-table-column label="单位用量" width="120">
                      <template #default="{ row }">
                        <el-input-number
                          v-model="row.kcac04"
                          :disabled="partsReadOnly"
                          :min="0"
                          :precision="4"
                          :step="0.0001"
                          controls-position="right"
                          class="bom-parts-num"
                        />
                      </template>
                    </el-table-column>
                    <el-table-column label="损耗率(%)" width="120">
                      <template #default="{ row }">
                        <el-input-number
                          :model-value="lossPctDisplay(row)"
                          :disabled="partsReadOnly"
                          :min="0"
                          :precision="2"
                          :step="0.1"
                          controls-position="right"
                          class="bom-parts-num"
                          @update:model-value="(v) => onLossPctChange(row, v)"
                        />
                      </template>
                    </el-table-column>
                    <el-table-column label="单价" width="120">
                      <template #default="{ row }">
                        <el-input-number
                          v-model="row.cost_price"
                          :disabled="partsReadOnly"
                          :min="0"
                          :precision="4"
                          :step="0.0001"
                          controls-position="right"
                          class="bom-parts-num"
                        />
                      </template>
                    </el-table-column>
                    <el-table-column label="用量合计" width="110" align="right">
                      <template #default="{ row }">{{ formatQty(partUsageSum(row)) }}</template>
                    </el-table-column>
                    <el-table-column label="成本合计" width="110" align="right">
                      <template #default="{ row }">{{ formatMoney(partCostSum(row)) }}</template>
                    </el-table-column>
                    <el-table-column label="备注" min-width="140">
                      <template #default="{ row }">
                        <el-input
                          v-model="row.remark"
                          :disabled="partsReadOnly"
                          maxlength="500"
                          show-word-limit
                        />
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
                <div class="bom-parts-sum-row">
                  <span>实际用量总和：<strong>{{ formatQty(partsSumActualUsage) }}</strong></span>
                  <span class="bom-parts-sum-gap">总成本：<strong>{{ formatMoney(partsSumCost) }}</strong></span>
                </div>
                <MaterialSelector v-model="materialSelectorVisible" @picked="onMaterialPicked" />
              </el-tab-pane>
            </el-tabs>
          </template>
        </template>
      </el-skeleton>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import MaterialSelector from '../../supply-chain/daily/purchase-quote/MaterialSelector.vue'

/**
 * 默认用于「存货管理 / BOM资料查询」路由；
 * 库存菜单「inventory/basic/bom-data」以子组件方式嵌入时可传入与侧栏一致的标题。
 */
const props = defineProps({
  embeddedTitle: { type: String, default: '' },
})

const pageTitle = computed(() => {
  const t = String(props.embeddedTitle ?? '').trim()
  return t || 'BOM资料查询'
})

const loading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const total = ref(0)
const page = ref(1)
/** 默认每页 10 条：配合“按最近修改/新增优先”更符合使用习惯 */
const pageSize = ref(10)

/** 合并搜索：同时模糊匹配物料编码（kcaa01）与名称（kcaa02） */
const keyword = ref('')
/** 裁片过滤：0 排除 CUT- 开头料号；1 仅查询 CUT- 开头裁片主档（后端强制前缀） */
const searchQuery = reactive({
  bom_cut: 0,
})
const showUnAudited = ref(false)

const detailVisible = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
/** @type {import('vue').Ref<string>} */
const detailTitleCode = ref('')
const bomBasic = ref(null)
/** 列表打开详情时的原始行（审核态等） */
const detailListRow = ref(null)
/** 预留后续 Tab（清单/用量等） */
const detailActiveTab = ref('basic')

/** 配件明细 Tab */
const partsList = ref([])
const partsLoading = ref(false)
const partsError = ref('')
const partsLoadedToken = ref('')
const materialSelectorVisible = ref(false)
/** 防止重复请求：systemcode + 时间戳在关闭弹窗时清空 */
const partsLoadGeneration = ref(0)

/** 单位转换方向选项（与后端 po_to_use / qt_to_use 等一致） */
const purchaseDirOptions = [
  { value: 'po_to_use', label: '采购→使用' },
  { value: 'use_to_po', label: '使用→采购' },
]
const quoteDirOptions = [
  { value: 'qt_to_use', label: '报价→使用' },
  { value: 'use_to_qt', label: '使用→报价' },
]

const purchaseDirModel = computed(() => {
  const d = String(bomBasic.value?.unit_conversion?.purchase_direction ?? '').trim()
  return d || undefined
})
const quoteDirModel = computed(() => {
  const d = String(bomBasic.value?.unit_conversion?.quote_direction ?? '').trim()
  return d || undefined
})
const ucPurchaseRate = computed(() => bomBasic.value?.unit_conversion?.purchase_rate ?? '')
const ucQuoteRate = computed(() => bomBasic.value?.unit_conversion?.quote_rate ?? '')

const detailDialogTitle = computed(() => {
  const c = String(detailTitleCode.value ?? '').trim()
  return c ? `BOM 详情 - ${c}` : 'BOM 详情'
})

/** 主档 systemcode 为空则无法加载配件表 */
const bomSystemcode = computed(() => String(bomBasic.value?.systemcode ?? '').trim())

/** 已审核主档：配件只读（与列表「编辑」禁用一致） */
const partsReadOnly = computed(() => rowIsAudited(detailListRow.value))

function partsRowKey(row) {
  if (row?.id != null && Number(row.id) > 0) return `id-${row.id}`
  return String(row?._localKey ?? '')
}

/** 序号列：从 1 连续递增 */
function partsRowIndex(i) {
  return i + 1
}

/** 用量合计 = kcac04 * (1 + kcac05)；损耗率为小数（5% → 0.05） */
function partUsageSum(row) {
  const q = Number(row?.kcac04)
  const loss = Number(row?.kcac05)
  const qq = Number.isFinite(q) ? q : 0
  const ll = Number.isFinite(loss) ? loss : 0
  return qq * (1 + ll)
}

/** 成本合计 = 用量合计 * 单价 */
function partCostSum(row) {
  const p = Number(row?.cost_price)
  const price = Number.isFinite(p) ? p : 0
  return partUsageSum(row) * price
}

/** 底部汇总：未标记删除的行 */
const partsSumActualUsage = computed(() => {
  let s = 0
  for (const row of partsList.value || []) {
    s += partUsageSum(row)
  }
  return s
})

const partsSumCost = computed(() => {
  let s = 0
  for (const row of partsList.value || []) {
    s += partCostSum(row)
  }
  return s
})

function formatQty(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '0.0000'
  return x.toFixed(4)
}

function formatMoney(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '0.00'
  return x.toFixed(2)
}

/** 损耗率编辑：界面百分比 vs 库内小数 */
function lossPctDisplay(row) {
  const v = Number(row?.kcac05)
  const d = Number.isFinite(v) ? v : 0
  return d * 100
}

function onLossPctChange(row, pctVal) {
  const p = Number(pctVal)
  row.kcac05 = Number.isFinite(p) ? p / 100 : 0
}

function genLocalKey() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 选材回调：kcaa05 为选材组件内的「单位」别名，映射到配件表 kcaa04 */
function onMaterialPicked(payload) {
  const kcaa01 = String(payload?.kcaa01 ?? '').trim()
  if (!kcaa01) return
  partsList.value.push({
    _localKey: genLocalKey(),
    id: null,
    kcaa01,
    kcaa02: String(payload?.kcaa02 ?? '').trim(),
    kcaa03: String(payload?.kcaa03 ?? '').trim(),
    kcaa04: String(payload?.kcaa05 ?? payload?.kcaa04 ?? '').trim(),
    kcaa11: String(payload?.kcaa11 ?? '').trim(),
    kcac04: 1,
    kcac05: 0,
    cost_price: 0,
    remark: '',
  })
}

async function loadBomParts() {
  const sc = bomSystemcode.value
  if (!sc) {
    partsError.value = '主档缺少 systemcode，无法加载配件明细（请确认库内 bom_000.systemcode）。'
    partsList.value = []
    return
  }
  const token = `${sc}@@${partsLoadGeneration.value}`
  partsLoadedToken.value = token
  partsLoading.value = true
  partsError.value = ''
  try {
    const res = await axios.get(`/api/inventory/bom/parts/${encodeURIComponent(sc)}`)
    const body = res.data
    if (body?.code !== 200) {
      if (partsLoadedToken.value !== token) return
      partsError.value = body?.msg || '加载失败'
      partsList.value = []
      return
    }
    const list = Array.isArray(body?.data?.list) ? body.data.list : []
    if (partsLoadedToken.value !== token) return
    partsList.value = list.map((r) => ({
      ...r,
      _localKey: genLocalKey(),
    }))
  } catch (e) {
    if (partsLoadedToken.value !== token) return
    partsError.value = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
    partsList.value = []
  } finally {
    if (partsLoadedToken.value === token) partsLoading.value = false
  }
}

async function saveBomParts() {
  const sc = bomSystemcode.value
  if (!sc) {
    ElMessage.warning('主档缺少 systemcode，无法保存')
    return
  }
  if (partsReadOnly.value) {
    ElMessage.warning('已审核的 BOM 不可修改配件')
    return
  }
  try {
    const lines = (partsList.value ?? []).map((r) => ({
      id: r.id != null && Number(r.id) > 0 ? Number(r.id) : undefined,
      pendingDelete: false,
      kcaa01: String(r.kcaa01 ?? '').trim(),
      kcaa02: r.kcaa02,
      kcaa03: r.kcaa03,
      kcaa04: r.kcaa04,
      kcaa11: r.kcaa11,
      kcac04: r.kcac04,
      kcac05: r.kcac05,
      cost_price: r.cost_price,
      remark: r.remark,
    }))
    const res = await axios.put(`/api/inventory/bom/parts/${encodeURIComponent(sc)}`, { lines })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(body?.msg || '保存失败')
      return
    }
    ElMessage.success('配件明细已保存')
    await loadBomParts()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  }
}

watch(
  () => [detailActiveTab.value, bomSystemcode.value, detailVisible.value],
  ([tab, sc, vis]) => {
    if (!vis || tab !== 'parts' || !sc) return
    loadBomParts()
  },
)

/** 空值展示为 em dash，与只读详情习惯一致 */
function dVal(v) {
  const s = String(v ?? '').trim()
  return s || '—'
}

function onDetailClosed() {
  detailError.value = ''
  bomBasic.value = null
  detailTitleCode.value = ''
  detailActiveTab.value = 'basic'
  detailListRow.value = null
  partsList.value = []
  partsError.value = ''
  partsLoadedToken.value = ''
  partsLoadGeneration.value += 1
  materialSelectorVisible.value = false
}

const hintShort = computed(() => {
  const k = String(keyword.value ?? '').trim()
  return k.length > 0 && k.length < 3
})

function formatDateTime(v) {
  const s = String(v ?? '').trim()
  if (!s) return '—'
  // 常见格式：YYYY-MM-DD HH:mm:ss / YYYY-MM-DDTHH:mm:ss.sssZ / 其它字符串
  const t = s.replace('T', ' ').replace('Z', '')
  // 若包含秒，取到分钟；否则原样返回（并做长度保护）
  if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}/.test(t)) {
    const m = t.match(/^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{1,2})/)
    if (m) return `${m[1]} ${m[2]}`
  }
  return t.length > 16 ? t.slice(0, 16) : t
}

function rowIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

function ynText(v) {
  const s = String(v ?? '').trim()
  if (s === '1' || s.toLowerCase() === 'y' || s === '是') return '是'
  if (s === '0' || s.toLowerCase() === 'n' || s === '否') return '否'
  return s || '—'
}

function withRowKey(list) {
  return (list ?? []).map((r) => ({
    ...r,
    rowKey: `${String(r.code ?? '')}@@${String(r.version ?? '')}`,
  }))
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const pass = showUnAudited.value ? '0' : '1'
    const kw = String(keyword.value ?? '').trim()
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      pass,
      bom_cut: searchQuery.bom_cut === 1 ? 1 : 0,
      ...(kw.length >= 3 ? { keyword: kw } : {}),
    }
    const res = await axios.get('/api/inv/bom/list', { params })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = body?.msg || '加载失败'
      tableList.value = []
      total.value = 0
      return
    }
    const data = body.data ?? {}
    total.value = Number(data.total ?? 0)
    tableList.value = withRowKey(data.list ?? [])
  } catch (e) {
    const msg = e?.response?.data?.msg || e?.message || '网络错误'
    errorMessage.value = String(msg)
    tableList.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadData()
}

function onReset() {
  keyword.value = ''
  searchQuery.bom_cut = 0
  showUnAudited.value = false
  page.value = 1
  loadData()
}

function onPageChange(p) {
  page.value = p
  loadData()
}

function onPageSizeChange(ps) {
  pageSize.value = ps
  page.value = 1
  loadData()
}

async function openDetail(row) {
  const code = String(row?.code ?? '').trim()
  if (!code) {
    ElMessage.warning('当前行无编码，无法查看详情')
    return
  }
  detailTitleCode.value = code
  detailListRow.value = row
  detailVisible.value = true
  detailLoading.value = true
  detailError.value = ''
  bomBasic.value = null
  try {
    const res = await axios.get(`/api/inventory/bom/${encodeURIComponent(code)}`)
    const body = res.data
    if (body?.code !== 200) {
      detailError.value = body?.msg || '加载失败'
      return
    }
    bomBasic.value = body?.data?.basic ?? null
    if (!bomBasic.value) detailError.value = '未返回基础资料数据'
    else {
      detailListRow.value = { code: bomBasic.value.kcaa01, pass: bomBasic.value.pass }
    }
  } catch (e) {
    detailError.value = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
  } finally {
    detailLoading.value = false
  }
}

/** 从配件行钻取：打开该配件编码对应 BOM，并切到「配件明细」Tab（下一层） */
async function openLinkedBomDetailFromPart(partRow) {
  const code = String(partRow?.kcaa01 ?? '').trim()
  if (!code) {
    ElMessage.warning('该行无配件编码，无法跳转')
    return
  }
  detailLoading.value = true
  detailError.value = ''
  bomBasic.value = null
  partsList.value = []
  partsError.value = ''
  detailTitleCode.value = code
  try {
    const res = await axios.get(`/api/inventory/bom/${encodeURIComponent(code)}`)
    const body = res.data
    if (body?.code !== 200) {
      const msg = body?.msg || '加载失败'
      detailError.value = msg
      ElMessage.error(msg)
      return
    }
    const basic = body?.data?.basic ?? null
    if (!basic) {
      detailError.value = '未返回基础资料数据'
      return
    }
    bomBasic.value = basic
    detailListRow.value = { code: basic.kcaa01, pass: basic.pass }
    detailActiveTab.value = 'parts'
  } catch (e) {
    const msg = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
    detailError.value = msg
    ElMessage.error(msg)
  } finally {
    detailLoading.value = false
  }
}

async function copyRow(row) {
  const text = JSON.stringify(
    {
      code: row.code,
      name: row.name,
      spec: row.spec,
      unit: row.unit,
      version: row.version,
      isPurchase: row.isPurchase,
      isSubcontract: row.isSubcontract,
      isSelfProduced: row.isSelfProduced,
      status: row.status,
      pass: row.pass,
    },
    null,
    2,
  )
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本复制')
  }
}

function onEdit(row) {
  if (rowIsAudited(row)) return
  ElMessage.info('编辑表单将在后续版本对接保存接口，当前仅开放列表与详情查看。')
}

loadData()
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.search-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.bom-keyword-input {
  flex: 1;
  min-width: 280px;
  max-width: 520px;
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 4px;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.hint-alert,
.error-alert,
.audit-view-alert {
  margin-bottom: 12px;
}
.pagination-row {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}
.usage-sum-cell {
  line-height: 18px;
  font-size: 12px;
}
.usage-sum-muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.bom-detail-alert {
  margin-bottom: 12px;
}
.bom-detail-form {
  padding-top: 4px;
}
.bom-detail-check-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}
.bom-detail-dialog :deep(.el-dialog__body) {
  padding-top: 8px;
}
.bom-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 14px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.bom-sub-block-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  margin: 10px 0 6px;
}
.bom-parts-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.bom-parts-alert {
  margin-bottom: 10px;
}
.bom-parts-table-wrap {
  width: 100%;
  overflow-x: auto;
}
.bom-parts-table {
  min-width: 1100px;
}
.bom-parts-num {
  width: 100%;
}
/** 操作列「查看」：实心 small 主色按钮 */
.bom-part-view-action-btn {
  min-width: 72px;
}
.bom-parts-sum-row {
  margin-top: 10px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.bom-parts-sum-gap {
  margin-left: 24px;
}
</style>
