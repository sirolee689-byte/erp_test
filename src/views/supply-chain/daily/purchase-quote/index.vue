<template>
  <div class="erp-module-page">
    <!--
      采购报价：Purchase_Quotation + Purchase_Quotation_list
      主表分页；展开懒加载明细；查看/新增/编辑弹窗（主表表单 + 明细表）
    -->
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">
        主表 <code>Purchase_Quotation</code>（单号 <code>cgaa01</code>）与明细 <code>Purchase_Quotation_list</code>（<code>cgab01</code>）关联；列表汇总明细
        <code>cgab04</code>/<code>cgab05</code>；供应商字段为 <code>kehu</code>（界面称供应商/外协商）。
      </p>

      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="关键词（匹配主表文本字段）"
          clearable
          style="max-width: 360px"
          @keyup.enter="onSearch"
        />
        <div class="audit-switch">
          <span class="switch-label">回收站</span>
          <el-switch v-model="showRecycle" @change="onRecycleChange" />
        </div>
        <div v-if="!showRecycle" class="audit-switch">
          <span class="switch-label">显示未审核</span>
          <el-switch v-model="showUnAudited" @change="onSearch" />
        </div>
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
        <el-button v-if="!showRecycle" v-permission="'add'" type="success" plain @click="openCreate">
          新增报价
        </el-button>
        <el-button class="btn-view" :loading="loading" @click="loadData">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />
      <el-alert
        v-if="showRecycle"
        title="当前为回收站视图：可恢复或彻底删除（不可恢复）。"
        type="info"
        show-icon
        class="audit-alert"
      />
      <el-alert
        v-else-if="showUnAudited"
        title="当前显示：未审核主表"
        type="warning"
        show-icon
        class="audit-alert"
      />

      <el-skeleton :loading="loading" animated :rows="6">
        <template #default>
          <el-table
            ref="pqMainTableRef"
            class="pq-main-table"
            :data="tableList"
            row-key="id"
            border
            stripe
            style="width: 100%"
            :empty-text="loading ? '加载中…' : '暂无数据'"
            @expand-change="onExpandChange"
            @row-click="onPqMainRowClick"
          >
            <el-table-column type="expand">
              <template #default="{ row }">
                <div v-loading="row.__linesLoading" class="expand-inner">
                  <el-table
                    v-if="(row.__lines || []).length"
                    :data="row.__lines"
                    border
                    size="small"
                    style="width: 100%"
                  >
                    <el-table-column type="index" label="序号" width="58" />
                    <el-table-column label="操作" width="72">
                      <template #default="{ row: line }">
                        <el-button type="primary" link size="small" @click="openBomDetail(line)">
                          查看
                        </el-button>
                      </template>
                    </el-table-column>
                    <el-table-column label="材料编码" min-width="120" show-overflow-tooltip>
                      <template #default="{ row: line }">{{ formatCell(lineField(line, 'kcaa01')) }}</template>
                    </el-table-column>
                    <el-table-column label="材料名称" min-width="140" show-overflow-tooltip>
                      <template #default="{ row: line }">{{ formatCell(lineField(line, 'kcaa02')) }}</template>
                    </el-table-column>
                    <el-table-column label="规格" min-width="100" show-overflow-tooltip>
                      <template #default="{ row: line }">{{ formatCell(lineField(line, 'kcaa03')) }}</template>
                    </el-table-column>
                    <el-table-column label="颜色" width="88" show-overflow-tooltip>
                      <template #default="{ row: line }">{{ formatCell(lineField(line, 'kcaa11')) }}</template>
                    </el-table-column>
                    <el-table-column label="单位" width="72" show-overflow-tooltip>
                      <template #default="{ row: line }">{{ formatCell(lineField(line, 'kcaa05')) }}</template>
                    </el-table-column>
                    <el-table-column label="单价" width="100" show-overflow-tooltip>
                      <template #default="{ row: line }">{{ formatMoney(lineField(line, 'cgab04')) }}</template>
                    </el-table-column>
                    <el-table-column label="单价(含税)" width="112" show-overflow-tooltip>
                      <template #default="{ row: line }">{{ formatMoney(lineField(line, 'cgab05')) }}</template>
                    </el-table-column>
                    <el-table-column label="税点" width="72" show-overflow-tooltip>
                      <template #default="{ row: line }">{{ formatTaxPercent(lineField(line, 'Tax')) }}</template>
                    </el-table-column>
                    <el-table-column label="备注" min-width="120" show-overflow-tooltip>
                      <template #default="{ row: line }">{{
                        formatCell(lineField(line, 'remark') ?? lineField(line, 'info'))
                      }}</template>
                    </el-table-column>
                  </el-table>
                  <el-empty v-else-if="!row.__linesLoading" description="暂无明细" />
                </div>
              </template>
            </el-table-column>

            <el-table-column label="采购报价单号" prop="cgaa01" min-width="132" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="code-bold">{{ displayQuotationNo(row) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="采购报价日期" width="118" show-overflow-tooltip>
              <template #default="{ row }">{{ quoteDateDisplay(row) }}</template>
            </el-table-column>

            <el-table-column label="报价汇总" min-width="340" show-overflow-tooltip>
              <template #default="{ row }">{{ quoteSummaryRow(row) }}</template>
            </el-table-column>

            <el-table-column label="有效期" width="118" show-overflow-tooltip>
              <template #default="{ row }">{{ validUntilDisplay(row) }}</template>
            </el-table-column>

            <el-table-column label="供应商/外协商" prop="kehu" min-width="160" show-overflow-tooltip />

            <el-table-column label="备注" prop="remark" min-width="140" show-overflow-tooltip />

            <el-table-column label="审核" width="88">
              <template #default="{ row }">
                <el-tag v-if="passIsAudited(row)" type="success" size="small">已审</el-tag>
                <el-tag v-else type="warning" size="small">未审</el-tag>
              </template>
            </el-table-column>

            <el-table-column label="操作" width="340" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="openView(row)">查看</el-button>
                <template v-if="!showRecycle">
                  <el-button
                    v-if="!passIsAudited(row)"
                    v-permission="'edit'"
                    type="success"
                    link
                    size="small"
                    @click="openEdit(row)"
                  >
                    编辑
                  </el-button>
                  <el-button
                    v-if="!passIsAudited(row)"
                    v-permission="'audit'"
                    type="success"
                    link
                    size="small"
                    :loading="row.__opLoading === 'audit'"
                    @click="auditRow(row)"
                  >
                    审核
                  </el-button>
                  <el-button
                    v-if="passIsAudited(row)"
                    v-permission="'audit'"
                    type="warning"
                    link
                    size="small"
                    :loading="row.__opLoading === 'unaudit'"
                    @click="unauditRow(row)"
                  >
                    反审
                  </el-button>
                  <el-button
                    v-permission="'delete'"
                    type="danger"
                    link
                    size="small"
                    :loading="row.__opLoading === 'delete'"
                    @click="softDeleteRow(row)"
                  >
                    删除
                  </el-button>
                </template>
                <template v-else>
                  <el-button
                    v-permission="'edit'"
                    type="primary"
                    link
                    size="small"
                    :loading="row.__opLoading === 'restore'"
                    @click="restoreRow(row)"
                  >
                    恢复
                  </el-button>
                  <el-button
                    v-permission="'delete'"
                    type="danger"
                    link
                    size="small"
                    :loading="row.__opLoading === 'permanent'"
                    @click="permanentDeleteRow(row)"
                  >
                    彻底删除
                  </el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>

          <div class="pager-row">
            <el-pagination
              v-model:current-page="page"
              v-model:page-size="pageSize"
              background
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              :page-sizes="[10, 20, 50, 100]"
              @size-change="onPageSizeChange"
              @current-change="onPageChange"
            />
          </div>
        </template>
      </el-skeleton>
    </el-card>

    <!-- 查看 -->
    <el-dialog v-model="viewVisible" title="查看采购报价" width="920px" destroy-on-close>
      <div v-loading="viewLoading" class="detail-wrap">
        <h4 class="sub-title">主表</h4>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item v-for="([k, v], idx) in viewHeaderEntries" :key="idx" :label="k">
            {{ formatCell(v) }}
          </el-descriptions-item>
        </el-descriptions>
        <h4 class="sub-title">明细</h4>
        <el-table v-if="viewLines.length" :data="viewLines" border size="small" style="width: 100%">
          <el-table-column type="index" label="序号" width="58" />
          <el-table-column label="操作" width="72">
            <template #default="{ row: line }">
              <el-button type="primary" link size="small" @click="openBomDetail(line)">查看</el-button>
            </template>
          </el-table-column>
          <el-table-column label="材料编码" min-width="120" show-overflow-tooltip>
            <template #default="{ row: line }">{{ formatCell(lineField(line, 'kcaa01')) }}</template>
          </el-table-column>
          <el-table-column label="材料名称" min-width="140" show-overflow-tooltip>
            <template #default="{ row: line }">{{ formatCell(lineField(line, 'kcaa02')) }}</template>
          </el-table-column>
          <el-table-column label="规格" min-width="100" show-overflow-tooltip>
            <template #default="{ row: line }">{{ formatCell(lineField(line, 'kcaa03')) }}</template>
          </el-table-column>
          <el-table-column label="颜色" width="88" show-overflow-tooltip>
            <template #default="{ row: line }">{{ formatCell(lineField(line, 'kcaa11')) }}</template>
          </el-table-column>
          <el-table-column label="单位" width="72" show-overflow-tooltip>
            <template #default="{ row: line }">{{ formatCell(lineField(line, 'kcaa05')) }}</template>
          </el-table-column>
          <el-table-column label="单价" width="100" show-overflow-tooltip>
            <template #default="{ row: line }">{{ formatMoney(lineField(line, 'cgab04')) }}</template>
          </el-table-column>
          <el-table-column label="单价(含税)" width="112" show-overflow-tooltip>
            <template #default="{ row: line }">{{ formatMoney(lineField(line, 'cgab05')) }}</template>
          </el-table-column>
          <el-table-column label="税点" width="72" show-overflow-tooltip>
            <template #default="{ row: line }">{{ formatTaxPercent(lineField(line, 'Tax')) }}</template>
          </el-table-column>
          <el-table-column label="备注" min-width="120" show-overflow-tooltip>
            <template #default="{ row: line }">{{
              formatCell(lineField(line, 'remark') ?? lineField(line, 'info'))
            }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无明细" />
      </div>
    </el-dialog>

    <!-- 明细行「查看」：BOM 主档资料 -->
    <el-dialog v-model="bomDetailVisible" title="BOM 资料" width="760px" destroy-on-close>
      <div v-loading="bomDetailLoading" class="bom-detail-wrap">
        <el-descriptions v-if="bomDetailEntries.length" :column="2" border size="small">
          <el-descriptions-item
            v-for="([k, v], idx) in bomDetailEntries"
            :key="idx"
            :label="k"
          >
            {{ formatCell(v) }}
          </el-descriptions-item>
        </el-descriptions>
        <el-empty v-else-if="!bomDetailLoading" description="无数据" />
      </div>
    </el-dialog>

    <!-- 新增/编辑：Tab — 基础资料 / 明细 -->
    <el-dialog
      v-model="editVisible"
      :title="editMode === 'create' ? '新增采购报价' : '编辑采购报价'"
      width="75%"
      top="5vh"
      draggable
      destroy-on-close
      :close-on-click-modal="false"
      class="pq-edit-dialog"
    >
      <div class="edit-wrap">
        <el-tabs v-model="editActiveTab" class="pq-edit-tabs" @tab-change="onEditTabChange">
          <el-tab-pane label="报价单基础资料" name="basic">
            <el-form label-width="122px" class="pq-basic-form" @submit.prevent>
              <el-row :gutter="10">
                <el-col :xs="24" :sm="14">
                  <el-form-item label="报价单号" required>
                    <div class="pq-docno-row">
                      <el-input v-model="basicForm.cgaa01" clearable placeholder="采购报价单号 cgaa01" />
                      <el-button :loading="docNoChecking" @click="checkQuotationDocNo">编码检测</el-button>
                    </div>
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="10">
                  <el-form-item label="报价日期">
                    <el-date-picker
                      v-model="basicForm.quoteDate"
                      type="date"
                      value-format="YYYY-MM-DD"
                      placeholder="选择报价日期（写入 addtime / cgaa02）"
                      style="width: 100%"
                    />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="10">
                  <el-form-item label="有效日期">
                    <el-date-picker
                      v-model="basicForm.validUntil"
                      type="date"
                      value-format="YYYY-MM-DD"
                      placeholder="有效期 cgaa07"
                      clearable
                      style="width: 100%"
                    />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="14">
                  <el-form-item label="供应商">
                    <el-select
                      v-model="basicForm.kehu"
                      filterable
                      remote
                      reserve-keyword
                      placeholder="远程搜索（pass=1 且在册）"
                      :remote-method="searchSuppliers"
                      :loading="supplierLoading"
                      clearable
                      style="width: 100%"
                      @visible-change="onSupplierDropdownVisible"
                    >
                      <el-option
                        v-for="opt in supplierOptions"
                        :key="`${opt.id}-${opt.s_code || ''}`"
                        :label="formatSupplierOptionLabel(opt)"
                        :value="opt.s_name"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="14">
                  <el-form-item label="币别">
                    <el-input v-model="currencyCombo" clearable placeholder="例：001,人民币（cgaa05 + rmb）" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="10">
                  <el-form-item label="小数位数">
                    <el-input-number
                      v-model="basicForm.decimalPlaces"
                      :min="0"
                      :max="8"
                      :step="1"
                      controls-position="right"
                      style="width: 100%"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="24">
                  <el-form-item label="备注">
                    <el-input
                      v-model="basicForm.remark"
                      type="textarea"
                      :rows="3"
                      maxlength="500"
                      show-word-limit
                      placeholder="备注 remark"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
            </el-form>
          </el-tab-pane>
          <el-tab-pane label="采购报价明细" name="lines">
            <p class="pq-lines-hint">
              单价、单价(含税)均可录入（按主表小数位四舍五入）；一般填其一，另一项随税点自动计算。改税点时若已填单价则重算含税，否则从未含税反推单价。保存前请点击保存写入数据库。
            </p>
            <div class="lines-toolbar">
              <el-button
                v-if="editMode === 'create'"
                v-permission="'add'"
                type="primary"
                plain
                size="small"
                :disabled="detailLocked"
                @click="addLineRow"
              >
                增行
              </el-button>
              <el-button
                v-else
                v-permission="'edit'"
                type="primary"
                plain
                size="small"
                :disabled="detailLocked"
                @click="addLineRow"
              >
                增行
              </el-button>
            </div>
            <el-table
              :data="lineRows"
              border
              size="small"
              class="pq-lines-table"
              scrollbar-always-on
              max-height="calc(80vh - 200px)"
              style="width: 100%"
            >
              <el-table-column label="序号" width="58" fixed="left">
                <template #default="{ $index }">{{ $index + 1 }}</template>
              </el-table-column>
              <el-table-column label="编码" width="160" fixed="left">
                <template #default="{ row, $index }">
                  <div class="pq-code-cell">
                    <span class="pq-cell-readonly pq-code-text">{{ row.kcaa01 || '—' }}</span>
                    <el-button
                      :icon="Search"
                      circle
                      size="small"
                      class="pq-material-search-btn"
                      :disabled="detailLocked"
                      title="选择物料"
                      @click="openMaterialPicker($index)"
                    />
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="单价" width="128" fixed="left">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.cgab04"
                    :disabled="detailLocked"
                    :controls="false"
                    :precision="basicForm.decimalPlaces"
                    :step="0.0001"
                    size="small"
                    style="width: 100%"
                    @change="() => applyExToIncl(row)"
                  />
                </template>
              </el-table-column>
              <el-table-column label="税点(%)" width="100" fixed="left">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.Tax"
                    :disabled="detailLocked"
                    :min="0"
                    :max="100"
                    :precision="2"
                    :controls="false"
                    size="small"
                    style="width: 100%"
                    @change="() => syncLineOnTaxChange(row)"
                  />
                </template>
              </el-table-column>
              <el-table-column label="单价(含税)" width="128" fixed="left">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.cgab05"
                    :disabled="detailLocked"
                    :controls="false"
                    :precision="basicForm.decimalPlaces"
                    :step="0.0001"
                    size="small"
                    style="width: 100%"
                    @change="() => applyInclToEx(row)"
                  />
                </template>
              </el-table-column>
              <el-table-column label="备注" min-width="120" fixed="left">
                <template #default="{ row }">
                  <el-input v-model="row.remark" :disabled="detailLocked" size="small" maxlength="500" />
                </template>
              </el-table-column>
              <el-table-column label="材料名称" min-width="130">
                <template #default="{ row }">
                  <span class="pq-cell-readonly">{{ row.kcaa02 || '—' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="规格" min-width="100">
                <template #default="{ row }">
                  <span class="pq-cell-readonly">{{ row.kcaa03 || '—' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="颜色" width="88">
                <template #default="{ row }">
                  <span class="pq-cell-readonly">{{ row.kcaa11 || '—' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="单位" width="72">
                <template #default="{ row }">
                  <span class="pq-cell-readonly">{{ row.kcaa05 || '—' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="72" fixed="right">
                <template #default="{ $index }">
                  <el-button
                    v-if="editMode === 'create'"
                    v-permission="'add'"
                    type="danger"
                    link
                    size="small"
                    :disabled="detailLocked"
                    @click="removeLineRow($index)"
                  >
                    删除
                  </el-button>
                  <el-button
                    v-else
                    v-permission="'edit'"
                    type="danger"
                    link
                    size="small"
                    :disabled="detailLocked"
                    @click="removeLineRow($index)"
                  >
                    删除
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" :disabled="detailLocked" @click="submitEdit">
          保存
        </el-button>
      </template>
    </el-dialog>

    <MaterialSelector v-model="materialSelectorVisible" @picked="onMaterialPicked" />
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Search } from '@element-plus/icons-vue'
import axios from 'axios'
import MaterialSelector from './MaterialSelector.vue'

const pageTitle = '采购报价'

const loading = ref(false)
const errorMessage = ref('')
const keyword = ref('')
const showRecycle = ref(false)
const showUnAudited = ref(false)
const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

/** 主表：用于点击整行展开/收起明细 */
const pqMainTableRef = ref(null)

const viewVisible = ref(false)
const viewLoading = ref(false)
const viewHeaderEntries = ref([])
const viewLines = ref([])

const bomDetailVisible = ref(false)
const bomDetailLoading = ref(false)
/** @type {import('vue').Ref<[string, unknown][]>} */
const bomDetailEntries = ref([])

const editVisible = ref(false)
const editMode = ref('create')
const editId = ref(null)
/** 编辑时服务端返回的完整主表快照（合并后再提交，保留未出现在表单中的列） */
const loadedEditHeader = ref(null)
const editActiveTab = ref('basic')
const editSaving = ref(false)
const docNoChecking = ref(false)
const supplierLoading = ref(false)
/** @type {import('vue').Ref<{ id: unknown, s_code: string, s_name: string }[]>} */
const supplierOptions = ref([])
const currencyCombo = ref('001,人民币')

const basicForm = reactive({
  cgaa01: '',
  quoteDate: '',
  validUntil: '',
  kehu: '',
  decimalPlaces: 4,
  remark: '',
})

const lineRows = ref([])

/** 编辑弹窗内主表审核状态（明细锁定）：pass=1 禁止改明细 */
const dialogHeaderPass = ref('0')
const materialSelectorVisible = ref(false)
const materialSelectorRowIndex = ref(-1)

const detailLocked = computed(() => String(dialogHeaderPass.value ?? '').trim() === '1')

// 主表小数位变更时重算所有明细含税价
watch(
  () => basicForm.decimalPlaces,
  () => {
    for (const r of lineRows.value || []) {
      const rawEx = lineField(r, 'cgab04')
      const ex = Number(rawEx)
      const hasEx =
        rawEx !== '' && rawEx != null && rawEx !== undefined && Number.isFinite(ex)
      if (hasEx) applyExToIncl(r)
      else applyInclToEx(r)
    }
  },
)

function passIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

function docLabel(row) {
  const r = row || {}
  const cg = String(r.cgaa01 ?? '').trim()
  if (cg) return cg
  return (
    String(r.systemcode ?? r.code ?? r.quotation_code ?? r.djbh ?? r.dh ?? r.bill_no ?? '').trim() ||
    `ID:${r.id ?? '—'}`
  )
}

function displayQuotationNo(row) {
  const s = String(row?.cgaa01 ?? '').trim()
  return s || docLabel(row)
}

/** yyyy-MM-dd（与后端 CONVERT 23 一致） */
function formatDateCell(v) {
  if (v == null || v === '') return '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim()
  const d = new Date(v)
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const s = String(v).trim()
  return s || '—'
}

function quoteDateDisplay(row) {
  if (row?.pq_quote_date_display != null && String(row.pq_quote_date_display).trim() !== '') {
    return String(row.pq_quote_date_display).trim()
  }
  return formatDateCell(row?.cgaa02)
}

function validUntilDisplay(row) {
  if (row?.pq_valid_until_display != null && String(row.pq_valid_until_display).trim() !== '') {
    return String(row.pq_valid_until_display).trim()
  }
  return formatDateCell(row?.cgaa07)
}

function formatMoney(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return x.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

/** 明细行字段（列名大小写不敏感） */
function lineField(line, name) {
  if (!line || name == null || name === '') return undefined
  const t = String(name).toLowerCase()
  for (const k of Object.keys(line)) {
    if (String(k).toLowerCase() === t) return line[k]
  }
  return undefined
}

/**
 * 税点展示：0.13 → 13%；已为百分比形式如 13 → 13%
 */
function formatTaxPercent(v) {
  if (v == null || v === '') return '—'
  const s = String(v).trim().replace(/%/g, '')
  if (!s) return '—'
  const n = Number(s)
  if (!Number.isFinite(n)) return String(v)
  const pct = n > 0 && n < 1 ? n * 100 : n
  const rounded = Math.round(pct * 10000) / 10000
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded)
  return `${text}%`
}

function quoteSummaryRow(row) {
  const hasAgg =
    row &&
    (row.pq_line_count != null || row.pq_sum_excl_tax != null || row.pq_sum_incl_tax != null)
  if (!hasAgg) return '—'
  const cnt = Number(row.pq_line_count ?? 0)
  const ex = Number(row.pq_sum_excl_tax ?? 0)
  const inc = Number(row.pq_sum_incl_tax ?? 0)
  const tax =
    row.pq_tax_amount != null && row.pq_tax_amount !== ''
      ? Number(row.pq_tax_amount)
      : inc - ex
  return `总项数：${cnt}；不含税总价：${formatMoney(ex)}；含税总价：${formatMoney(inc)}；税点总价：${formatMoney(tax)}`
}

function formatCell(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  const s = String(v).trim()
  return s || '—'
}

/** 按主表小数位四舍五入 */
function roundByDecimals(num, places) {
  const n = Number(num)
  const p = Math.min(8, Math.max(0, Number(places) || 4))
  if (!Number.isFinite(n)) return 0
  const f = 10 ** p
  return Math.round(n * f) / f
}

/** 税点存入/API：支持旧库小数税率 0.13 → 13 */
function normalizeTaxInput(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  if (n > 0 && n < 1) return Math.round(n * 10000) / 100
  return Math.min(100, Math.max(0, n))
}

/** 税点展示录入：库内 0.13 转为 13 */
function normalizeTaxFromApi(v) {
  if (v === '' || v === undefined || v === null) return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) return undefined
  if (n > 0 && n <= 1) return Math.round(n * 10000) / 100
  return Math.min(100, Math.max(0, n))
}

/** 填单价 → 按税点计算含税价 */
function applyExToIncl(row) {
  if (!row) return
  const places = Math.min(8, Math.max(0, Number(basicForm.decimalPlaces) || 4))
  const rawEx = lineField(row, 'cgab04')
  const ex = Number(rawEx)
  const taxPct = normalizeTaxInput(lineField(row, 'Tax'))
  if (rawEx === '' || rawEx === null || rawEx === undefined || !Number.isFinite(ex)) {
    return
  }
  row.cgab05 = roundByDecimals(ex * (1 + taxPct / 100), places)
}

/** 填含税价 → 反推单价 */
function applyInclToEx(row) {
  if (!row) return
  const places = Math.min(8, Math.max(0, Number(basicForm.decimalPlaces) || 4))
  const rawIncl = lineField(row, 'cgab05')
  const incl = Number(rawIncl)
  const taxPct = normalizeTaxInput(lineField(row, 'Tax'))
  const denom = 1 + taxPct / 100
  if (denom <= 0) return
  if (rawIncl === '' || rawIncl === null || rawIncl === undefined || !Number.isFinite(incl)) {
    return
  }
  row.cgab04 = roundByDecimals(incl / denom, places)
}

/** 改税点：优先按已有单价重算含税；无单价则按含税反推单价 */
function syncLineOnTaxChange(row) {
  if (!row) return
  const rawEx = lineField(row, 'cgab04')
  const ex = Number(rawEx)
  const hasEx =
    rawEx !== '' && rawEx != null && rawEx !== undefined && Number.isFinite(ex)
  if (hasEx) {
    applyExToIncl(row)
    return
  }
  const rawIncl = lineField(row, 'cgab05')
  const incl = Number(rawIncl)
  const hasIncl =
    rawIncl !== '' && rawIncl != null && rawIncl !== undefined && Number.isFinite(incl)
  if (hasIncl) {
    applyInclToEx(row)
  }
}

function onEditTabChange(tabName) {
  if (tabName === 'lines' && detailLocked.value) {
    ElMessage.warning('该报价单已审核，请先反审后再修改明细。')
  }
}

function openMaterialPicker(idx) {
  if (detailLocked.value) {
    ElMessage.warning('该报价单已审核，请先反审后再修改明细。')
    return
  }
  materialSelectorRowIndex.value = idx
  materialSelectorVisible.value = true
}

function onMaterialPicked(payload) {
  const idx = materialSelectorRowIndex.value
  if (idx < 0) return
  const row = lineRows.value[idx]
  if (!row) return
  row.kcaa01 = payload.kcaa01 ?? ''
  row.kcaa02 = payload.kcaa02 ?? ''
  row.kcaa03 = payload.kcaa03 ?? ''
  row.kcaa11 = payload.kcaa11 ?? ''
  row.kcaa05 = payload.kcaa05 ?? ''
  const rawEx = lineField(row, 'cgab04')
  const ex = Number(rawEx)
  const hasEx =
    rawEx !== '' && rawEx != null && rawEx !== undefined && Number.isFinite(ex)
  if (hasEx) applyExToIncl(row)
  else syncLineOnTaxChange(row)
}

function lineHasNumericPrice(r) {
  const ex = lineField(r, 'cgab04')
  const incl = lineField(r, 'cgab05')
  const exOk =
    ex !== '' && ex !== undefined && ex !== null && Number.isFinite(Number(ex))
  const inclOk =
    incl !== '' &&
    incl !== undefined &&
    incl !== null &&
    Number.isFinite(Number(incl))
  return exOk || inclOk
}

function validateQuoteLines() {
  const rows = lineRows.value || []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const code = String(lineField(r, 'kcaa01') ?? '').trim()
    if (!code) continue
    const tx = lineField(r, 'Tax')
    if (!lineHasNumericPrice(r)) {
      ElMessage.warning(`第 ${i + 1} 行：请填写单价或单价(含税)至少一项`)
      editActiveTab.value = 'lines'
      return false
    }
    if (tx === '' || tx === undefined || tx === null || Number.isNaN(Number(tx))) {
      ElMessage.warning(`第 ${i + 1} 行：请填写税点（0–100）`)
      editActiveTab.value = 'lines'
      return false
    }
  }
  return true
}

/** 提交前统一两项金额：有单价则以单价为准算含税，否则从含税反推单价 */
function syncLinePricesForSubmit(r) {
  const places = Math.min(8, Math.max(0, Number(basicForm.decimalPlaces) || 4))
  const taxPct = normalizeTaxInput(lineField(r, 'Tax'))
  const rawEx = lineField(r, 'cgab04')
  const rawIncl = lineField(r, 'cgab05')
  const exN = Number(rawEx)
  const inclN = Number(rawIncl)
  const hasEx =
    rawEx !== '' && rawEx != null && rawEx !== undefined && Number.isFinite(exN)
  const hasIncl =
    rawIncl !== '' && rawIncl != null && rawIncl !== undefined && Number.isFinite(inclN)
  const denom = 1 + taxPct / 100
  if (hasEx) {
    r.cgab04 = roundByDecimals(exN, places)
    r.cgab05 = roundByDecimals(exN * denom, places)
  } else if (hasIncl && denom > 0) {
    r.cgab05 = roundByDecimals(inclN, places)
    r.cgab04 = roundByDecimals(inclN / denom, places)
  }
}

function sanitizeLinesForApi() {
  const places = Math.min(8, Math.max(0, Number(basicForm.decimalPlaces) || 4))
  /** @type {Record<string, unknown>[]} */
  const out = []
  const rows = lineRows.value || []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const code = String(lineField(r, 'kcaa01') ?? '').trim()
    if (!code) continue
    syncLinePricesForSubmit(r)
    const taxPct = normalizeTaxInput(lineField(r, 'Tax'))
    const ex = roundByDecimals(lineField(r, 'cgab04'), places)
    const incl = roundByDecimals(Number(lineField(r, 'cgab05')), places)
    out.push({
      kcaa01: code,
      kcaa02: String(lineField(r, 'kcaa02') ?? '').trim(),
      kcaa03: String(lineField(r, 'kcaa03') ?? '').trim(),
      kcaa11: String(lineField(r, 'kcaa11') ?? '').trim(),
      kcaa05: String(lineField(r, 'kcaa05') ?? '').trim(),
      cgab04: ex,
      cgab05: incl,
      Tax: taxPct,
      remark: String(lineField(r, 'remark') ?? '').trim(),
      Seq: out.length + 1,
    })
  }
  return out
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const pass = showRecycle.value ? undefined : showUnAudited.value ? '0' : '1'
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      pass,
      recycled: showRecycle.value ? 1 : 0,
    }
    const res = await axios.get('/api/supply-chain/purchase-quotations/list', { params })
    const data = res?.data?.data ?? {}
    total.value = Number(data.total ?? 0) || 0
    const list = Array.isArray(data.list) ? data.list : []
    tableList.value = list.map((r) => ({
      ...r,
      __opLoading: '',
      __lines: null,
      __linesLoaded: false,
      __linesLoading: false,
    }))
  } catch (err) {
    const msg = err?.response?.data?.msg || err?.message || '加载失败'
    errorMessage.value = String(msg)
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
  showUnAudited.value = false
  page.value = 1
  loadData()
}

function onRecycleChange() {
  if (showRecycle.value) showUnAudited.value = false
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

async function onExpandChange(row, expandedRows) {
  const open = expandedRows.some((r) => r.id === row.id)
  if (!open) return
  if (row.__linesLoaded) return
  row.__linesLoading = true
  try {
    const res = await axios.get(`/api/supply-chain/purchase-quotations/${row.id}/lines`)
    row.__lines = Array.isArray(res?.data?.data?.list) ? res.data.data.list : []
    row.__linesLoaded = true
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载明细失败'))
    row.__lines = []
  } finally {
    row.__linesLoading = false
  }
}

/** 点击行任意单元格即可展开/收起（排除左侧箭头列与操作列按钮，避免重复切换或误触） */
function onPqMainRowClick(row, column, event) {
  if (!row || !pqMainTableRef.value) return
  const el = event?.target
  if (el && typeof el.closest === 'function') {
    if (el.closest('.el-table__expand-icon')) return
    if (el.closest('.el-button, button, a, input, textarea, select')) return
  }
  if (column?.type === 'expand') return
  pqMainTableRef.value.toggleRowExpansion(row)
}

/** yyyy-MM-dd 当天（本地） */
function formatTodayYmd() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 主表日期字段 → date-picker（YYYY-MM-DD） */
function normalizeHeaderDateForPicker(v) {
  if (v == null || v === '') return ''
  if (typeof v === 'string') {
    const t = v.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  }
  const d = new Date(v)
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return ''
}

/** 币别组合输入解析 → cgaa05 / rmb */
function parseCurrencyCombo(combo) {
  const s = String(combo ?? '').trim()
  const i = s.indexOf(',')
  if (i === -1) return { code: s.slice(0, 10).trim(), name: '' }
  return {
    code: s.slice(0, i).trim().slice(0, 10),
    name: s.slice(i + 1).trim().slice(0, 50),
  }
}

function formatSupplierOptionLabel(opt) {
  if (!opt) return ''
  const name = String(opt.s_name ?? '').trim()
  const code = String(opt.s_code ?? '').trim()
  if (code && name && name !== code) return `${name}（${code}）`
  return name || code || '—'
}

function resetBasicForm() {
  basicForm.cgaa01 = ''
  basicForm.quoteDate = formatTodayYmd()
  basicForm.validUntil = ''
  basicForm.kehu = ''
  basicForm.decimalPlaces = 4
  basicForm.remark = ''
  currencyCombo.value = '001,人民币'
  supplierOptions.value = []
}

async function fetchSuggestedDocNo() {
  try {
    const res = await axios.get('/api/supply-chain/purchase-quotations/suggest-doc-no')
    const s = res?.data?.data?.suggested
    if (s) basicForm.cgaa01 = String(s)
  } catch {
    /* 网络或权限失败时不阻断弹窗 */
  }
}

async function checkQuotationDocNo() {
  const code = String(basicForm.cgaa01 ?? '').trim()
  if (!code) {
    ElMessage.warning('请先填写报价单号')
    return
  }
  docNoChecking.value = true
  try {
    const res = await axios.get('/api/supply-chain/purchase-quotations/check-doc-no', {
      params: { cgaa01: code },
    })
    const ok = res?.data?.data?.available
    const msg = res?.data?.data?.message
    if (ok) ElMessage.success('该单号可以使用')
    else ElMessage.error(String(msg || '单号已在在册记录中存在'))
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '检测失败'))
  } finally {
    docNoChecking.value = false
  }
}

async function searchSuppliers(q) {
  supplierLoading.value = true
  try {
    const res = await axios.get('/api/supply-chain/purchase-quotations/supplier-options', {
      params: { keyword: String(q ?? '').trim() || undefined, limit: 40 },
    })
    supplierOptions.value = Array.isArray(res?.data?.data?.list) ? res.data.data.list : []
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载供应商失败'))
    supplierOptions.value = []
  } finally {
    supplierLoading.value = false
  }
}

function onSupplierDropdownVisible(open) {
  if (open && !(supplierOptions.value && supplierOptions.value.length)) {
    searchSuppliers('')
  }
}

function buildHeaderForSubmit() {
  const qd = String(basicForm.quoteDate ?? '').trim() || formatTodayYmd()
  const { code: curCode, name: curName } = parseCurrencyCombo(currencyCombo.value)
  const decStr = String(
    Number.isFinite(Number(basicForm.decimalPlaces)) ? Math.trunc(Number(basicForm.decimalPlaces)) : 4,
  )
  /** @type {Record<string, unknown>} */
  const header = {
    cgaa01: String(basicForm.cgaa01 ?? '').trim(),
    kehu: String(basicForm.kehu ?? '').trim(),
    remark: String(basicForm.remark ?? '').trim(),
    cgaa05: curCode,
    rmb: curName,
    decimal: decStr,
    decimal_view: decStr,
    addtime: qd,
    cgaa02: qd,
  }
  const vu = String(basicForm.validUntil ?? '').trim()
  if (vu) header.cgaa07 = vu
  if (editMode.value === 'edit' && loadedEditHeader.value) {
    return { ...loadedEditHeader.value, ...header }
  }
  return header
}

async function openCreate() {
  editMode.value = 'create'
  editId.value = null
  loadedEditHeader.value = null
  dialogHeaderPass.value = '0'
  editActiveTab.value = 'basic'
  editSaving.value = false
  resetBasicForm()
  lineRows.value = []
  editVisible.value = true
  await fetchSuggestedDocNo()
}

async function openView(row) {
  viewVisible.value = true
  viewLoading.value = true
  viewLines.value = []
  viewHeaderEntries.value = []
  try {
    const res = await axios.get(`/api/supply-chain/purchase-quotations/${row.id}`)
    const header = res?.data?.data?.header ?? {}
    const lines = Array.isArray(res?.data?.data?.lines) ? res.data.data.lines : []
    viewHeaderEntries.value = Object.entries(header)
    viewLines.value = lines
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载失败'))
    viewVisible.value = false
  } finally {
    viewLoading.value = false
  }
}

async function openBomDetail(line) {
  const code = String(lineField(line, 'kcaa01') ?? '').trim()
  if (!code) {
    ElMessage.warning('当前行无材料编码（kcaa01），无法查看 BOM')
    return
  }
  bomDetailVisible.value = true
  bomDetailLoading.value = true
  bomDetailEntries.value = []
  try {
    const res = await axios.get('/api/supply-chain/purchase-quotations/bom-detail', {
      params: { kcaa01: code },
    })
    const bom = res?.data?.data?.bom ?? {}
    bomDetailEntries.value = Object.entries(bom).sort(([a], [b]) => String(a).localeCompare(String(b)))
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载 BOM 失败'))
    bomDetailVisible.value = false
  } finally {
    bomDetailLoading.value = false
  }
}

async function openEdit(row) {
  if (passIsAudited(row)) {
    await ElMessageBox.alert('该数据已审核，需先反审后才能编辑。', '提示', { type: 'warning' })
    return
  }
  editMode.value = 'edit'
  editId.value = row.id
  editSaving.value = false
  editActiveTab.value = 'basic'
  try {
    const res = await axios.get(`/api/supply-chain/purchase-quotations/${row.id}`)
    const header = { ...(res?.data?.data?.header ?? {}) }
    loadedEditHeader.value = JSON.parse(JSON.stringify(header))
    const lines = Array.isArray(res?.data?.data?.lines) ? res.data.data.lines.map((x) => ({ ...x })) : []

    basicForm.cgaa01 = String(lineField(header, 'cgaa01') ?? '').trim()
    basicForm.kehu = String(lineField(header, 'kehu') ?? '').trim()
    basicForm.remark = String(lineField(header, 'remark') ?? '').trim()
    const addt = lineField(header, 'addtime')
    const c2 = lineField(header, 'cgaa02')
    basicForm.quoteDate = normalizeHeaderDateForPicker(addt || c2) || formatTodayYmd()
    basicForm.validUntil = normalizeHeaderDateForPicker(lineField(header, 'cgaa07'))
    const decRaw = lineField(header, 'decimal') ?? lineField(header, 'decimal_view')
    const decNum = Number(decRaw)
    basicForm.decimalPlaces = Number.isFinite(decNum) ? Math.trunc(decNum) : 4
    const c05 = String(lineField(header, 'cgaa05') ?? '').trim()
    const rmbv = String(lineField(header, 'rmb') ?? '').trim()
    if (c05 && rmbv) currencyCombo.value = `${c05},${rmbv}`
    else if (c05) currencyCombo.value = c05
    else if (rmbv) currencyCombo.value = rmbv
    else currencyCombo.value = '001,人民币'

    supplierOptions.value = []
    dialogHeaderPass.value = String(lineField(header, 'pass') ?? row.pass ?? '').trim() || '0'
    lineRows.value = lines.map((raw) => {
      const x = { ...raw }
      x.Tax = normalizeTaxFromApi(lineField(x, 'Tax'))
      const rawEx = lineField(x, 'cgab04')
      const ex = Number(rawEx)
      const hasEx =
        rawEx !== '' && rawEx != null && rawEx !== undefined && Number.isFinite(ex)
      if (hasEx) applyExToIncl(x)
      else applyInclToEx(x)
      return x
    })
    editVisible.value = true
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载失败'))
  }
}

function addLineRow() {
  if (detailLocked.value) {
    ElMessage.warning('该报价单已审核，请先反审后再修改明细。')
    return
  }
  lineRows.value.push({
    kcaa01: '',
    kcaa02: '',
    kcaa03: '',
    kcaa11: '',
    kcaa05: '',
    cgab04: undefined,
    Tax: undefined,
    cgab05: undefined,
    remark: '',
  })
}

async function removeLineRow(idx) {
  if (detailLocked.value) {
    ElMessage.warning('该报价单已审核，请先反审后再修改明细。')
    return
  }
  try {
    await ElMessageBox.confirm(
      '确认要删除该条物料报价吗？删除后需重新保存单据方可生效。',
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  lineRows.value.splice(idx, 1)
}

async function submitEdit() {
  if (detailLocked.value) {
    ElMessage.warning('该报价单已审核，请先反审后再修改明细。')
    return
  }
  if (!String(basicForm.cgaa01 ?? '').trim()) {
    ElMessage.warning('请填写报价单号')
    editActiveTab.value = 'basic'
    return
  }
  if (!validateQuoteLines()) return
  editSaving.value = true
  try {
    const header = buildHeaderForSubmit()
    const lines = sanitizeLinesForApi()
    if (editMode.value === 'create') {
      await axios.post('/api/supply-chain/purchase-quotations', { header, lines })
      ElMessage.success('新增成功')
    } else {
      await axios.put('/api/supply-chain/purchase-quotations', {
        id: editId.value,
        header,
        lines,
      })
      ElMessage.success('保存成功')
    }
    editVisible.value = false
    loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  } finally {
    editSaving.value = false
  }
}

function setRowLoading(row, key) {
  const x = tableList.value.find((r) => r.id === row.id)
  if (x) x.__opLoading = key
}

async function auditRow(row) {
  try {
    await ElMessageBox.confirm(`确认要审核【${docLabel(row)}】吗？审核后将允许在业务中引用。`, '审核确认', {
      type: 'warning',
      confirmButtonText: '审核',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  setRowLoading(row, 'audit')
  try {
    await axios.put('/api/supply-chain/purchase-quotations/audit', { id: row.id })
    ElMessage.success('已审核')
    loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '操作失败'))
  } finally {
    setRowLoading(row, '')
  }
}

async function unauditRow(row) {
  try {
    await ElMessageBox.confirm(
      `确认要反审【${docLabel(row)}】吗？反审后将禁止在业务中引用，已引用不受影响。`,
      '反审确认',
      { type: 'warning', confirmButtonText: '反审', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  setRowLoading(row, 'unaudit')
  try {
    await axios.put('/api/supply-chain/purchase-quotations/unaudit', { id: row.id })
    ElMessage.success('已反审')
    loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '操作失败'))
  } finally {
    setRowLoading(row, '')
  }
}

async function softDeleteRow(row) {
  if (passIsAudited(row)) {
    await ElMessageBox.alert('该数据已审核，需先反审后才能删除。', '提示', { type: 'warning' })
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认要删除【${docLabel(row)}】吗？删除后将移入回收站，可在回收站恢复。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  setRowLoading(row, 'delete')
  try {
    await axios.delete(`/api/supply-chain/purchase-quotations/${row.id}`)
    ElMessage.success('已移入回收站')
    loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '删除失败'))
  } finally {
    setRowLoading(row, '')
  }
}

async function restoreRow(row) {
  try {
    await ElMessageBox.confirm(`确认要恢复【${docLabel(row)}】吗？`, '恢复确认', {
      type: 'info',
      confirmButtonText: '恢复',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  setRowLoading(row, 'restore')
  try {
    await axios.put('/api/supply-chain/purchase-quotations/restore', { id: row.id })
    ElMessage.success('已恢复')
    loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '恢复失败'))
  } finally {
    setRowLoading(row, '')
  }
}

async function permanentDeleteRow(row) {
  try {
    await ElMessageBox.confirm(
      `确认要彻底删除【${docLabel(row)}】吗？该操作不可恢复。`,
      '危险操作',
      {
        type: 'error',
        confirmButtonText: '彻底删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }
  setRowLoading(row, 'permanent')
  try {
    await axios.delete(`/api/supply-chain/purchase-quotations/${row.id}/permanent`)
    ElMessage.success('已彻底删除')
    loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '删除失败'))
  } finally {
    setRowLoading(row, '')
  }
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
.page-desc code {
  font-size: 12px;
}
.search-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.error-alert,
.audit-alert {
  margin-bottom: 12px;
}
.btn-view .btn-icon {
  margin-right: 4px;
}
.code-bold {
  font-weight: 600;
}
.pager-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
.pq-main-table :deep(.el-table__body-wrapper .el-table__body tr) {
  cursor: pointer;
}
.expand-inner {
  padding: 8px 12px 12px;
  background: var(--el-fill-color-lighter);
}
.sub-title {
  margin: 12px 0 8px;
  font-size: 14px;
  font-weight: 600;
}
.detail-wrap .sub-title:first-child {
  margin-top: 0;
}
.lines-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.header-form {
  max-height: 280px;
  overflow: auto;
}
/* 新增/编辑弹窗：加宽不改占比前提下放大字号与行距，避免「大屏宽、字显小」 */
.pq-edit-dialog :deep(.el-dialog__header) {
  padding-bottom: 12px;
  margin-right: 0;
}
.pq-edit-dialog :deep(.el-dialog__title) {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0.02em;
}
.pq-edit-dialog :deep(.el-dialog__body) {
  padding-top: 8px;
  font-size: 15px;
  line-height: 1.55;
}
.pq-edit-dialog :deep(.el-dialog__footer) {
  padding-top: 16px;
}
.pq-edit-dialog :deep(.el-dialog__footer .el-button) {
  font-size: 15px;
  padding: 10px 22px;
}
.pq-edit-tabs {
  margin-top: -4px;
}
.pq-edit-dialog .pq-edit-tabs :deep(.el-tabs__item) {
  font-size: 15px;
  padding: 0 20px;
  height: 42px;
  line-height: 42px;
}
.pq-edit-dialog .pq-edit-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}
.pq-basic-form {
  padding-top: 8px;
}
.pq-edit-dialog .pq-basic-form :deep(.el-form-item) {
  margin-bottom: 18px;
}
.pq-edit-dialog .pq-basic-form :deep(.el-form-item__label) {
  font-size: 15px;
  line-height: 36px;
  color: var(--el-text-color-primary);
}
.pq-edit-dialog .pq-basic-form :deep(.el-input__inner),
.pq-edit-dialog .pq-basic-form :deep(.el-textarea__inner) {
  font-size: 15px;
}
.pq-edit-dialog .pq-basic-form :deep(.el-input__wrapper) {
  font-size: 15px;
}
.pq-edit-dialog .pq-basic-form :deep(.el-select .el-select__wrapper),
.pq-edit-dialog .pq-basic-form :deep(.el-select__placeholder) {
  font-size: 15px;
}
.pq-edit-dialog .pq-basic-form :deep(.el-date-editor .el-input__wrapper) {
  font-size: 15px;
}
.pq-edit-dialog .pq-docno-row :deep(.el-button) {
  font-size: 14px;
}
.pq-lines-hint {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.pq-docno-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  align-items: center;
}
.pq-docno-row .el-input {
  flex: 1;
  min-width: 160px;
}
/* 明细横向滚动条与编码区留白，避免误点滚动条 */
.pq-edit-dialog .pq-lines-table :deep(.el-table),
.pq-edit-dialog .pq-lines-table :deep(.el-table__header .cell),
.pq-edit-dialog .pq-lines-table :deep(.el-table__body .cell) {
  font-size: 14px;
}
.pq-edit-dialog .pq-lines-table :deep(.el-input__inner) {
  font-size: 14px;
}
.pq-lines-table :deep(.el-table__body-wrapper) {
  padding-bottom: 12px;
}
.pq-code-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}
.pq-code-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pq-material-search-btn {
  flex-shrink: 0;
}
.pq-cell-readonly {
  color: var(--el-text-color-regular);
}
</style>
