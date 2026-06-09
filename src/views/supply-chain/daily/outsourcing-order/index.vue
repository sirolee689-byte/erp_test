<template>
  <div class="erp-module-page assist-order-page">
    <div class="assist-toolbar">
      <div class="assist-toolbar__title">
        <h2>外协订单</h2>
      </div>
      <div class="assist-toolbar__actions">
        <el-button type="primary" @click="openCreate">新增</el-button>
        <el-button :disabled="!selectedRows.length" @click="openBatchPrint">批量打印</el-button>
        <el-button :loading="loading" @click="loadData">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="assist-alert" />

    <div class="assist-filter-bar">
      <el-input v-model="filters.keyword" clearable placeholder="全字段模糊搜索" @keyup.enter="onSearch" />
      <el-select
        v-model="filters.supplier"
        clearable
        filterable
        remote
        reserve-keyword
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
      <el-select v-model="filters.assistType" clearable placeholder="外协类型">
        <el-option label="其他外协" value="0" />
        <el-option label="订单外协" value="1" />
        <el-option label="订单外发" value="2" />
      </el-select>
      <el-select v-model="filters.closed" clearable placeholder="结案状态">
        <el-option label="未结案" value="0" />
        <el-option label="已结案" value="1" />
      </el-select>
      <el-select v-model="filters.sortBy" clearable placeholder="排序">
        <el-option label="按交货日期" value="deliveryDate" />
        <el-option label="按外协日期" value="assistDate" />
        <el-option label="按供应商" value="supplier" />
      </el-select>
      <el-checkbox v-model="filters.showUnaudited">显示未审核</el-checkbox>
      <el-checkbox v-model="filters.recycled">回收站</el-checkbox>
      <el-button type="primary" @click="onSearch">查询</el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="tableList"
      row-key="id"
      border
      stripe
      class="assist-table"
      :empty-text="loading ? '加载中...' : '暂无外协订单'"
      @selection-change="onSelectionChange"
      @expand-change="onExpandChange"
    >
      <el-table-column type="expand">
        <template #default="{ row }">
          <el-table :data="row.expandedLines || []" border size="small" empty-text="暂无明细">
            <el-table-column label="序号" prop="seq" width="70" />
            <el-table-column label="PI号" prop="piNo" min-width="120" show-overflow-tooltip />
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
        </template>
      </el-table-column>
      <el-table-column type="selection" width="48" />
      <el-table-column label="操作" fixed="left" width="400">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="openView(row)">查看</el-button>
          <el-button
            type="primary"
            link
            size="small"
            :disabled="!canEdit(row)"
            @click="openEdit(row)"
          >
            编辑
          </el-button>
          <el-button type="success" link size="small" :disabled="!canAudit(row)" @click="runLifecycle(row, 'audit')">审核</el-button>
          <el-button type="warning" link size="small" :disabled="!canUnaudit(row)" @click="runLifecycle(row, 'unaudit')">反审</el-button>
          <el-button type="success" link size="small" :disabled="!canClose(row)" @click="runLifecycle(row, 'close')">结案</el-button>
          <el-button type="warning" link size="small" :disabled="!canUnclose(row)" @click="runLifecycle(row, 'unclose')">反结案</el-button>
          <el-button type="primary" link size="small" @click="openPrint([row])">打印</el-button>
          <el-button type="danger" link size="small" :disabled="!canDelete(row)" @click="runLifecycle(row, 'delete')">删除</el-button>
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
      <el-table-column label="交期" width="110">
        <template #default="{ row }">{{ deliveryDaysText(row.deliveryDate) }}</template>
      </el-table-column>
      <el-table-column label="汇总" min-width="260">
        <template #default="{ row }">
          <span>项: {{ row.itemCount || 0 }} / 数量: {{ row.totalQty || 0 }} / 含税: {{ row.taxIncludedTotal || 0 }} / 不含税: {{ row.taxExcludedTotal || 0 }} / 税点: {{ row.taxDiffTotal || 0 }} / 额外: {{ row.extraFeeTotal || 0 }}</span>
        </template>
      </el-table-column>
      <el-table-column label="关联单号" prop="referenceNo" min-width="140" show-overflow-tooltip />
      <el-table-column label="币别" prop="currencyCode" width="92" show-overflow-tooltip />
      <el-table-column label="外协商" prop="supplierName" min-width="160" show-overflow-tooltip />
      <el-table-column label="备注" prop="remark" min-width="180" show-overflow-tooltip />
      <el-table-column label="打印注释" prop="notes" min-width="180" show-overflow-tooltip />
      <el-table-column label="审核" width="88">
        <template #default="{ row }">
          <el-tag v-if="isAudited(row)" type="success" size="small">已审核</el-tag>
          <el-tag v-else type="warning" size="small">未审核</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <div class="assist-pagination">
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

    <el-dialog
      v-model="editVisible"
      :title="editMode === 'create' ? '新增外协订单' : '编辑外协订单'"
      width="960px"
      top="5vh"
      destroy-on-close
      class="assist-edit-dialog"
    >
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="110px" class="assist-edit-form">
        <el-tabs v-model="editTab">
          <el-tab-pane label="外协订单基础资料" name="header">
            <div class="assist-form-grid">
              <el-form-item label="外协订单号" prop="assistOrderNo">
                <el-input v-model="editForm.assistOrderNo" placeholder="系统建议，可手动修改" />
              </el-form-item>
              <el-form-item label="外协日期" prop="assistDate">
                <el-date-picker
                  v-model="editForm.assistDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  placeholder="请选择外协日期"
                  @change="onAssistDateChange"
                />
              </el-form-item>
              <el-form-item label="外协类型" prop="assistType">
                <el-select v-model="editForm.assistType">
                  <el-option label="其他外协" value="0" />
                  <el-option label="订单外协" value="1" />
                  <el-option label="订单外发" value="2" />
                </el-select>
              </el-form-item>
              <el-form-item label="关联单号" prop="referenceNo">
                <el-input v-model="editForm.referenceNo" :disabled="editForm.assistType === '0'" />
              </el-form-item>
              <el-form-item label="外协商" prop="supplierCode">
                <el-select
                  v-model="editForm.supplierCode"
                  filterable
                  remote
                  reserve-keyword
                  :remote-method="fetchSupplierOptions"
                  :loading="supplierLoading"
                  placeholder="输入编码或名称搜索"
                >
                  <el-option
                    v-for="item in supplierOptions"
                    :key="item.code"
                    :label="`${item.code} ${item.name}`"
                    :value="item.code"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="是否含税" prop="taxIncluded">
                <el-select v-model="editForm.taxIncluded">
                  <el-option label="含税" value="1" />
                  <el-option label="不含税" value="2" />
                </el-select>
              </el-form-item>
              <el-form-item label="币别" prop="currencyCode">
                <el-select v-model="editForm.currencyCode" filterable placeholder="请选择币别">
                  <el-option
                    v-for="item in currencyOptions"
                    :key="item.code"
                    :label="`${item.code} ${item.name}`"
                    :value="item.code"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="交货日期">
                <el-date-picker
                  v-model="editForm.deliveryDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  placeholder="请选择交货日期"
                />
              </el-form-item>
              <el-form-item label="单价小数位" prop="decimalPlaces">
                <el-input-number v-model="editForm.decimalPlaces" :min="0" :max="6" :step="1" />
              </el-form-item>
            </div>
            <el-form-item label="备注">
              <el-input v-model="editForm.remark" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item label="打印注释">
              <el-input v-model="editForm.notes" type="textarea" :rows="3" />
            </el-form-item>
          </el-tab-pane>
          <el-tab-pane label="外协订单明细" name="lines">
            <div class="assist-lines-toolbar">
              <el-button type="primary" @click="openMaterialSelector">选材</el-button>
              <el-button @click="addBlankLine">新增空行</el-button>
            </div>
            <el-table :data="editForm.lines" border stripe height="360" empty-text="暂无明细">
              <el-table-column label="操作" width="72" fixed="left">
                <template #default="{ $index }">
                  <el-button type="danger" link size="small" @click="removeLine($index)">删除</el-button>
                </template>
              </el-table-column>
              <el-table-column label="序号" width="64">
                <template #default="{ $index }">{{ $index + 1 }}</template>
              </el-table-column>
              <el-table-column label="PI号" prop="piNo" min-width="120" show-overflow-tooltip />
              <el-table-column label="物料编码" prop="kcaa01" min-width="150" show-overflow-tooltip />
              <el-table-column label="中文名" prop="kcaa02" min-width="160" show-overflow-tooltip />
              <el-table-column label="规格" prop="kcaa03" min-width="140" show-overflow-tooltip />
              <el-table-column label="单位" prop="kcaa04" width="90" />
              <el-table-column label="数量" width="126">
                <template #default="{ row }">
                  <el-input-number v-model="row.wxak03" :precision="2" :min="0" controls-position="right" @change="onLineTaxExcludedChange(row)" />
                </template>
              </el-table-column>
              <el-table-column label="不含税单价" width="138">
                <template #default="{ row }">
                  <el-input-number v-model="row.wxak04" :precision="editForm.decimalPlaces" :min="0" controls-position="right" @change="onLineTaxExcludedChange(row)" />
                </template>
              </el-table-column>
              <el-table-column label="税点" width="116">
                <template #default="{ row }">
                  <el-input-number v-model="row.tax" :precision="6" :min="0" controls-position="right" @change="onLineTaxExcludedChange(row)" />
                </template>
              </el-table-column>
              <el-table-column label="含税单价" width="138">
                <template #default="{ row }">
                  <el-input-number v-model="row.wxak041" :precision="editForm.decimalPlaces" :min="0" controls-position="right" @change="onLineTaxIncludedChange(row)" />
                </template>
              </el-table-column>
              <el-table-column label="不含税金额" prop="wxak05" width="116" align="right" />
              <el-table-column label="含税金额" prop="wxak051" width="116" align="right" />
              <el-table-column label="交货日期" width="150">
                <template #default="{ row }">
                  <el-date-picker v-model="row.deliveryDate" type="date" value-format="YYYY-MM-DD" />
                </template>
              </el-table-column>
              <el-table-column label="参考单号" width="150">
                <template #default="{ row }">
                  <el-input v-model="row.referenceNo" />
                </template>
              </el-table-column>
              <el-table-column label="备注" width="180">
                <template #default="{ row }">
                  <el-input v-model="row.remark" />
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="额外费用清单" name="fees">
            <div class="assist-lines-toolbar">
              <el-button type="primary" @click="openFeeSelector">选择费用</el-button>
              <el-button @click="addBlankFee">新增空行</el-button>
            </div>
            <el-table :data="editForm.fees" border stripe height="340" empty-text="暂无额外费用">
              <el-table-column label="操作" width="72" fixed="left">
                <template #default="{ $index }">
                  <el-button type="danger" link size="small" @click="removeFee($index)">删除</el-button>
                </template>
              </el-table-column>
              <el-table-column label="序号" width="64">
                <template #default="{ $index }">{{ $index + 1 }}</template>
              </el-table-column>
              <el-table-column label="费用编码及名称" min-width="240">
                <template #default="{ row }">
                  <el-input v-model="row.feeCode" placeholder="费用编码" />
                  <el-input v-model="row.feeName" placeholder="费用名称" class="assist-inline-input" />
                </template>
              </el-table-column>
              <el-table-column label="费用" width="140">
                <template #default="{ row }">
                  <el-input-number v-model="row.money" :precision="2" :min="0" controls-position="right" />
                </template>
              </el-table-column>
              <el-table-column label="税点" width="120">
                <template #default="{ row }">
                  <el-input-number v-model="row.tax" :precision="6" :min="0" controls-position="right" />
                </template>
              </el-table-column>
              <el-table-column label="备注" min-width="180">
                <template #default="{ row }">
                  <el-input v-model="row.remark" />
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saveLoading" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

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
                <el-table-column label="序号" prop="seq" width="72" />
                <el-table-column label="PI号" prop="piNo" min-width="120" show-overflow-tooltip />
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
                <el-table-column label="序号" prop="seq" width="72" />
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

    <el-dialog v-model="materialVisible" title="选择外协物料" width="1080px" top="6vh" destroy-on-close>
      <div class="assist-material-toolbar">
        <el-input
          v-model="materialKeyword"
          clearable
          placeholder="按编码、名称、规格搜索"
          @keyup.enter="loadMaterialOptions"
        />
        <el-button type="primary" :loading="materialLoading" @click="loadMaterialOptions">搜索</el-button>
      </div>
      <el-table
        :data="materialOptions"
        v-loading="materialLoading"
        border
        stripe
        height="460"
        row-key="kcaa01"
        :row-class-name="materialRowClassName"
      >
        <el-table-column label="操作" width="76" fixed="left">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="appendMaterial(row)">选择</el-button>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="86">
          <template #default="{ row }">
            <el-tag v-if="row.isSelectable" type="warning" size="small">可外协</el-tag>
            <el-tag v-else type="info" size="small">不可选</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="来源" prop="source" width="92" />
        <el-table-column label="PI号" prop="piNo" min-width="120" show-overflow-tooltip />
        <el-table-column label="物料编码" prop="kcaa01" min-width="160" show-overflow-tooltip />
        <el-table-column label="中文名" prop="kcaa02" min-width="180" show-overflow-tooltip />
        <el-table-column label="规格" prop="kcaa03" min-width="160" show-overflow-tooltip />
        <el-table-column label="单位" prop="kcaa04" width="90" />
        <el-table-column label="默认数量" prop="orderQty" width="100" align="right" />
      </el-table>
      <template #footer>
        <el-button @click="materialVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="feeVisible" title="选择额外费用" width="720px" top="8vh" destroy-on-close>
      <div class="assist-material-toolbar">
        <el-input v-model="feeKeyword" clearable placeholder="按费用编码或名称搜索" @keyup.enter="loadFeeOptions" />
        <el-button type="primary" :loading="feeLoading" @click="loadFeeOptions">搜索</el-button>
      </div>
      <el-table :data="feeOptions" v-loading="feeLoading" border stripe height="380" row-key="feeCode">
        <el-table-column label="操作" width="76" fixed="left">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="appendFee(row)">选择</el-button>
          </template>
        </el-table-column>
        <el-table-column label="费用编码" prop="feeCode" min-width="160" show-overflow-tooltip />
        <el-table-column label="费用名称" prop="feeName" min-width="220" show-overflow-tooltip />
      </el-table>
      <template #footer>
        <el-button @click="feeVisible = false">关闭</el-button>
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
import { computed, onMounted, reactive, ref } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import {
  recalcAssistOrderLineFromTaxExcluded,
  recalcAssistOrderLineFromTaxIncluded,
} from '@/utils/assistOrderAmount'

defineOptions({ name: 'supply-chain-daily-outsourcing-order' })

const loading = ref(false)
const detailLoading = ref(false)
const saveLoading = ref(false)
const supplierLoading = ref(false)
const materialLoading = ref(false)
const feeLoading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const supplierOptions = ref([])
const currencyOptions = ref([])
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const detailVisible = ref(false)
const editVisible = ref(false)
const materialVisible = ref(false)
const feeVisible = ref(false)
const printVisible = ref(false)
const activeTab = ref('header')
const editTab = ref('header')
const editMode = ref('create')
const editId = ref(null)
const editFormRef = ref(null)
const materialKeyword = ref('')
const materialOptions = ref([])
const feeKeyword = ref('')
const feeOptions = ref([])
const selectedRows = ref([])
const printLoading = ref(false)
const printDocs = ref([])
const printIds = ref([])
const printSetup = reactive({
  rowsPerPage: 12,
  priceDecimals: 2,
})
const filters = reactive({
  keyword: '',
  supplier: '',
  assistType: '',
  closed: '',
  sortBy: '',
  showUnaudited: false,
  recycled: false,
})
const detail = reactive({
  header: null,
  lines: [],
  fees: [],
})
const editForm = reactive(defaultEditForm())

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
}))

function todayYmd() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function defaultEditForm() {
  return {
    assistOrderNo: '',
    assistDate: todayYmd(),
    assistType: '0',
    referenceNo: '',
    supplierCode: '',
    taxIncluded: '1',
    currencyCode: '',
    deliveryDate: '',
    remark: '',
    notes: '',
    decimalPlaces: 4,
    lines: [],
    fees: [],
  }
}

function resetEditForm(next = {}) {
  Object.assign(editForm, defaultEditForm(), next)
  editFormRef.value?.clearValidate?.()
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

function deliveryDaysText(value) {
  if (!value) return '-'
  const d = new Date(formatDate(value))
  if (Number.isNaN(d.getTime())) return '-'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (days === 0) return '今天到期'
  if (days > 0) return `还剩 ${days} 天`
  return `逾期 ${Math.abs(days)} 天`
}

function normalizeLine(row = {}, index = 0) {
  return {
    seq: index + 1,
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

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await axios.get('/api/assist-order/list', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        keyword: filters.keyword,
        supplier: filters.supplier,
        assistType: filters.assistType,
        closed: filters.closed,
        sortBy: filters.sortBy,
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
    loading.value = false
  }
}

function onSearch() {
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

function onSelectionChange(rows) {
  selectedRows.value = Array.isArray(rows) ? rows : []
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
}

async function openCreate() {
  editMode.value = 'create'
  editId.value = null
  editTab.value = 'header'
  resetEditForm()
  editVisible.value = true
  await Promise.all([fetchSupplierOptions(''), fetchCurrencyOptions(), fetchSuggestedNo()])
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
  editVisible.value = true
  detailLoading.value = true
  try {
    await Promise.all([fetchSupplierOptions(''), fetchCurrencyOptions()])
    const data = await loadDetail(id)
    const h = data.header || {}
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
      lines: data.lines.map((line, index) => normalizeLine(line, index)),
      fees: data.fees.map((fee, index) => normalizeFee(fee, index)),
    })
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取外协订单详情失败')
    editVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

async function onAssistDateChange() {
  if (editMode.value === 'create') await fetchSuggestedNo()
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

async function onExpandChange(row, expandedRows) {
  const expanded = expandedRows.some((item) => item.id === row.id)
  if (!expanded || row.expandedLoaded) return
  try {
    const data = await loadDetail(row.id)
    row.expandedLines = data.lines
    row.expandedLoaded = true
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取明细失败')
  }
}

function addBlankLine() {
  editForm.lines.push(normalizeLine({}, editForm.lines.length))
}

function removeLine(index) {
  editForm.lines.splice(index, 1)
  editForm.lines.forEach((line, i) => {
    line.seq = i + 1
  })
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

async function openMaterialSelector() {
  materialVisible.value = true
  materialKeyword.value = ''
  await loadMaterialOptions()
}

async function loadMaterialOptions() {
  materialLoading.value = true
  try {
    const res = await axios.get('/api/assist-order/material-options', {
      params: {
        assistType: editForm.assistType,
        referenceNo: editForm.referenceNo,
        keyword: materialKeyword.value,
      },
    })
    const body = res.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '读取选材失败')
    materialOptions.value = Array.isArray(body.data?.list) ? body.data.list : []
  } catch (err) {
    materialOptions.value = []
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取选材失败')
  } finally {
    materialLoading.value = false
  }
}

function appendMaterial(row) {
  if (!row?.isSelectable) {
    ElMessage.warning('该物料未勾选外协')
    return
  }
  const line = normalizeLine(row, editForm.lines.length)
  applyLineCalc(line, recalcAssistOrderLineFromTaxExcluded(line, { priceDecimals: editForm.decimalPlaces }))
  editForm.lines.push(line)
}

function materialRowClassName({ row }) {
  return row?.isSelectable ? 'assist-material-row--selectable' : 'assist-material-row--disabled'
}

function addBlankFee() {
  editForm.fees.push(normalizeFee({}, editForm.fees.length))
}

function removeFee(index) {
  editForm.fees.splice(index, 1)
  editForm.fees.forEach((fee, i) => {
    fee.seq = i + 1
  })
}

async function openFeeSelector() {
  feeVisible.value = true
  feeKeyword.value = ''
  await loadFeeOptions()
}

async function loadFeeOptions() {
  feeLoading.value = true
  try {
    const res = await axios.get('/api/assist-order/fee-options', {
      params: { keyword: feeKeyword.value },
    })
    const body = res.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '读取费用失败')
    feeOptions.value = Array.isArray(body.data?.list) ? body.data.list : []
  } catch (err) {
    feeOptions.value = []
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取费用失败')
  } finally {
    feeLoading.value = false
  }
}

function appendFee(row) {
  editForm.fees.push(normalizeFee(row, editForm.fees.length))
}

function openBatchPrint() {
  openPrint(selectedRows.value)
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

async function runLifecycle(row, action) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.warning('外协订单参数无效')
    return
  }
  try {
    const res =
      action === 'delete'
        ? await axios.delete(`/api/assist-order/${id}`)
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
  await editFormRef.value?.validate?.()
  saveLoading.value = true
  try {
    const body = {
      header: { ...editForm, lines: undefined },
      lines: editForm.lines.map((line, index) => ({ ...line, seq: index + 1 })),
      fees: editForm.fees.map((fee, index) => ({ ...fee, seq: index + 1 })),
    }
    const res =
      editMode.value === 'create'
        ? await axios.post('/api/assist-order', body)
        : await axios.put(`/api/assist-order/${editId.value}`, body)
    const resp = res.data ?? {}
    if (resp.code !== 200) throw new Error(resp.msg || '保存失败')
    const finalNo = String(resp.data?.assistOrderNo ?? '').trim()
    ElMessage.success(resp.data?.changedOrderNo && finalNo ? `保存成功，最终单号：${finalNo}` : '保存成功')
    editVisible.value = false
    await loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '保存失败')
  } finally {
    saveLoading.value = false
  }
}

onMounted(async () => {
  await loadData()
})
</script>

<style scoped>
.assist-order-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.assist-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.assist-toolbar__title h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
}

.assist-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.assist-alert {
  margin-bottom: 4px;
}

.assist-table {
  width: 100%;
}

.assist-pagination {
  display: flex;
  justify-content: flex-end;
  padding: 4px 0 0;
}

.assist-edit-form {
  max-width: 860px;
}

.assist-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
}

.assist-form-grid :deep(.el-select),
.assist-form-grid :deep(.el-date-editor),
.assist-form-grid :deep(.el-input-number) {
  width: 100%;
}

.assist-lines-toolbar,
.assist-material-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.assist-material-toolbar .el-input {
  max-width: 360px;
}

.assist-inline-input {
  margin-top: 6px;
}

.assist-table :deep(.el-input-number),
.assist-edit-dialog :deep(.el-input-number),
.assist-edit-dialog :deep(.el-date-editor) {
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

:deep(.assist-detail-dialog .el-dialog__body),
:deep(.assist-edit-dialog .el-dialog__body) {
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
