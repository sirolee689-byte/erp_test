<template>
  <div class="erp-module-page assist-order-page" :class="{ 'assist-order-page--form': isFormPanel }">
    <div class="assist-mode-bar">
      <el-button
        :type="pageMode === 'manage' ? 'primary' : 'default'"
        plain
        @click="switchToManage"
      >
        管理外协订单
      </el-button>
      <el-button
        v-permission="'add'"
        :type="pageMode === 'create' ? 'primary' : 'default'"
        plain
        @click="switchToCreate"
      >
        外协订单添加
      </el-button>
    </div>

    <div v-show="pageMode === 'manage'" class="assist-manage-panel">
    <div class="assist-toolbar">
      <div class="assist-toolbar__actions">
        <el-button :disabled="printSelectedCount === 0" @click="openBatchPrint">批量打印</el-button>
        <el-button :loading="loading" @click="loadData">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="assist-alert" />

    <div class="assist-filter-bar">
      <div class="assist-filter-row">
        <el-select
          v-model="filters.supplier"
          clearable
          filterable
          remote
          reserve-keyword
          class="assist-filter-select"
          :remote-method="fetchSupplierOptions"
          :loading="supplierLoading"
          placeholder="外协商"
        >
          <el-option
            v-for="item in supplierOptions"
            :key="item.code"
            :label="`${item.code} ${item.name}`"
            :value="item.code"
          />
        </el-select>
        <el-select v-model="filters.assistType" clearable class="assist-filter-select" placeholder="外协类型">
          <el-option label="其他外协" value="0" />
          <el-option label="订单外协" value="1" />
          <el-option label="订单外发" value="2" />
        </el-select>
        <el-select v-model="filters.keywordField" clearable class="assist-filter-select" placeholder="条件项目">
          <el-option label="全部字段" value="" />
          <el-option label="外协订单号" value="assistOrderNo" />
          <el-option label="外协日期" value="assistDate" />
          <el-option label="关联单号" value="referenceNo" />
          <el-option label="备注" value="remark" />
        </el-select>
      </div>
      <div class="assist-filter-row">
        <el-input
          v-model="filters.keyword"
          clearable
          class="assist-keyword-input"
          :placeholder="keywordPlaceholder"
          @keyup.enter="onSearch"
        />
        <el-button type="primary" size="small" @click="onSearch">查询</el-button>
        <div class="audit-switch">
          <span class="switch-label">回收站</span>
          <el-switch v-model="filters.recycled" @change="onRecycleChange" />
        </div>
        <div v-if="!filters.recycled" class="audit-switch">
          <span class="switch-label">显示未审核</span>
          <el-switch v-model="filters.showUnaudited" @change="onSearch" />
        </div>
        <el-button size="small" @click="onReset">重置</el-button>
      </div>
    </div>

    <el-alert
      v-if="filters.recycled"
      title="当前为回收站视图：可恢复或彻底删除（不可恢复）。"
      type="info"
      show-icon
      class="audit-alert"
    />
    <el-alert
      v-else-if="filters.showUnaudited"
      title="当前显示：未审核外协订单"
      type="warning"
      show-icon
      class="audit-alert"
    />

    <div class="pagination-row pagination-row--top">
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

    <el-skeleton :loading="loading" animated :rows="8">
      <template #default>
        <ErpTableViewportHScroll>
        <el-table
          ref="listTableRef"
          :data="tableList"
          row-key="id"
          border
          stripe
          class="erp-list-table assist-table"
          style="width: 100%"
          :empty-text="loading ? '加载中...' : '暂无外协订单'"
          @expand-change="onExpandChange"
          @row-click="onListRowClick"
        >
      <el-table-column type="expand">
        <template #default="{ row }">
          <div v-loading="row.expandedLoading" class="assist-expand-inner">
          <el-table
            v-if="(row.expandedLines || []).length"
            :data="row.expandedLines || []"
            border
            size="small"
            class="assist-expand-lines-table"
            show-summary
            :summary-method="(param) => expandSummaryMethod(row.expandedLines, param)"
          >
            <el-table-column label="序号" width="70">
              <template #default="{ $index }">{{ $index + 1 }}</template>
            </el-table-column>
            <el-table-column label="款号" prop="product" min-width="120" show-overflow-tooltip />
            <el-table-column label="物料编码" prop="kcaa01" min-width="150" show-overflow-tooltip />
            <el-table-column label="名称" prop="kcaa02" min-width="160" show-overflow-tooltip />
            <el-table-column label="数量" prop="wxak03" width="90" align="right" />
            <el-table-column label="不含税单价" prop="wxak04" width="110" align="right" />
            <el-table-column label="含税单价" prop="wxak041" width="110" align="right" />
            <el-table-column label="不含税金额" prop="wxak05" width="110" align="right" />
            <el-table-column label="含税金额" prop="wxak051" width="110" align="right" />
            <el-table-column label="税点" prop="tax" width="90" align="right" />
            <el-table-column label="交货日期" width="110">
              <template #default="{ row: line }">{{ formatDate(line.deliveryDate) }}</template>
            </el-table-column>
            <el-table-column label="参考单号" prop="referenceNo" min-width="120" show-overflow-tooltip />
            <el-table-column label="备注" prop="remark" min-width="160" show-overflow-tooltip />
          </el-table>
          <el-empty v-else-if="!row.expandedLoading" description="暂无明细" />
          </div>
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        :width="assistOrderActionsColWidth"
        fixed="left"
        align="left"
        header-align="center"
        class-name="erp-col-actions"
      >
        <template #default="{ row }">
          <div class="action-bar assist-order-actions">
            <template v-if="filters.recycled">
              <el-button type="primary" plain size="small" @click.stop="runLifecycle(row, 'restore')">恢复</el-button>
              <el-button type="danger" plain size="small" @click.stop="runLifecycle(row, 'hard-delete')">彻底删除</el-button>
            </template>
            <template v-else>
              <el-button plain size="small" @click.stop="openView(row)">查看</el-button>
              <template v-if="!isAudited(row)">
                <el-button
                  type="primary"
                  plain
                  size="small"
                  :disabled="!canEdit(row)"
                  @click.stop="openEdit(row)"
                >
                  编辑
                </el-button>
                <el-button
                  plain
                  size="small"
                  :disabled="!canAudit(row)"
                  @click.stop="runLifecycle(row, 'audit')"
                >
                  审核
                </el-button>
                <el-button
                  type="danger"
                  plain
                  size="small"
                  :disabled="!canDelete(row)"
                  @click.stop="runLifecycle(row, 'delete')"
                >
                  删除
                </el-button>
              </template>
              <template v-else>
                <el-button
                  v-if="canUnaudit(row)"
                  plain
                  size="small"
                  @click.stop="runLifecycle(row, 'unaudit')"
                >
                  反审
                </el-button>
                <el-button
                  v-if="canClose(row)"
                  plain
                  size="small"
                  @click.stop="runLifecycle(row, 'close')"
                >
                  结案
                </el-button>
                <el-button
                  v-if="canUnclose(row)"
                  plain
                  size="small"
                  @click.stop="runLifecycle(row, 'unclose')"
                >
                  反结案
                </el-button>
              </template>
              <el-button
                plain
                size="small"
                :type="isPrintSelected(row) ? 'primary' : 'default'"
                @click.stop="togglePrintSelect(row)"
              >
                {{ isPrintSelected(row) ? '已选择' : '打印选择' }}
              </el-button>
            </template>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="结案" width="88">
        <template #default="{ row }">
          <el-tag v-if="isClosed(row)" type="success" size="small">已结案</el-tag>
          <el-tag v-else type="info" size="small">未结案</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="外协类型" width="108">
        <template #default="{ row }">{{ assistTypeText(row.assistType) }}</template>
      </el-table-column>
      <el-table-column label="外协订单号" prop="assistOrderNo" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="code-text">{{ formatCell(row.assistOrderNo) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="外协日期" width="116">
        <template #default="{ row }">{{ formatDate(row.assistDate) }}</template>
      </el-table-column>
      <el-table-column label="交货日期" width="116">
        <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
      </el-table-column>
      <el-table-column label="外协订单数据" min-width="500" class-name="assist-order-data-col">
        <template #default="{ row }">
          <div class="assist-order-data">
            <div class="assist-order-data__line">{{ assistOrderDataLines(row).line1 }}</div>
            <div class="assist-order-data__line">{{ assistOrderDataLines(row).line2 }}</div>
            <div class="assist-order-data__line">{{ assistOrderDataLines(row).line3 }}</div>
            <div class="assist-order-data__line">{{ assistOrderDataLines(row).line4 }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="关联单号" prop="referenceNo" min-width="140" show-overflow-tooltip />
      <el-table-column label="币别" prop="currencyCode" width="92" show-overflow-tooltip />
      <el-table-column label="外协商" prop="supplierName" min-width="220" show-overflow-tooltip />
      <el-table-column label="备注" prop="remark" min-width="180" show-overflow-tooltip />
      <el-table-column label="打印注释" prop="notes" min-width="180" show-overflow-tooltip />
      <el-table-column label="审核" width="88">
        <template #default="{ row }">
          <el-tag v-if="isAudited(row)" type="success" size="small">已审核</el-tag>
          <el-tag v-else type="warning" size="small">未审核</el-tag>
        </template>
      </el-table-column>
        </el-table>
        </ErpTableViewportHScroll>

        <div v-if="tableList.length" class="assist-page-subtotal">
          <span class="assist-page-subtotal__label">小计：</span>
          <span class="assist-page-subtotal__cell assist-page-subtotal__cell--qty">
            <span class="assist-page-subtotal__head">数量</span>
            <span class="assist-page-subtotal__val">{{ formatSubtotalQty(pageSubtotal.quantity) }}</span>
          </span>
          <span class="assist-page-subtotal__cell">
            <span class="assist-page-subtotal__head">单价</span>
            <span class="assist-page-subtotal__val">{{ formatSubtotalUnitPrice(pageSubtotal.unitPriceEx) }}</span>
          </span>
          <span class="assist-page-subtotal__cell">
            <span class="assist-page-subtotal__head">单价（含税）</span>
            <span class="assist-page-subtotal__val">{{ formatSubtotalUnitPrice(pageSubtotal.unitPriceInc) }}</span>
          </span>
          <span class="assist-page-subtotal__cell">
            <span class="assist-page-subtotal__head">金额</span>
            <span class="assist-page-subtotal__val">{{ formatMoney(pageSubtotal.amountEx) }}</span>
          </span>
          <span class="assist-page-subtotal__cell">
            <span class="assist-page-subtotal__head">金额（含税）</span>
            <span class="assist-page-subtotal__val">{{ formatMoney(pageSubtotal.amountInc) }}</span>
          </span>
        </div>

        <div class="pagination-row pagination-row--bottom">
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
    </div>

    <div
      v-show="isFormPanel"
      ref="createPanelRef"
      v-loading="pageMode === 'edit' && detailLoading"
      class="assist-create-panel"
    >
      <AssistOrderEditForm
        ref="activeFormRef"
        :model="editForm"
        :rules="editRules"
        v-model:edit-tab="editTab"
        :footer-height="formFooterHeight"
        :supplier-options="supplierOptions"
        :supplier-loading="supplierLoading"
        :currency-options="currencyOptions"
        @assist-date-change="onAssistDateChange"
        @assist-order-no-focus="onAssistOrderNoFocus"
        @assist-order-no-blur="onAssistOrderNoBlur"
        @fetch-supplier="fetchSupplierOptions"
        @delete-selected-lines="deleteSelectedLines"
        @delete-all-lines="deleteAllLines"
        @open-batch-add="openBatchAdd"
        @toggle-line-mark="toggleLineMark"
        @view-line-pi-bom="openLinePiBom"
        @line-tax-excluded-change="onLineTaxExcludedChange"
        @line-tax-included-change="onLineTaxIncludedChange"
        @add-fee-row="addFeesRow"
        @reset-fees="resetFeesTab"
      />
      <div ref="formFooterRef" class="assist-form-footer">
        <el-button type="primary" :loading="saveLoading" @click="onSave">立即提交</el-button>
        <el-button @click="onFormReset">重置</el-button>
      </div>
    </div>

    <el-dialog
      v-model="detailVisible"
      title="外协订单详情"
      width="1180px"
      top="5vh"
      destroy-on-close
      class="assist-detail-dialog"
    >
      <el-skeleton :loading="detailLoading" animated :rows="8">
        <template #default>
          <el-empty v-if="!detail.header" description="暂无详情" />
          <el-tabs v-else v-model="activeTab">
            <el-tab-pane label="外协订单基础资料" name="header">
              <el-descriptions :column="3" border>
                <el-descriptions-item label="外协订单号">{{ formatCell(detail.header.assistOrderNo) }}</el-descriptions-item>
                <el-descriptions-item label="外协日期">{{ formatDate(detail.header.assistDate) }}</el-descriptions-item>
                <el-descriptions-item label="外协类型">{{ assistTypeText(detail.header.assistType) }}</el-descriptions-item>
                <el-descriptions-item label="关联单号">{{ formatCell(detail.header.referenceNo) }}</el-descriptions-item>
                <el-descriptions-item label="外协商编码">{{ formatCell(detail.header.supplierCode) }}</el-descriptions-item>
                <el-descriptions-item label="外协商">{{ formatCell(detail.header.supplierName) }}</el-descriptions-item>
                <el-descriptions-item label="含税标记">{{ taxFlagText(detail.header.taxIncluded) }}</el-descriptions-item>
                <el-descriptions-item label="币别">{{ formatCell(detail.header.currencyName || detail.header.currencyCode) }}</el-descriptions-item>
                <el-descriptions-item label="交货日期">{{ formatDate(detail.header.deliveryDate) }}</el-descriptions-item>
                <el-descriptions-item label="单价小数位">{{ formatCell(detail.header.decimalPlaces) }}</el-descriptions-item>
                <el-descriptions-item label="审核状态">{{ isAudited(detail.header) ? '已审核' : '未审核' }}</el-descriptions-item>
                <el-descriptions-item label="结案状态">{{ isClosed(detail.header) ? '已结案' : '未结案' }}</el-descriptions-item>
                <el-descriptions-item label="系统编号">{{ formatCell(detail.header.systemCode) }}</el-descriptions-item>
                <el-descriptions-item label="备注" :span="3">{{ formatCell(detail.header.remark) }}</el-descriptions-item>
                <el-descriptions-item label="打印注释" :span="3">{{ formatCell(detail.header.notes) }}</el-descriptions-item>
              </el-descriptions>
            </el-tab-pane>

            <el-tab-pane label="外协订单明细" name="lines">
              <el-table :data="detail.lines" border stripe height="430" empty-text="暂无明细">
                <el-table-column label="序号" width="72">
                  <template #default="{ $index }">{{ $index + 1 }}</template>
                </el-table-column>
                <el-table-column label="款号/材料编码" prop="kcaa01" min-width="150" show-overflow-tooltip />
                <el-table-column label="中文名" prop="kcaa02" min-width="160" show-overflow-tooltip />
                <el-table-column label="数量" prop="wxak03" width="100" align="right" />
                <el-table-column label="不含税单价" prop="wxak04" width="120" align="right" />
                <el-table-column label="含税单价" prop="wxak041" width="120" align="right" />
                <el-table-column label="不含税金额" prop="wxak05" width="120" align="right" />
                <el-table-column label="含税金额" prop="wxak051" width="120" align="right" />
                <el-table-column label="税点" prop="tax" width="90" align="right" />
                <el-table-column label="交货日期" width="116">
                  <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
                </el-table-column>
                <el-table-column label="参考单号" prop="referenceNo" min-width="130" show-overflow-tooltip />
                <el-table-column label="备注" prop="remark" min-width="160" show-overflow-tooltip />
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="额外费用清单" name="fees">
              <el-table :data="detail.fees" border stripe height="430" empty-text="暂无额外费用">
                <el-table-column label="序号" width="72">
                  <template #default="{ $index }">{{ $index + 1 }}</template>
                </el-table-column>
                <el-table-column label="费用编码" prop="feeCode" min-width="140" show-overflow-tooltip />
                <el-table-column label="费用名称" prop="feeName" min-width="180" show-overflow-tooltip />
                <el-table-column label="费用金额" prop="money" width="120" align="right" />
                <el-table-column label="税点" prop="tax" width="100" align="right" />
                <el-table-column label="备注" prop="remark" min-width="200" show-overflow-tooltip />
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </template>
      </el-skeleton>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="printVisible" title="外协单打印预览" width="1180px" top="3vh" class="assist-print-dialog">
      <div class="assist-print-toolbar no-print">
        <span>每页行数</span>
        <el-input-number v-model="printSetup.rowsPerPage" :min="3" :max="15" :step="1" size="small" />
        <span>单价小数位</span>
        <el-input-number v-model="printSetup.priceDecimals" :min="2" :max="5" :step="1" size="small" />
        <el-button type="primary" :loading="printLoading" @click="reloadPrintData">刷新预览</el-button>
        <el-button type="success" :disabled="!printDocs.length" @click="printCurrentPreview">打印</el-button>
      </div>
      <el-skeleton :loading="printLoading" animated :rows="8">
        <template #default>
          <el-empty v-if="!printDocs.length" description="暂无打印数据" />
          <section v-for="doc in printDocs" v-else :key="doc.header.assistOrderNo" class="assist-print-doc">
            <article v-for="page in doc.pages" :key="`${doc.header.assistOrderNo}-${page.pageNo}`" class="assist-print-page">
              <h2>外协单</h2>
              <div class="assist-print-head">
                <span>加工商：{{ doc.header.supplierShortName || doc.header.supplierName }}</span>
                <span>结算方式：{{ doc.header.payFor || '-' }}</span>
                <span>联系人：{{ doc.header.contact || '-' }}</span>
                <span>电话：{{ doc.header.tel || '-' }}</span>
                <span>地址：{{ doc.header.address || '-' }}</span>
                <span>日期：{{ doc.header.date || '-' }}</span>
                <span>PI号：{{ doc.header.piNo || '-' }}</span>
                <span>币别：{{ doc.header.currencyName || '-' }}</span>
                <span>是否含税：{{ doc.header.taxFlag || '-' }}</span>
                <span>备注：{{ doc.header.remark || '-' }}</span>
              </div>
              <table class="assist-print-table">
                <thead>
                  <tr>
                    <th>序号</th>
                    <th>材料编码</th>
                    <th>材料名称/规格</th>
                    <th>对应款号</th>
                    <th>配件颜色</th>
                    <th>组别</th>
                    <th>单位</th>
                    <th>数量</th>
                    <th>单价</th>
                    <th>金额</th>
                    <th>交期</th>
                    <th>税点</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in page.rows" :key="`${page.pageNo}-${row.seq}`">
                    <td>{{ row.seq }}</td>
                    <td>{{ row.materialCode }}</td>
                    <td>
                      <div>{{ row.materialName }}</div>
                      <div>{{ row.spec }}</div>
                    </td>
                    <td>{{ row.product }}</td>
                    <td>{{ row.color }}</td>
                    <td>{{ row.group }}</td>
                    <td>{{ row.unit }}</td>
                    <td class="num">{{ row.quantity }}</td>
                    <td class="num">{{ row.price }}</td>
                    <td class="num">{{ row.amount }}</td>
                    <td>{{ row.deliveryDate }}</td>
                    <td>{{ row.tax }}</td>
                  </tr>
                </tbody>
              </table>
              <div class="assist-print-total">数量合计：{{ doc.totals.quantity }}　金额合计：{{ doc.totals.amount }}</div>
              <ol class="assist-print-terms">
                <li v-for="term in doc.contractTerms" :key="term">{{ term }}</li>
              </ol>
              <div class="assist-print-sign">
                <span>甲方：</span>
                <span>应付会计：</span>
                <span>乙方：</span>
                <span>盖章：</span>
                <span>厂长：</span>
                <span>日期：</span>
                <span>制表人：{{ doc.signature.makerName || '-' }}</span>
                <span>核对：</span>
              </div>
            </article>
          </section>
        </template>
      </el-skeleton>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import {
  recalcAssistOrderLineFromQuotedPrices,
  recalcAssistOrderLineFromTaxExcluded,
  recalcAssistOrderLineFromTaxIncluded,
} from '@/utils/assistOrderAmount'
import { getErpTableActionsColMinWidth } from '@/utils/erpTableActionsLayout'
import {
  calcAssistOrderExpandSubtotal,
  calcAssistOrderPageSubtotal,
} from '@/utils/assistOrderPageSubtotal'
import { refreshErpTableViewportHScroll } from '@/utils/erpTableViewportHScroll'
import AssistOrderEditForm from './AssistOrderEditForm.vue'
import {
  ASSIST_BATCH_MSG_ACCEPTED,
  ASSIST_BATCH_MSG_APPLY,
  ASSIST_BATCH_MSG_REJECTED,
  ASSIST_BATCH_REJECT_PI_MISMATCH,
  ASSIST_BATCH_REJECT_SUPPLIER_MISMATCH,
  ASSIST_BATCH_RESULT_PREFIX,
  buildAssistBatchSessionId,
  parseAssistBatchResultPayload,
  validateBatchApply,
  writeAssistBatchContext,
} from '@/utils/assistOrderBatchAdd'

defineOptions({ name: 'supply-chain-daily-outsourcing-order' })

const pageMode = ref('manage')
const createPanelInitialized = ref(false)

const listTableRef = ref(null)
const loading = ref(false)
const detailLoading = ref(false)
const saveLoading = ref(false)
const supplierLoading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const supplierOptions = ref([])
const currencyOptions = ref([])
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const detailVisible = ref(false)
const printVisible = ref(false)
const activeTab = ref('header')
const editTab = ref('header')
const editMode = ref('create')
const editId = ref(null)
const activeFormRef = ref(null)
const activeBatchSessionId = ref('')
const printSelectedIds = ref(new Set())
const printLoading = ref(false)
const printDocs = ref([])
const printIds = ref([])
const printSetup = reactive({
  rowsPerPage: 12,
  priceDecimals: 2,
})
const filters = reactive({
  keyword: '',
  keywordField: '',
  supplier: '',
  assistType: '',
  showUnaudited: false,
  recycled: false,
})
const detail = reactive({
  header: null,
  lines: [],
  fees: [],
})
const editForm = reactive(defaultEditForm())

const assistOrderActionsColWidth = computed(() => {
  if (filters.recycled) return getErpTableActionsColMinWidth(2)
  return getErpTableActionsColMinWidth(5)
})

const keywordPlaceholder = computed(() => {
  const field = String(filters.keywordField ?? '').trim()
  if (field === 'assistOrderNo') return '输入外协订单号'
  if (field === 'assistDate') return '输入外协日期，如 2026-06-09'
  if (field === 'referenceNo') return '输入关联单号'
  if (field === 'remark') return '输入备注'
  return '全字段模糊搜索'
})

const printSelectedCount = computed(() => printSelectedIds.value.size)

const pageSubtotal = computed(() => calcAssistOrderPageSubtotal(tableList.value))

const isFormPanel = computed(() => pageMode.value === 'create' || pageMode.value === 'edit')

const createPanelRef = ref(null)
const formFooterRef = ref(null)
const formFooterHeight = ref(56)
let formFooterRo = null

function syncFormFooterHeight() {
  const footer = formFooterRef.value
  const panel = createPanelRef.value
  if (!footer) return
  const h = Math.ceil(footer.getBoundingClientRect().height)
  if (h > 0) {
    formFooterHeight.value = h
    panel?.style.setProperty('--assist-form-footer-height', `${h}px`)
  }
}

function bindFormFooterObserver() {
  formFooterRo?.disconnect()
  formFooterRo = null
  if (!formFooterRef.value) return
  syncFormFooterHeight()
  formFooterRo = new ResizeObserver(() => syncFormFooterHeight())
  formFooterRo.observe(formFooterRef.value)
}

watch(isFormPanel, async (on) => {
  if (!on) {
    formFooterRo?.disconnect()
    formFooterRo = null
    return
  }
  await nextTick()
  bindFormFooterObserver()
})

watch([tableList, loading, () => filters.recycled], async () => {
  if (loading.value) return
  await nextTick()
  listTableRef.value?.doLayout?.()
  const el = listTableRef.value?.$el
  if (el) refreshErpTableViewportHScroll(el)
})

const editRules = computed(() => ({
  assistOrderNo: [{ required: true, message: '请输入外协订单号', trigger: 'blur' }],
  assistDate: [{ required: true, message: '请选择外协日期', trigger: 'change' }],
  assistType: [{ required: true, message: '请选择外协类型', trigger: 'change' }],
  referenceNo:
    editForm.assistType === '1' || editForm.assistType === '2'
      ? [{ required: true, message: '请输入关联单号', trigger: 'blur' }]
      : [],
  supplierCode: [{ required: true, message: '请选择外协商', trigger: 'change' }],
  taxIncluded: [{ required: true, message: '请选择含税标记', trigger: 'change' }],
  currencyCode: [{ required: true, message: '请选择币别', trigger: 'change' }],
  decimalPlaces: [{ required: true, message: '请输入单价小数位', trigger: 'change' }],
  deliveryDate: [
    {
      validator: (_rule, value, callback) => {
        if (!value) {
          callback()
          return
        }
        const assist = editForm.assistDate
        if (!assist) {
          callback()
          return
        }
        if (new Date(value) < new Date(assist)) {
          callback(new Error('交货日期不能早于外协日期'))
          return
        }
        callback()
      },
      trigger: 'change',
    },
  ],
}))

function todayYmd() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const DEFAULT_PRINT_NOTES =
  '注：仅加工，不含开料，不含包装     以上价格包含乙方送货至甲方的单程运费'

function defaultEditForm() {
  return {
    assistOrderNo: '',
    assistDate: todayYmd(),
    assistType: '1',
    referenceNo: '',
    referenceOrderId: null,
    supplierCode: '',
    taxIncluded: '1',
    currencyCode: '',
    deliveryDate: '',
    remark: '',
    notes: DEFAULT_PRINT_NOTES,
    decimalPlaces: 4,
    lines: [],
    fees: blankFeesRows(),
  }
}

function resetEditForm(next = {}) {
  Object.assign(editForm, defaultEditForm(), next)
  activeFormRef.value?.clearValidate?.()
}

function activeEditFormRef() {
  return isFormPanel.value ? activeFormRef.value : null
}

function formatCell(value) {
  const s = String(value ?? '').trim()
  return s || '-'
}

function formatDate(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10) || '-'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dateForInput(value) {
  const s = formatDate(value)
  return s === '-' ? '' : s
}

function normalizeLine(row = {}, index = 0) {
  return {
    seq: index + 1,
    _lineMarked: false,
    piNo: String(row.piNo ?? ''),
    product: String(row.product ?? ''),
    kcaa01: String(row.kcaa01 ?? ''),
    kcaa02: String(row.kcaa02 ?? ''),
    kcaa02En: String(row.kcaa02En ?? ''),
    invoiceName: String(row.invoiceName ?? ''),
    kcaa03: String(row.kcaa03 ?? ''),
    kcaa04: String(row.kcaa04 ?? ''),
    kcaa05: String(row.kcaa05 ?? ''),
    kcaa09: String(row.origin ?? row.kcaa09 ?? ''),
    kcaa10: String(row.kcaa10 ?? ''),
    kcaa11: String(row.kcaa11 ?? ''),
    version: String(row.version ?? ''),
    customerSupply: String(row.customerSupply ?? ''),
    wxak03: Number(row.wxak03 ?? row.orderQty ?? 0),
    wxak04: Number(row.wxak04 ?? 0),
    wxak041: Number(row.wxak041 ?? 0),
    wxak05: Number(row.wxak05 ?? 0),
    wxak051: Number(row.wxak051 ?? 0),
    tax: Number(row.tax ?? 0),
    deliveryDate: dateForInput(row.deliveryDate) || editForm.deliveryDate || '',
    referenceNo: String(row.referenceNo ?? editForm.referenceNo ?? ''),
    remark: String(row.remark ?? ''),
  }
}

/** DIY：额外费用 Tab 默认行数（重置/新建时） */
const ASSIST_FEE_ROW_COUNT = 5

const ASSIST_HEADER_TAB_PROPS = new Set([
  'assistOrderNo',
  'assistDate',
  'assistType',
  'referenceNo',
  'supplierCode',
  'taxIncluded',
  'currencyCode',
  'decimalPlaces',
  'deliveryDate',
])

function pickFirstValidationMessage(invalidFields) {
  if (!invalidFields || typeof invalidFields !== 'object') return ''
  for (const field of Object.keys(invalidFields)) {
    const errors = invalidFields[field]
    if (Array.isArray(errors) && errors[0]?.message) return String(errors[0].message)
  }
  return ''
}

function focusAssistEditTabForField(prop) {
  if (ASSIST_HEADER_TAB_PROPS.has(String(prop ?? '').trim())) {
    editTab.value = 'header'
  }
}

function normalizeFee(row = {}, index = 0) {
  return {
    seq: index + 1,
    feeCode: String(row.feeCode ?? row.kcaa01 ?? ''),
    feeName: String(row.feeName ?? row.kcaa02 ?? row.mtitle ?? ''),
    money: Number(row.money ?? 0),
    tax: Number(row.tax ?? 0),
    remark: String(row.remark ?? ''),
  }
}

function padFeesToFixedRows(fees) {
  const rows = (Array.isArray(fees) ? fees : []).map((fee, i) => normalizeFee(fee, i))
  while (rows.length < ASSIST_FEE_ROW_COUNT) {
    rows.push(normalizeFee({}, rows.length))
  }
  return rows
}

function blankFeesRows() {
  return padFeesToFixedRows([])
}

function addFeesRow() {
  editForm.fees.push(normalizeFee({}, editForm.fees.length))
}

function resetFeesTab() {
  editForm.fees = blankFeesRows()
}

function isAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

function isClosed(row) {
  return String(row?.closed ?? '').trim() === '1'
}

function canEdit(row) {
  return !isAudited(row) && !isClosed(row)
}

function isDeleted(row) {
  return String(row?.del ?? '').trim() === '1'
}

function canAudit(row) {
  return !isDeleted(row) && !isAudited(row)
}

function canUnaudit(row) {
  return !isDeleted(row) && isAudited(row) && !isClosed(row)
}

function canClose(row) {
  return !isDeleted(row) && isAudited(row) && !isClosed(row)
}

function canUnclose(row) {
  return !isDeleted(row) && isClosed(row)
}

function canDelete(row) {
  return !isDeleted(row) && !isAudited(row) && !isClosed(row)
}

function assistTypeText(value) {
  const s = String(value ?? '').trim()
  if (s === '1') return '订单外协'
  if (s === '2') return '订单外发'
  return '其他外协'
}

function taxFlagText(value) {
  const s = String(value ?? '').trim()
  if (s === '1') return '含税'
  if (s === '2') return '不含税'
  return '-'
}

function formatMoney(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '0.00'
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatSubtotalQty(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '0'
  if (Number.isInteger(num)) return String(num)
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

function formatSubtotalUnitPrice(n) {
  if (n === null || n === undefined) return '-'
  const num = Number(n)
  if (!Number.isFinite(num)) return '-'
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function expandSummaryMethod(expandedLines, { columns }) {
  const sub = calcAssistOrderExpandSubtotal(expandedLines)
  return columns.map((col) => {
    const prop = col.property
    if (prop === 'kcaa02') return '小计：'
    if (prop === 'wxak03') return formatSubtotalQty(sub.quantity)
    if (prop === 'wxak04') return formatSubtotalUnitPrice(sub.unitPriceEx)
    if (prop === 'wxak041') return formatSubtotalUnitPrice(sub.unitPriceInc)
    if (prop === 'wxak05') return formatMoney(sub.amountEx)
    if (prop === 'wxak051') return formatMoney(sub.amountInc)
    return ''
  })
}

function assistOrderDataLines(row) {
  const supplier = formatCell(row?.supplierName || row?.supplierCode)
  return {
    line1: `外协商：${supplier}`,
    line2: `${taxFlagText(row?.taxIncluded)}，总项数: ${row?.itemCount ?? 0}，总数量: ${row?.totalQty ?? 0}`,
    line3: `含税总价: ${formatMoney(row?.taxIncludedTotal)} 元，不含税总价: ${formatMoney(row?.taxExcludedTotal)} 元，税点总价: ${formatMoney(row?.taxDiffTotal)} 元`,
    line4: `额外费用：${formatMoney(row?.extraFeeTotal)} 元`,
  }
}

function isPrintSelected(row) {
  const id = Number(row?.id)
  return Number.isInteger(id) && id > 0 && printSelectedIds.value.has(id)
}

function togglePrintSelect(row) {
  const id = Number(row?.id)
  if (!Number.isInteger(id) || id <= 0) return
  const next = new Set(printSelectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  printSelectedIds.value = next
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await axios.get('/api/assist-order/list', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        keyword: filters.keyword,
        keywordField: filters.keywordField || '',
        supplier: filters.supplier,
        assistType: filters.assistType,
        showUnaudited: filters.showUnaudited ? '1' : '',
        recycled: filters.recycled ? '1' : '',
      },
    })
    const body = res.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '读取外协订单列表失败')
    tableList.value = Array.isArray(body.data?.list) ? body.data.list : []
    total.value = Number(body.data?.total ?? 0)
  } catch (err) {
    errorMessage.value = err?.response?.data?.msg || err?.message || '读取外协订单列表失败'
    tableList.value = []
    total.value = 0
  } finally {
    printSelectedIds.value = new Set()
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadData()
}

function onRecycleChange() {
  page.value = 1
  if (filters.recycled) {
    filters.showUnaudited = false
  }
  loadData()
}

function onReset() {
  filters.keyword = ''
  filters.keywordField = ''
  filters.supplier = ''
  filters.assistType = ''
  filters.showUnaudited = false
  filters.recycled = false
  page.value = 1
  loadData()
}

function onPageSizeChange() {
  page.value = 1
  loadData()
}

function onPageChange() {
  loadData()
}

async function fetchSupplierOptions(keyword = '') {
  supplierLoading.value = true
  try {
    const res = await axios.get('/api/assist-order/supplier-options', { params: { keyword } })
    const body = res.data ?? {}
    supplierOptions.value = Array.isArray(body.data?.list) ? body.data.list : []
  } catch {
    supplierOptions.value = []
  } finally {
    supplierLoading.value = false
  }
}

async function fetchCurrencyOptions() {
  const res = await axios.get('/api/assist-order/currency-options')
  const body = res.data ?? {}
  currencyOptions.value = Array.isArray(body.data?.list) ? body.data.list : []
}

async function fetchSuggestedNo() {
  const res = await axios.get('/api/assist-order/suggest-doc-no', {
    params: { saveDate: editForm.assistDate },
  })
  const suggested = String(res.data?.data?.suggested ?? '').trim()
  if (suggested) editForm.assistOrderNo = suggested
  return suggested
}

async function checkAssistOrderNo(options = {}) {
  const { silent = false } = options
  const code = String(editForm.assistOrderNo ?? '').trim()
  if (!code) return null
  const params = { assistOrderNo: code }
  if (editMode.value === 'edit' && editId.value) {
    params.excludeId = editId.value
  }
  try {
    const res = await axios.get('/api/assist-order/check-doc-no', { params })
    const available = Boolean(res.data?.data?.available)
    const message = String(res.data?.data?.message ?? res.data?.msg ?? '').trim()
    if (!silent) {
      if (available) ElMessage.success('该单号可以使用')
      else ElMessage.error(message || '该外协单号已在在册记录中存在')
    }
    return { available, message }
  } catch (err) {
    if (!silent) {
      ElMessage.error(err?.response?.data?.msg || err?.message || '检测外协单号失败')
    }
    return null
  }
}

async function onAssistOrderNoFocus() {
  if (editMode.value !== 'create') return
  if (String(editForm.assistOrderNo ?? '').trim()) return
  await fetchSuggestedNo()
  await checkAssistOrderNo()
}

async function onAssistOrderNoBlur() {
  if (!String(editForm.assistOrderNo ?? '').trim()) return
  await checkAssistOrderNo()
}

function switchToManage() {
  if (pageMode.value === 'manage') return
  pageMode.value = 'manage'
}

async function switchToCreate() {
  if (pageMode.value === 'create') return
  const preserveDraft =
    createPanelInitialized.value &&
    editMode.value === 'create' &&
    pageMode.value !== 'edit'

  pageMode.value = 'create'
  editMode.value = 'create'
  editId.value = null
  editTab.value = 'header'

  if (!preserveDraft) {
    resetEditForm()
    await fetchSuggestedNo()
  }
  if (!createPanelInitialized.value) {
    await Promise.all([fetchSupplierOptions(''), fetchCurrencyOptions()])
  }
  createPanelInitialized.value = true
}

async function resolveOrderIdByPi(piNo) {
  const keyword = String(piNo ?? '').trim()
  if (!keyword) return null
  try {
    const res = await axios.get('/api/sales-order/pi-suggest', { params: { keyword } })
    const list = Array.isArray(res?.data?.data?.list) ? res.data.data.list : []
    const row = list.find((item) => String(item.piNo ?? '').trim() === keyword)
    const id = Number(row?.id ?? 0)
    return Number.isFinite(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

async function applyDetailToEditForm(data) {
  const h = data?.header || {}
  resetEditForm({
    assistOrderNo: String(h.assistOrderNo ?? ''),
    assistDate: dateForInput(h.assistDate),
    assistType: String(h.assistType ?? '0'),
    referenceNo: String(h.referenceNo ?? ''),
    supplierCode: String(h.supplierCode ?? ''),
    taxIncluded: String(h.taxIncluded ?? '1') === '2' ? '2' : '1',
    currencyCode: String(h.currencyCode ?? ''),
    deliveryDate: dateForInput(h.deliveryDate),
    remark: String(h.remark ?? ''),
    notes: String(h.notes ?? ''),
    decimalPlaces: Number(h.decimalPlaces ?? 4),
    lines: [...(data?.lines || [])]
      .sort((a, b) => Number(b?.seq ?? 0) - Number(a?.seq ?? 0))
      .map((line, index) => normalizeLine(line, index)),
    fees: padFeesToFixedRows(data?.fees),
  })
  renumberLines()
  const refNo = String(editForm.referenceNo ?? '').trim()
  editForm.referenceOrderId = refNo ? await resolveOrderIdByPi(refNo) : null
}

async function onFormReset() {
  if (pageMode.value === 'create') {
    resetEditForm()
    editTab.value = 'header'
    await Promise.all([fetchSupplierOptions(''), fetchCurrencyOptions(), fetchSuggestedNo()])
    return
  }
  if (pageMode.value === 'edit' && editId.value) {
    detailLoading.value = true
    try {
      const data = await loadDetail(editId.value)
      applyDetailToEditForm(data)
      editTab.value = 'header'
    } catch (err) {
      ElMessage.error(err?.response?.data?.msg || err?.message || '重置失败')
    } finally {
      detailLoading.value = false
    }
  }
}

async function openEdit(row) {
  if (!canEdit(row)) return
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.warning('外协订单参数无效')
    return
  }
  editMode.value = 'edit'
  editId.value = id
  editTab.value = 'header'
  pageMode.value = 'edit'
  createPanelInitialized.value = true
  detailLoading.value = true
  try {
    await Promise.all([fetchSupplierOptions(''), fetchCurrencyOptions()])
    const data = await loadDetail(id)
    applyDetailToEditForm(data)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取外协订单详情失败')
    pageMode.value = 'manage'
    editId.value = null
  } finally {
    detailLoading.value = false
  }
}

async function onAssistDateChange() {
  if (editMode.value === 'create') await fetchSuggestedNo()
  if (editForm.deliveryDate && editForm.assistDate) {
    if (new Date(editForm.deliveryDate) < new Date(editForm.assistDate)) {
      editForm.deliveryDate = ''
      ElMessage.warning('交货日期不能早于外协日期，已清空交货日期')
    }
  }
  await nextTick()
  activeEditFormRef()?.validateField?.('deliveryDate')
}

async function loadDetail(id) {
  const res = await axios.get(`/api/assist-order/${id}`)
  const body = res.data ?? {}
  if (body.code !== 200) throw new Error(body.msg || '读取外协订单详情失败')
  return {
    header: body.data?.header || null,
    lines: Array.isArray(body.data?.lines) ? body.data.lines : [],
    fees: Array.isArray(body.data?.fees) ? body.data.fees : [],
  }
}

function buildExpandedDisplayRows(lines, fees) {
  const lineRows = Array.isArray(lines) ? lines : []
  const feeRows = (Array.isArray(fees) ? fees : []).map((fee) => ({
    _rowType: 'fee',
    product: '',
    kcaa01: '',
    kcaa02: String(fee.feeName ?? fee.kcaa02 ?? fee.mtitle ?? ''),
    wxak03: '',
    wxak04: '',
    wxak041: '',
    wxak05: '',
    wxak051: fee.money,
    tax: fee.tax,
    deliveryDate: '',
    referenceNo: '',
    remark: String(fee.remark ?? ''),
  }))
  return [...lineRows, ...feeRows]
}

async function onExpandChange(row, expandedRows) {
  const expanded = expandedRows.some((item) => item.id === row.id)
  if (!expanded) return
  if (row.expandedLoaded) return
  row.expandedLoading = true
  try {
    const data = await loadDetail(row.id)
    row.expandedLines = buildExpandedDisplayRows(data.lines, data.fees)
    row.expandedLoaded = true
  } catch (err) {
    row.expandedLines = []
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取明细失败')
  } finally {
    row.expandedLoading = false
  }
}

function onListRowClick(row, column, event) {
  if (!row?.id || !listTableRef.value) return
  const target = event?.target
  if (target && typeof target.closest === 'function') {
    if (target.closest('.el-button, button, a, input, textarea, select')) return
    if (target.closest('.el-table__expand-icon')) return
  }
  if (column?.type === 'expand') return
  listTableRef.value.toggleRowExpansion(row)
}

function renumberLines() {
  const total = editForm.lines.length
  editForm.lines.forEach((line, i) => {
    line.seq = total - i
  })
}

async function deleteSelectedLines() {
  const marked = editForm.lines.filter((line) => line._lineMarked)
  if (!marked.length) {
    ElMessage.warning('请先在操作列点击删除标记要移除的行')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除已标记的 ${marked.length} 条明细吗？此操作仅影响当前页面，点「立即提交」后才会落库。`,
      '删除选定明细',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }
  const removeSet = new Set(marked)
  editForm.lines = editForm.lines.filter((line) => !removeSet.has(line))
  renumberLines()
  ElMessage.success('已删除选定明细')
}

async function deleteAllLines() {
  if (!editForm.lines.length) {
    ElMessage.warning('当前没有明细行')
    return
  }
  try {
    await ElMessageBox.confirm('确认要删除全部明细行吗？此操作仅影响当前页面，点「立即提交」后才会落库。', '删除全部明细', {
      type: 'warning',
      confirmButtonText: '删除全部',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  editForm.lines = []
  ElMessage.success('已清空全部明细')
}

function buildBatchCurrentLines() {
  return editForm.lines.map((line) => ({
    piNo: line.piNo || editForm.referenceNo,
    product: line.product,
    kcaa01: line.kcaa01,
    wxak03: line.wxak03,
  }))
}

function applyBatchAddLines(lines) {
  const list = Array.isArray(lines) ? lines : []
  if (!list.length) return
  const newLines = list.map((row) => {
    const line = normalizeLine(row, 0)
    applyLineCalc(line, recalcAssistOrderLineFromQuotedPrices(line, { priceDecimals: editForm.decimalPlaces }))
    return line
  })
  editForm.lines.unshift(...newLines)
  renumberLines()
  ElMessage.success(`已批量添加 ${list.length} 条明细`)
}

function openBatchAdd() {
  const assistType = String(editForm.assistType ?? '')
  if (assistType !== '0' && assistType !== '1' && assistType !== '2') {
    ElMessage.warning('当前外协类型暂不支持批量添加，后续版本开放')
    return
  }
  const piNo = String(editForm.referenceNo ?? '').trim()
  if (assistType !== '0' && !piNo) {
    ElMessage.warning('订单外协须先填写关联 PI 号')
    return
  }
  const supplierCode = String(editForm.supplierCode ?? '').trim()
  if (!supplierCode) {
    ElMessage.warning('\u8bf7\u5148\u9009\u62e9\u5916\u534f\u5546\uff0c\u624d\u80fd\u6279\u91cf\u6dfb\u52a0\u5e76\u81ea\u52a8\u5e26\u51fa\u5355\u4ef7')
    return
  }
  const sessionId = buildAssistBatchSessionId()
  activeBatchSessionId.value = sessionId
  writeAssistBatchContext(sessionId, {
    piNo,
    supplierCode,
    assistType,
    excludeOrderNo: editMode.value === 'edit' ? String(editForm.assistOrderNo ?? '').trim() : '',
    deliveryDate: editForm.deliveryDate,
    decimalPlaces: editForm.decimalPlaces,
    currentLines: buildBatchCurrentLines(),
  })
  const url = `/supply-chain/daily/outsourcing-order-batch-window?sessionId=${encodeURIComponent(sessionId)}${piNo ? `&piNo=${encodeURIComponent(piNo)}` : ''}`
  const opened = window.open(url, '_blank')
  if (!opened) {
    ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
  }
}

function handleBatchStorageEvent(event) {
  const key = String(event?.key ?? '')
  if (!key.startsWith(ASSIST_BATCH_RESULT_PREFIX)) return
  const sessionId = key.slice(ASSIST_BATCH_RESULT_PREFIX.length)
  if (sessionId !== activeBatchSessionId.value) return
  const payload = parseAssistBatchResultPayload(event?.newValue)
  if (!payload?.lines?.length) return
  const validation = validateBatchApply({
    openedPiNo: payload.openedPiNo,
    currentPiNo: editForm.referenceNo,
    openedSupplierCode: payload.openedSupplierCode,
    currentSupplierCode: editForm.supplierCode,
    requirePi: String(editForm.assistType ?? '') !== '0',
  })
  if (!validation.ok) {
    if (validation.reason === ASSIST_BATCH_REJECT_PI_MISMATCH) {
      ElMessage.warning('\u5173\u8054 PI \u5df2\u53d8\u66f4\uff0c\u6279\u91cf\u9009\u6750\u5df2\u53d6\u6d88')
    } else if (validation.reason === ASSIST_BATCH_REJECT_SUPPLIER_MISMATCH) {
      ElMessage.warning('\u5916\u534f\u5546\u5df2\u53d8\u66f4\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u6279\u91cf\u9009\u6750')
    }
    activeBatchSessionId.value = ''
    return
  }
  applyBatchAddLines(payload.lines)
  activeBatchSessionId.value = ''
}

function postBatchMessageToSource(source, payload) {
  if (!source || typeof source.postMessage !== 'function') return
  source.postMessage(payload, window.location.origin)
}

function handleBatchMessage(event) {
  if (event.origin !== window.location.origin) return
  const data = event.data
  if (!data || data.type !== ASSIST_BATCH_MSG_APPLY) return
  const sessionId = String(data.sessionId ?? '').trim()
  if (!sessionId || sessionId !== activeBatchSessionId.value) return

  const validation = validateBatchApply({
    openedPiNo: data.openedPiNo,
    currentPiNo: editForm.referenceNo,
    openedSupplierCode: data.openedSupplierCode,
    currentSupplierCode: editForm.supplierCode,
    requirePi: String(editForm.assistType ?? '') !== '0',
  })
  if (!validation.ok) {
    if (validation.reason === ASSIST_BATCH_REJECT_PI_MISMATCH) {
      ElMessage.warning('\u5173\u8054 PI \u5df2\u53d8\u66f4\uff0c\u6279\u91cf\u9009\u6750\u5df2\u53d6\u6d88')
    } else if (validation.reason === ASSIST_BATCH_REJECT_SUPPLIER_MISMATCH) {
      ElMessage.warning('\u5916\u534f\u5546\u5df2\u53d8\u66f4\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u6279\u91cf\u9009\u6750')
    }
    postBatchMessageToSource(event.source, {
      type: ASSIST_BATCH_MSG_REJECTED,
      sessionId,
      reason: validation.reason,
    })
    return
  }

  const lines = Array.isArray(data.lines) ? data.lines : []
  if (!lines.length) {
    postBatchMessageToSource(event.source, {
      type: ASSIST_BATCH_MSG_REJECTED,
      sessionId,
      reason: 'empty-lines',
    })
    return
  }

  applyBatchAddLines(lines)
  activeBatchSessionId.value = ''
  postBatchMessageToSource(event.source, {
    type: ASSIST_BATCH_MSG_ACCEPTED,
    sessionId,
    lineCount: lines.length,
  })
}

function toggleLineMark(row) {
  if (!row) return
  row._lineMarked = !row._lineMarked
}

async function openLinePiBom(row) {
  const product = String(row?.product ?? '').trim()
  if (!product) {
    ElMessage.warning('该行缺少款号，无法打开 PI-BOM')
    return
  }
  let orderId = Number(editForm.referenceOrderId ?? 0)
  if (!Number.isFinite(orderId) || orderId <= 0) {
    const refNo = String(editForm.referenceNo ?? '').trim()
    if (!refNo) {
      ElMessage.warning('请先填写关联 PI 号')
      return
    }
    orderId = await resolveOrderIdByPi(refNo)
    if (orderId) editForm.referenceOrderId = orderId
  }
  if (!orderId) {
    ElMessage.warning('无法解析销售订单，请确认关联 PI 号是否正确')
    return
  }
  const url = `/inventory/basic/pi-bom-data-window?mode=edit&orderId=${encodeURIComponent(orderId)}&kcaa01=${encodeURIComponent(product)}`
  const opened = window.open(url, '_blank')
  if (!opened) {
    ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
  }
}

function applyLineCalc(row, next) {
  Object.assign(row, next)
}

function onLineTaxExcludedChange(row) {
  applyLineCalc(row, recalcAssistOrderLineFromTaxExcluded(row, { priceDecimals: editForm.decimalPlaces }))
}

function onLineTaxIncludedChange(row) {
  applyLineCalc(row, recalcAssistOrderLineFromTaxIncluded(row, { priceDecimals: editForm.decimalPlaces }))
}

function openBatchPrint() {
  const rows = tableList.value.filter((row) => isPrintSelected(row))
  openPrint(rows)
}

async function openPrint(rows) {
  const ids = (Array.isArray(rows) ? rows : [])
    .map((row) => Number(row?.id))
    .filter((id) => Number.isInteger(id) && id > 0)
  if (!ids.length) {
    ElMessage.warning('请先选择要打印的外协订单')
    return
  }
  printIds.value = ids
  printVisible.value = true
  await reloadPrintData()
}

async function reloadPrintData() {
  if (!printIds.value.length) return
  printLoading.value = true
  try {
    const res = await axios.get('/api/assist-order/print-data', {
      params: {
        ids: printIds.value.join(','),
        rowsPerPage: printSetup.rowsPerPage,
        priceDecimals: printSetup.priceDecimals,
      },
    })
    const body = res.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '读取打印数据失败')
    printDocs.value = Array.isArray(body.data?.list) ? body.data.list : []
  } catch (err) {
    printDocs.value = []
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取打印数据失败')
  } finally {
    printLoading.value = false
  }
}

function printCurrentPreview() {
  document.documentElement.classList.add('print-assist-order')
  const cleanup = () => {
    document.documentElement.classList.remove('print-assist-order')
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  setTimeout(() => window.print(), 50)
}

async function openView(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.warning('外协订单参数无效')
    return
  }
  detailVisible.value = true
  detailLoading.value = true
  activeTab.value = 'header'
  detail.header = null
  detail.lines = []
  detail.fees = []
  try {
    const data = await loadDetail(id)
    detail.header = data.header
    detail.lines = data.lines
    detail.fees = data.fees
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取外协订单详情失败')
    detailVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

const LIFECYCLE_CONFIRM = {
  audit: (label) => ({
    message: `确认要审核外协订单【${label}】吗？审核后将锁定编辑与删除。`,
    title: '审核确认',
    options: { type: 'warning', confirmButtonText: '审核', cancelButtonText: '取消' },
  }),
  unaudit: (label) => ({
    message: `确认要反审外协订单【${label}】吗？反审后可再编辑保存。`,
    title: '反审确认',
    options: { type: 'warning', confirmButtonText: '反审', cancelButtonText: '取消' },
  }),
  close: (label) => ({
    message: `确认要结案外协订单【${label}】吗？结案后须先反结案才能反审。`,
    title: '结案确认',
    options: { type: 'warning', confirmButtonText: '结案', cancelButtonText: '取消' },
  }),
  unclose: (label) => ({
    message: `确认要反结案外协订单【${label}】吗？反结案后可再结案或反审。`,
    title: '反结案确认',
    options: { type: 'warning', confirmButtonText: '反结案', cancelButtonText: '取消' },
  }),
  delete: (label) => ({
    message: `确认要删除外协订单【${label}】吗？删除后将移入回收站，可在回收站恢复。`,
    title: '删除确认',
    options: { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
  }),
  'hard-delete': (label) => ({
    message: `确认要彻底删除外协订单【${label}】吗？该操作不可恢复。`,
    title: '危险操作',
    options: {
      type: 'error',
      confirmButtonText: '彻底删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    },
  }),
  restore: (label) => ({
    message: `确认要恢复外协订单【${label}】吗？`,
    title: '恢复确认',
    options: { type: 'info', confirmButtonText: '恢复', cancelButtonText: '取消' },
  }),
}

async function confirmAssistOrderLifecycle(row, action) {
  const factory = LIFECYCLE_CONFIRM[action]
  if (!factory) return true
  const label = formatCell(row.assistOrderNo)
  const { message, title, options } = factory(label)
  try {
    await ElMessageBox.confirm(message, title, options)
    return true
  } catch {
    return false
  }
}

async function runLifecycle(row, action) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.warning('外协订单参数无效')
    return
  }
  if (!(await confirmAssistOrderLifecycle(row, action))) return
  try {
    const res =
      action === 'delete'
        ? await axios.delete(`/api/assist-order/${id}`)
        : action === 'hard-delete'
          ? await axios.delete(`/api/assist-order/${id}/hard`)
          : await axios.post(`/api/assist-order/${id}/${action}`)
    const body = res.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '操作失败')
    ElMessage.success(body.msg || '操作成功')
    await loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '操作失败')
  }
}

async function onSave() {
  const form = activeEditFormRef()
  if (!form) return
  try {
    await form.validate()
  } catch (invalidFields) {
    const msg = pickFirstValidationMessage(invalidFields)
    ElMessage.warning(msg || '请完善必填项后再提交')
    focusAssistEditTabForField(Object.keys(invalidFields || {})[0])
    return
  }
  saveLoading.value = true
  try {
    const { lines: _lines, fees: _fees, referenceOrderId: _refOid, ...headerFields } = editForm
    const body = {
      header: headerFields,
      lines: editForm.lines.map((line, index) => {
        const { _lineMarked, ...rest } = line
        return { ...rest, seq: editForm.lines.length - index }
      }),
      fees: editForm.fees
        .filter((fee) => String(fee.feeCode ?? '').trim())
        .map((fee, index) => ({ ...fee, seq: index + 1 })),
    }
    const isCreateSave = pageMode.value === 'create'
    const res = isCreateSave
      ? await axios.post('/api/assist-order', body)
      : await axios.put(`/api/assist-order/${editId.value}`, body)
    const resp = res.data ?? {}
    if (resp.code !== 200) throw new Error(resp.msg || '保存失败')
    const finalNo = String(resp.data?.assistOrderNo ?? '').trim()
    ElMessage.success(resp.data?.changedOrderNo && finalNo ? `保存成功，最终单号：${finalNo}` : '保存成功')
    pageMode.value = 'manage'
    if (isCreateSave) {
      resetEditForm()
      createPanelInitialized.value = false
    }
    await loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '保存失败')
  } finally {
    saveLoading.value = false
  }
}

onMounted(async () => {
  window.addEventListener('storage', handleBatchStorageEvent)
  window.addEventListener('message', handleBatchMessage)
  await loadData()
})

onUnmounted(() => {
  formFooterRo?.disconnect()
  formFooterRo = null
  window.removeEventListener('storage', handleBatchStorageEvent)
  window.removeEventListener('message', handleBatchMessage)
})
</script>

<style scoped>
.assist-order-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* DIY：表单模式预留 ERP 顶栏高度，改 --assist-page-chrome */
.assist-order-page--form {
  --assist-page-chrome: 200px;
  --assist-form-footer-height: 56px;
  height: calc(100vh - var(--assist-page-chrome));
  overflow: hidden;
  gap: 8px;
}

.assist-order-page--form .assist-mode-bar {
  flex-shrink: 0;
  margin-bottom: 0;
}

.assist-mode-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.assist-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
}

.assist-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.assist-create-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.assist-create-panel :deep(.assist-edit-form) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.assist-form-footer {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-start;
  gap: 5px;              /* 两按钮间距，只改这里 */
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin-left: 0px;    /* 整组右移，与打印注释输入框对齐 */
  padding: 10px 0 4px;
  border-top: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}

.assist-form-footer :deep(.el-button) {
  min-height: 40px;
  height: 40px;
  font-size: 15px;
  padding-left: 20px;
  padding-right: 20px;
  /* 不要在这里写 margin-left */
}
.assist-alert,
.audit-alert {
  margin-bottom: 14px;
}

.assist-filter-bar {
  margin-bottom: 4px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.assist-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.assist-filter-select {
  min-width: 200px;
  width: min(240px, 100%);
}

.assist-keyword-input {
  flex: 0 1 420px;
  width: min(420px, 100%);
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

.assist-table {
  width: 100%;
}

.assist-expand-inner {
  padding: 8px 12px 12px;
  min-height: 48px;
}

.assist-expand-lines-table :deep(.el-table__footer-wrapper td) {
  background: var(--el-fill-color-light);
}

.assist-expand-lines-table :deep(.el-table__footer .cell) {
  font-weight: 600;
  text-align: right;
}

.assist-expand-lines-table :deep(.el-table__footer td.el-table__cell:nth-child(4) .cell) {
  text-align: left;
}

.assist-page-subtotal {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px 20px;
  margin: 8px 0 4px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
  font-size: 13px;
  line-height: 1.4;
}

.assist-page-subtotal__label {
  flex: 0 0 auto;
  font-weight: 600;
  color: var(--el-text-color-primary);
  padding-bottom: 2px;
}

.assist-page-subtotal__cell {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 88px;
}

.assist-page-subtotal__cell--qty {
  min-width: 72px;
}

.assist-page-subtotal__head {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 2px;
}

.assist-page-subtotal__val {
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-primary);
}

.assist-order-data {
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.6;
  font-size: 13px;
}

.assist-order-data__line {
  white-space: normal;
  word-break: break-all;
}

.assist-material-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.assist-material-toolbar .el-input {
  max-width: 360px;
}

.assist-table :deep(.el-input-number) {
  width: 100%;
}

:deep(.assist-material-row--selectable) {
  --el-table-tr-bg-color: #fff7ed;
}

:deep(.assist-material-row--disabled) {
  color: var(--el-text-color-placeholder);
}

.code-text {
  font-weight: 650;
}

:deep(.assist-detail-dialog .el-dialog__body) {
  padding-top: 10px;
}

.assist-print-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.assist-print-toolbar .el-input-number {
  width: 120px;
}

.assist-print-doc {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.assist-print-page {
  padding: 18px;
  background: #fff;
  color: #111;
  border: 1px solid #d7dce3;
}

.assist-print-page h2 {
  margin: 0 0 10px;
  text-align: center;
  font-size: 20px;
}

.assist-print-head,
.assist-print-sign {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px 12px;
  font-size: 12px;
  margin-bottom: 10px;
}

.assist-print-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.assist-print-table th,
.assist-print-table td {
  border: 1px solid #333;
  padding: 4px 5px;
  vertical-align: top;
}

.assist-print-table th {
  background: #f5f5f5;
}

.assist-print-table .num {
  text-align: right;
}

.assist-print-total {
  margin-top: 8px;
  text-align: right;
  font-weight: 650;
}

.assist-print-terms {
  margin: 10px 0;
  padding-left: 20px;
  font-size: 12px;
  columns: 2;
}

@media print {
  html.print-assist-order body * {
    visibility: hidden;
  }

  html.print-assist-order .assist-print-dialog,
  html.print-assist-order .assist-print-dialog * {
    visibility: visible;
  }

  html.print-assist-order .no-print,
  html.print-assist-order .el-dialog__header,
  html.print-assist-order .el-dialog__footer {
    display: none !important;
  }

  html.print-assist-order .assist-print-dialog {
    position: absolute;
    inset: 0;
  }

  html.print-assist-order .assist-print-dialog .el-dialog {
    width: 100% !important;
    margin: 0 !important;
    box-shadow: none;
  }

  html.print-assist-order .assist-print-dialog .el-dialog__body {
    padding: 0;
  }

  html.print-assist-order .assist-print-page {
    page-break-after: always;
    border: 0;
    padding: 8mm;
  }
}
</style>
