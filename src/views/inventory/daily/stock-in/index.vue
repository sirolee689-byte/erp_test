<template>
  <div class="erp-module-page stock-in-page" :class="{ 'stock-in-page--form': pageMode === 'form' }">
    <div class="stock-in-mode-bar">
      <el-button :type="pageMode === 'list' ? 'primary' : 'default'" plain @click="switchList">管理入库单</el-button>
      <el-button v-permission="'add'" :type="pageMode === 'form' && !editId ? 'primary' : 'default'" plain @click="newReceipt">
        入库单添加
      </el-button>
      <el-button plain @click="showTodo('搜索入库单请直接使用列表上方查询条件')">搜索入库单</el-button>
      <el-button plain :type="showRecycle ? 'primary' : 'default'" @click="toggleRecycle">恢复入库单</el-button>
      <el-button plain @click="showUnaudited = true; showRecycle = false; loadList()">审核申请</el-button>
      <el-button v-permission="'export'" plain @click="showTodo('真实 Excel 导出待开发，后续由后端生成并遵守价格权限')">导出信息</el-button>
      <el-button plain @click="showTodo('超量入库配置待开发，第一版默认严控超量')">超量入库配置</el-button>
    </div>

    <section v-show="pageMode === 'list'" class="erp-section">
      <div class="stock-filter-bar">
        <div class="stock-filter-row stock-filter-row--top">
          <el-select
            v-model="filters.relatedParty"
            clearable
            filterable
            remote
            reserve-keyword
            class="stock-filter-related"
            :remote-method="fetchFilterRelatedParties"
            :loading="filterRelatedPartyLoading"
            placeholder="供应商/外协商"
            @focus="handleFilterRelatedPartyFocus"
          >
            <el-option
              v-for="item in filterRelatedParties"
              :key="item.code"
              :label="`${item.code} ${item.name}`"
              :value="item.code"
            />
          </el-select>
          <el-select v-model="filters.inboundType" clearable class="stock-filter-type" placeholder="入库类型">
            <el-option v-for="opt in inboundTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" :disabled="opt.value === '8'" />
          </el-select>
        </div>
        <div class="stock-filter-row stock-filter-row--bottom">
          <el-input
            v-model="filters.keyword"
            clearable
            class="stock-filter-keyword"
            placeholder="入库单号 / 入库日期 / 关联单号 / 纸质单号 / 备注"
            @keyup.enter="onSearch"
          />
          <el-button type="primary" size="small" @click="onSearch">查询</el-button>
          <div class="stock-filter-divider" aria-hidden="true" />
          <div class="stock-filter-switch">
            <span class="switch-label">回收站</span>
            <el-switch v-model="showRecycle" @change="onRecycleChange" />
          </div>
          <template v-if="!showRecycle">
            <div class="stock-filter-divider" aria-hidden="true" />
            <div class="stock-filter-switch">
              <span class="switch-label">显示未审核</span>
              <el-switch v-model="showUnaudited" @change="onSearch" />
            </div>
            <div class="stock-filter-divider" aria-hidden="true" />
            <div class="stock-filter-switch">
              <span class="switch-label">显示未复核</span>
              <el-switch v-model="showUnreviewed" @change="onSearch" />
            </div>
          </template>
          <el-button size="small" @click="resetSearch">重置</el-button>
        </div>
      </div>

      <el-alert v-if="showRecycle" type="info" show-icon title="当前是回收站：只处理已软删除的待审核入库单。" class="stock-alert" />
      <el-alert v-else-if="showUnaudited" type="warning" show-icon title="当前显示待审核入库单，可编辑、审核或删除。" class="stock-alert" />
      <el-alert v-else-if="showUnreviewed" type="info" show-icon title="当前只显示未复核入库单（财务未锁定）。" class="stock-alert" />

      <el-table
        ref="listTableRef"
        v-loading="loading"
        v-erp-list-h-scroll
        :data="list"
        border
        stripe
        row-key="id"
        class="erp-list-table"
        :expand-row-keys="expandedRowKeys"
        :empty-text="loading ? '加载中' : '暂无数据'"
        @expand-change="onExpandChange"
        @row-click="onListRowClick"
      >
        <el-table-column type="expand" width="48">
          <template #default="{ row }">
            <div v-loading="row.__linesLoading" class="stock-expand-inner" @click.stop>
              <el-table
                v-if="(row.__lines || []).length"
                :data="row.__lines || []"
                border
                stripe
                size="small"
                class="stock-expand-lines-table"
                show-summary
                :summary-method="(param) => expandLineSummaryMethod(row.__lines, param)"
              >
                <el-table-column label="序号" type="index" width="60" align="center" />
                <el-table-column label="关联单号相关信息" min-width="210">
                  <template #default="{ row: line }">
                    <div class="stock-link-info">
                      <template v-for="(item, idx) in relationInfoLines(line)" :key="idx">
                        <div class="stock-link-info__line" :class="item.className">{{ item.text }}</div>
                      </template>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="关联单号" prop="kcan04" min-width="150" show-overflow-tooltip />
                <el-table-column label="材料编码" prop="kcaa01" min-width="140" show-overflow-tooltip />
                <el-table-column label="材料名称" prop="kcaa02" min-width="160" show-overflow-tooltip />
                <el-table-column label="规格" prop="kcaa03" min-width="140" show-overflow-tooltip />
                <el-table-column label="颜色" prop="kcaa11" min-width="100" show-overflow-tooltip />
                <el-table-column label="单位" prop="kcaa04" width="80" />
                <el-table-column label="入库数量" prop="kcao03" width="110" align="right" />
                <template v-if="hasPricePermission">
                  <el-table-column label="单价" prop="kcao04" width="110" align="right" />
                  <el-table-column label="单价（含税）" prop="kcao041" width="130" align="right" />
                  <el-table-column label="金额" prop="kcao05" width="110" align="right" />
                  <el-table-column label="金额（含税）" prop="kcao051" width="130" align="right" />
                  <el-table-column label="税点" prop="tax" width="100" align="right" />
                </template>
                <el-table-column label="PO/PI" prop="reference" min-width="120" show-overflow-tooltip />
                <el-table-column label="备注" prop="Describe" min-width="180" show-overflow-tooltip />
              </el-table>
              <el-empty v-else-if="!row.__linesLoading" description="暂无明细" />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" fixed="left" width="240" class-name="erp-col-actions">
          <template #default="{ row }">
            <div class="stock-actions" @click.stop>
              <el-button size="small" plain @click="viewReceipt(row)">查看</el-button>
              <el-button size="small" plain @click="printReceipt(row)">打印</el-button>
              <template v-if="!showRecycle">
                <el-button v-if="showUnreviewed && canReview(row)" v-permission="'review'" size="small" type="warning" plain :loading="row.__op === 'review'" @click="runAction(row, 'review')">复核</el-button>
                <el-button v-if="canUnreview(row)" v-permission="'unreview'" size="small" type="warning" plain :loading="row.__op === 'unreview'" @click="runAction(row, 'unreview')">反复核</el-button>
                <el-button v-if="canEdit(row)" v-permission="'edit'" size="small" type="primary" plain @click="editReceipt(row)">编辑</el-button>
                <el-button v-if="canAudit(row)" v-permission="'audit'" size="small" plain :loading="row.__op === 'audit'" @click="runAction(row, 'audit')">审核</el-button>
                <el-button v-if="canUnaudit(row)" v-permission="'audit'" size="small" plain :loading="row.__op === 'unaudit'" @click="runAction(row, 'unaudit')">反审核</el-button>
                <el-button v-if="canDelete(row)" v-permission="'delete'" size="small" type="danger" plain :loading="row.__op === 'delete'" @click="runAction(row, 'delete')">删除</el-button>
                <span v-if="isLocked(row) && !canUnreview(row)" class="locked-mark" title="此单只读，不可操作">🚫</span>
              </template>
              <template v-else>
                <el-button v-if="row.pass !== '1'" v-permission="'delete'" size="small" type="primary" plain :loading="row.__op === 'restore'" @click="runAction(row, 'restore')">恢复</el-button>
                <el-button v-if="row.pass !== '1'" v-permission="'delete'" size="small" type="danger" plain :loading="row.__op === 'hard'" @click="runAction(row, 'hard')">彻底删除</el-button>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="150" class-name="stock-status-col">
          <template #default="{ row }">
            <div class="stock-status-cell">
              <el-tag v-for="tag in getStatusTags(row)" :key="tag.label" :type="tag.type" size="small">{{ tag.label }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="入库类型" width="110">
          <template #default="{ row }">{{ inboundTypeText(row.inboundType) }}</template>
        </el-table-column>
        <el-table-column label="入库单号" prop="receiptNo" fixed="left" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="code-text">{{ formatCell(row.receiptNo) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="关联单号" prop="sourceOrderNo" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ formatCell(row.sourceOrderNo) }}</template>
        </el-table-column>
        <el-table-column label="入库日期" width="116">
          <template #default="{ row }">{{ formatDate(row.inboundDate) }}</template>
        </el-table-column>
        <el-table-column label="入库单数据" min-width="500" class-name="stock-receipt-data-col">
          <template #default="{ row }">
            <div class="stock-receipt-data">
              <div v-for="(line, idx) in stockReceiptDataLineList(row)" :key="idx" class="stock-receipt-data__line">{{ line }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="仓库名称" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ formatCell(row.warehouseName || row.warehouseCode) }}</template>
        </el-table-column>
        <el-table-column label="供应商/外协商" prop="relatedPartyName" min-width="280" show-overflow-tooltip>
          <template #default="{ row }">{{ formatCell(row.relatedPartyName) }}</template>
        </el-table-column>
        <el-table-column label="经手人" prop="handlerName" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ formatCell(row.handlerName) }}</template>
        </el-table-column>
        <el-table-column label="纸质单号" prop="paperNo" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ formatCell(row.paperNo) }}</template>
        </el-table-column>
        <el-table-column label="备注" prop="remark" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ formatCell(row.remark) }}</template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="pager.page"
        v-model:page-size="pager.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="pager.total"
        class="stock-pagination"
        @size-change="loadList"
        @current-change="loadList"
      />
    </section>

    <section v-show="pageMode === 'form'" class="erp-section">
      <div class="form-head">
        <strong>{{ editId ? '编辑入库单' : '新增入库单' }}</strong>
        <div>
          <el-button @click="resetCurrentForm">重置</el-button>
          <el-button type="primary" :loading="saving" @click="saveReceipt">保存</el-button>
        </div>
      </div>

      <el-tabs v-model="formTab" class="stock-form-tabs">
        <el-tab-pane label="入库单基础资料" name="base">
          <el-form :model="form" label-width="90px" class="stock-form stock-form--base">
            <div class="form-grid form-grid--single">
              <el-form-item label="入库单号">
                <div class="copyable-field stock-unified-input">
                  <el-input :model-value="displayReceiptNo" readonly />
                  <el-button plain @click="copyText(displayReceiptNo, '入库单号')">复制</el-button>
                </div>
              </el-form-item>
              <el-form-item label="入库日期">
                <el-date-picker v-model="form.inboundDate" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" class="stock-unified-input" :disabled="formReadOnly" />
              </el-form-item>
              <el-form-item label="入库类型">
                <div class="stock-type-buttons">
                  <el-button
                    v-for="opt in addableInboundTypes"
                    :key="opt.value"
                    size="large"
                    class="stock-type-btn"
                    :type="form.inboundType === opt.value ? 'primary' : 'default'"
                    :plain="form.inboundType !== opt.value"
                    :disabled="!!editId"
                    @click="pickInboundType(opt.value)"
                  >
                    {{ opt.label }}
                  </el-button>
                </div>
              </el-form-item>
              <el-form-item :label="sourceOrderLabel">
                <el-input v-if="isFreeType" v-model="form.sourceOrderNo" class="stock-unified-input" clearable placeholder="请输入关联单号" />
                <div v-else class="source-picker-field">
                  <el-input :model-value="form.sourceOrderNo" class="stock-unified-input" readonly :placeholder="`请选择${sourceOrderLabel}`" />
                  <el-button type="primary" plain @click="openSourceOrderDialog">选择</el-button>
                  <el-button plain :disabled="!form.sourceOrderNo" @click="clearSourceOrder">清空</el-button>
                </div>
                <div v-if="form.sourceOrderNo" class="selected-source-line">
                  <span>已选单号：{{ form.sourceOrderNo }}</span>
                  <el-button link type="primary" @click="copyText(form.sourceOrderNo, sourceOrderLabel)">复制</el-button>
                </div>
              </el-form-item>
              <el-form-item :label="relatedLabel">
                <el-input
                  v-model="form.relatedPartyName"
                  class="stock-unified-input"
                  :readonly="!isFreeType"
                  :placeholder="isFreeType ? '可填写自由文本关联单位' : `选择${sourceOrderLabel}后自动带出`"
                />
              </el-form-item>
              <el-form-item label="仓库" class="form-row-inline">
                <div class="form-inline-pairs">
                  <el-select
                    v-model="form.warehouseCode"
                    class="stock-unified-input"
                    filterable
                    remote
                    reserve-keyword
                    :remote-method="loadWarehouses"
                    @change="onWarehouseChange"
                  >
                    <el-option v-for="w in warehouses" :key="w.code" :label="`${w.code} ${w.name}`" :value="w.code" />
                  </el-select>
                  <div class="inline-pair">
                    <span class="inline-pair__label">{{ paperNoLabel }}</span>
                    <el-input v-model="form.paperNo" class="stock-unified-input" />
                  </div>
                </div>
              </el-form-item>
              <el-form-item label="是否含税">
                <el-radio-group v-model="form.inTax" @change="onTaxModeChange">
                  <el-radio-button label="1">含税</el-radio-button>
                  <el-radio-button label="2">不含税</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="备注">
                <el-input v-model="form.remark" class="stock-remark-input" />
              </el-form-item>
            </div>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="入库单明细" name="lines">
          <div class="line-toolbar">
            <el-button type="primary" plain @click="openBatchDialog">批量添加</el-button>
            <el-button type="danger" plain :disabled="!selectedLineKeys.length" @click="removeSelectedLines">删除选定明细</el-button>
            <el-button type="danger" plain :disabled="!lines.length" @click="removeAllLines">删除全部明细</el-button>
          </div>

          <el-table :data="lines" border stripe row-key="__key" class="erp-list-table">
            <el-table-column label="选择" fixed="left" width="90" align="center" class-name="erp-col-actions">
              <template #default="{ row }">
                <el-button
                  size="small"
                  class="stock-line-mark-btn"
                  :class="{ 'stock-line-mark-btn--on': isLineMarked(row) }"
                  @click="toggleLineMark(row)"
                >
                  {{ isLineMarked(row) ? '已选择' : '删除' }}
                </el-button>
              </template>
            </el-table-column>
            <el-table-column label="序号" type="index" width="60" align="center" />
            <el-table-column label="材料编码" prop="kcaa01" min-width="150" show-overflow-tooltip />
            <el-table-column label="名称" prop="kcaa02" min-width="160" show-overflow-tooltip />
            <el-table-column label="规格" prop="kcaa03" min-width="140" show-overflow-tooltip />
            <el-table-column label="颜色" prop="kcaa11" min-width="100" show-overflow-tooltip />
            <el-table-column label="单位" prop="kcaa04" width="80" />
            <el-table-column label="可入库" width="110" align="right">
              <template #default="{ row }">{{ row.availableQty ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="入库数量" width="130">
              <template #default="{ row }">
                <el-input-number v-model="row.kcao03" :min="0" :precision="2" controls-position="right" @change="recalcLine(row)" />
              </template>
            </el-table-column>
            <template v-if="hasPricePermission">
              <el-table-column label="不含税单价" width="140">
                <template #default="{ row }"><el-input-number v-model="row.kcao04" :precision="4" controls-position="right" @change="recalcLine(row)" /></template>
              </el-table-column>
              <el-table-column label="税点" width="120">
                <template #default="{ row }"><el-input-number v-model="row.tax" :min="0" :precision="4" controls-position="right" @change="recalcLine(row)" /></template>
              </el-table-column>
              <el-table-column label="含税单价" width="140">
                <template #default="{ row }"><el-input-number v-model="row.kcao041" :precision="4" controls-position="right" @change="recalcLineFromTaxPrice(row)" /></template>
              </el-table-column>
              <el-table-column label="不含税金额" prop="kcao05" width="120" align="right" />
              <el-table-column label="含税金额" prop="kcao051" width="120" align="right" />
            </template>
            <el-table-column label="库位" width="130">
              <template #default="{ row }"><el-input v-model="row.location" /></template>
            </el-table-column>
            <el-table-column label="版本" prop="version" width="110" show-overflow-tooltip />
            <el-table-column label="备注" min-width="180">
              <template #default="{ row }"><el-input v-model="row.info" /></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-dialog v-model="detailVisible" title="入库单详情" width="92%" class="stock-detail-dialog">
      <div v-if="detail.header" class="detail-body">
        <div class="detail-grid">
          <span>入库单号：{{ detail.header.kcan01 }}</span>
          <span>类型：{{ inboundTypeText(detail.header.kcan03) }}</span>
          <span>入库日期：{{ formatDateTime(detail.header.kcan02) }}</span>
          <span>仓库：{{ detail.header.ck || detail.header.kcan06 }}</span>
          <span>关联方：{{ detail.header.kehu }}</span>
          <span>关联单号：{{ detail.header.kcan04 || '—' }}</span>
          <span>纸质单号：{{ detail.header.kcan08 || '—' }}</span>
          <span>状态：{{ detail.header.pass === '1' ? '已审核' : '待审核' }}</span>
        </div>
        <el-table :data="detail.lines" border stripe>
          <el-table-column label="序号" type="index" width="60" />
          <el-table-column label="材料编码" prop="kcaa01" min-width="140" />
          <el-table-column label="名称" prop="kcaa02" min-width="160" />
          <el-table-column label="规格" prop="kcaa03" min-width="140" />
          <el-table-column label="颜色" prop="kcaa11" width="100" />
          <el-table-column label="单位" prop="kcaa04" width="80" />
          <el-table-column label="数量" prop="kcao03" width="100" align="right" />
          <template v-if="hasPricePermission">
            <el-table-column label="不含税单价" prop="kcao04" width="120" align="right" />
            <el-table-column label="含税金额" prop="kcao051" width="120" align="right" />
          </template>
          <el-table-column label="库位" prop="location" width="120" />
          <el-table-column label="备注" prop="Describe" min-width="160" />
        </el-table>
      </div>
    </el-dialog>

    <el-dialog v-model="batchVisible" :title="batchTitle" width="88%">
      <div class="batch-toolbar">
        <el-input v-model="batchKeyword" clearable placeholder="编码 / 名称" @keyup.enter="loadBatchLines" />
        <el-button type="primary" @click="loadBatchLines">查询</el-button>
      </div>
      <el-table v-loading="batchLoading" :data="batchLines" border stripe @selection-change="onBatchSelectionChange">
        <el-table-column type="selection" width="44" />
        <el-table-column label="材料编码" prop="kcaa01" min-width="150" />
        <el-table-column label="名称" prop="kcaa02" min-width="180" />
        <el-table-column label="规格" prop="kcaa03" min-width="140" />
        <el-table-column label="颜色" prop="kcaa11" width="100" />
        <el-table-column label="单位" prop="kcaa04" width="80" />
        <el-table-column label="可入库" prop="availableQty" width="110" align="right" />
      </el-table>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" @click="applyBatchLines">加入明细</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="sourceDialog.visible" :title="`选择${sourceOrderLabel}`" width="920px" class="source-order-dialog">
      <div class="source-order-toolbar">
        <el-input v-model="sourceDialog.keyword" clearable :placeholder="`${sourceOrderLabel} / PI号 / ${relatedLabel}`" @keyup.enter="searchSourceOrders" />
        <el-button type="primary" @click="searchSourceOrders">查询</el-button>
      </div>
      <el-table v-loading="sourceDialog.loading" :data="sourceDialog.list" border stripe>
        <el-table-column label="操作" width="100" align="center" fixed="left">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain :disabled="row.pass !== '1'" @click="chooseSourceOrder(row)">选择</el-button>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.pass === '1' ? 'success' : 'warning'" size="small">
              {{ row.pass === '1' ? '已审核' : '未审核' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="单号" prop="sourceOrderNo" min-width="170" show-overflow-tooltip />
        <el-table-column label="PI号" prop="referenceNo" min-width="150" show-overflow-tooltip />
        <el-table-column :label="relatedLabel" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.relatedPartyCode }} {{ row.relatedPartyName }}
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="sourceDialog.page"
        v-model:page-size="sourceDialog.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="sourceDialog.total"
        class="source-order-pagination"
        @size-change="loadSourceOrderPage"
        @current-change="loadSourceOrderPage"
      />
    </el-dialog>

    <el-dialog v-model="printVisible" title="打印入库单" width="900px" class="stock-print-dialog">
      <div v-if="printData.header" class="stock-print-page">
        <h2>入库单</h2>
        <div class="print-grid">
          <span>入库单号：{{ printData.header.kcan01 }}</span>
          <span>入库日期：{{ formatDateTime(printData.header.kcan02) }}</span>
          <span>类型：{{ inboundTypeText(printData.header.kcan03) }}</span>
          <span>仓库：{{ printData.header.ck || printData.header.kcan06 }}</span>
          <span>关联方：{{ printData.header.kehu }}</span>
          <span>经手人：{{ printData.header.kcan07 }}</span>
          <span>纸质单号：{{ printData.header.kcan08 }}</span>
          <span>备注：{{ printData.header.remark }}</span>
        </div>
        <table class="print-table">
          <thead>
            <tr>
              <th>序号</th><th>编码</th><th>名称</th><th>规格</th><th>颜色</th><th>单位</th><th>数量</th>
              <th v-if="hasPricePermission">单价</th><th v-if="hasPricePermission">金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, idx) in printData.lines" :key="idx">
              <td>{{ idx + 1 }}</td><td>{{ line.kcaa01 }}</td><td>{{ line.kcaa02 }}</td><td>{{ line.kcaa03 }}</td>
              <td>{{ line.kcaa11 }}</td><td>{{ line.kcaa04 }}</td><td class="num">{{ line.kcao03 }}</td>
              <td v-if="hasPricePermission" class="num">{{ line.kcao04 }}</td><td v-if="hasPricePermission" class="num">{{ line.kcao051 }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <template #footer>
        <el-button @click="printVisible = false">关闭</el-button>
        <el-button type="primary" @click="doPrint">打印</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import {
  STOCK_BATCH_MSG_ACCEPTED,
  STOCK_BATCH_MSG_APPLY,
  STOCK_BATCH_MSG_REJECTED,
  STOCK_BATCH_REJECT_SOURCE_MISMATCH,
  STOCK_BATCH_REJECT_SUPPLIER_MISMATCH,
  buildStockBatchSessionId,
  removeStockBatchResult,
  validateStockBatchApply,
  writeStockBatchContext,
} from '@/utils/stockInBatchAdd'

defineOptions({ name: 'inventory-daily-stock-in' })

const MENU_PATH = 'inventory/daily/stock-in'
const permissionModel = computed(() => getPermissionModelFromStorage())
const hasPricePermission = computed(() => hasPageAction(permissionModel.value, MENU_PATH, 'price'))

const inboundTypeOptions = [
  { value: '0', label: '其他入库' },
  { value: '1', label: '采购入库' },
  { value: '2', label: '外协入库' },
  { value: '3', label: '外协退料' },
  { value: '4', label: '生产入库' },
  { value: '5', label: '生产退料' },
  { value: '6', label: '销售退货' },
  { value: '7', label: '盘盈入库' },
  { value: '8', label: '加工入库' },
]
const addableInboundTypes = inboundTypeOptions.filter((x) => x.value !== '8')

const pageMode = ref('list')
const loading = ref(false)
const saving = ref(false)
const showUnaudited = ref(false)
const showUnreviewed = ref(false)
const showRecycle = ref(false)
const listTableRef = ref(null)
const expandedRowKeys = ref([])
const list = ref([])
const pager = reactive({ page: 1, pageSize: 10, total: 0 })
const filters = reactive({ keyword: '', inboundType: '', relatedParty: '' })
const filterRelatedParties = ref([])
const filterRelatedPartyLoading = ref(false)

const suggestedNo = ref('')
const editId = ref(null)
const warehouses = ref([])
const relatedParties = ref([])
const sourceOrders = ref([])
const lines = ref([])
const form = reactive(defaultForm())
const formTab = ref('base')

const detailVisible = ref(false)
const detail = reactive({ header: null, lines: [] })
const sourceDialog = reactive({ visible: false, loading: false, keyword: '', page: 1, pageSize: 10, total: 0, list: [] })
const batchVisible = ref(false)
const batchLoading = ref(false)
const batchKeyword = ref('')
const batchLines = ref([])
const batchSelected = ref([])
const activePurchaseBatchSessionId = ref('')
const purchaseBatchChildWindow = ref(null)
const printVisible = ref(false)
const printData = reactive({ header: null, lines: [] })

const isFreeType = computed(() => ['0', '7'].includes(form.inboundType))
const needsSourceOrder = computed(() => ['1', '2', '3', '4', '5', '6'].includes(form.inboundType))
const canManualAdd = computed(() => isFreeType.value || (form.inboundType === '5' && !form.sourceOrderNo))
const formReadOnly = computed(() => false)
const selectedLineKeys = computed(() => lines.value.filter((line) => line._lineMarked).map((line) => line.__key))
const relatedLabel = computed(() => {
  if (['1'].includes(form.inboundType)) return '供应商'
  if (['2', '3', '8'].includes(form.inboundType)) return '外协客户'
  if (['4', '5'].includes(form.inboundType)) return '生产车间'
  if (form.inboundType === '6') return '客户'
  return '关联单位'
})
const sourceOrderLabel = computed(() => {
  if (form.inboundType === '1') return '采购单号'
  if (['2', '3', '8'].includes(form.inboundType)) return '外协单号'
  if (['4', '5'].includes(form.inboundType)) return '派工单号'
  if (form.inboundType === '6') return '销售单号'
  return '关联单号'
})
const paperNoLabel = computed(() => (form.inboundType === '4' || form.inboundType === '5' ? 'PI号' : form.inboundType === '6' ? 'PO号' : ['1', '2', '3'].includes(form.inboundType) ? '来货单号' : '纸质单号'))
const batchTitle = computed(() => (canManualAdd.value ? '手工选择物料' : '从关联单据批量添加'))
const displayReceiptNo = computed(() => (editId.value ? form.receiptNo : suggestedNo.value || '保存后生成最终单号'))

function defaultForm() {
  return {
    receiptNo: '',
    inboundType: '0',
    inboundDate: nowText(),
    warehouseCode: '',
    warehouseName: '',
    relatedPartyCode: '',
    relatedPartyName: '',
    sourceOrderNo: '',
    inTax: '1',
    paperNo: '',
    remark: '',
  }
}

function nowText() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function inboundTypeText(v) {
  return inboundTypeOptions.find((x) => x.value === String(v ?? ''))?.label || String(v ?? '')
}

function formatDateTime(v) {
  if (!v) return ''
  return String(v).replace('T', ' ').slice(0, 19)
}

function formatDate(v) {
  if (!v) return '—'
  return String(v).replace('T', ' ').slice(0, 10)
}

function formatCell(v) {
  if (v === null || v === undefined) return '—'
  const s = String(v).trim()
  return s || '—'
}

function round(n, d = 2) {
  const m = 10 ** d
  return Math.round((Number(n) + Number.EPSILON) * m) / m
}

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function formatNumber(v, precision = 2) {
  const n = toNumber(v)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: precision })
}

function formatMoney(v) {
  return toNumber(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function copyText(value, label = '内容') {
  const textValue = String(value ?? '').trim()
  if (!textValue || textValue === '保存后生成最终单号') return ElMessage.warning(`${label}暂无可复制内容`)
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(textValue)
    } else {
      const input = document.createElement('textarea')
      input.value = textValue
      input.setAttribute('readonly', 'readonly')
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    ElMessage.success(`${label}已复制`)
  } catch {
    ElMessage.error(`${label}复制失败，请手动选中复制`)
  }
}

function formatSubtotalQty(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '0'
  if (Number.isInteger(num)) return String(num)
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

function formatSubtotalUnitPrice(n) {
  if (n === null || n === undefined) return '—'
  const num = Number(n)
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function formatQty(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '0'
  if (Number.isInteger(num)) return String(num)
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

function relationInfoLines(line) {
  if (line?.relationNoData) return [{ text: '无相关数据', className: 'stock-link-info__line--muted' }]
  const total = formatQty(line?.relationOrderQty)
  const diff = toNumber(line?.relationDiffQty)
  const overflow = toNumber(line?.relationOverflowQty)
  const returned = toNumber(line?.relationReturnedQty)
  const rows = [{ text: `关联总数：${total}`, className: '' }]
  if (returned > 0) rows.push({ text: `曾发生退货数：${formatQty(returned)}`, className: 'stock-link-info__line--warn' })
  if (overflow > 0) rows.push({ text: `多出数：${formatQty(overflow)}`, className: 'stock-link-info__line--danger' })
  else rows.push({ text: `差数：${formatQty(diff)}`, className: 'stock-link-info__line--primary' })
  return rows
}

/** 展开明细小计：汇总入库数量与金额 */
function calcStockInExpandSubtotal(lines = []) {
  let quantity = 0
  let amountEx = 0
  let amountInc = 0
  for (const line of lines) {
    quantity += toNumber(line?.kcao03)
    amountEx += toNumber(line?.kcao05)
    amountInc += toNumber(line?.kcao051 ?? line?.kcao05)
  }
  return {
    quantity,
    amountEx,
    amountInc,
    unitPriceEx: quantity > 0 ? amountEx / quantity : null,
    unitPriceInc: quantity > 0 ? amountInc / quantity : null,
  }
}

function expandLineSummaryMethod(lines, { columns }) {
  const sub = calcStockInExpandSubtotal(lines)
  return columns.map((col) => {
    const prop = col.property
    if (prop === 'kcaa02') return '小计：'
    if (prop === 'kcao03') return formatSubtotalQty(sub.quantity)
    if (prop === 'kcao04') return formatSubtotalUnitPrice(sub.unitPriceEx)
    if (prop === 'kcao041') return formatSubtotalUnitPrice(sub.unitPriceInc)
    if (prop === 'kcao05') return formatMoney(sub.amountEx)
    if (prop === 'kcao051') return formatMoney(sub.amountInc)
    return ''
  })
}

function calcLineSummary(lines = []) {
  return lines.reduce((acc, line) => {
    acc.itemCount += 1
    acc.totalQty += toNumber(line.kcao031 ?? line.kcao03)
    acc.inboundTotalQty += toNumber(line.kcao03)
    acc.taxExcludedTotal += toNumber(line.kcao05)
    acc.taxIncludedTotal += toNumber(line.kcao051 ?? line.kcao05)
    return acc
  }, { itemCount: 0, totalQty: 0, inboundTotalQty: 0, taxExcludedTotal: 0, taxIncludedTotal: 0, taxTotal: 0 })
}

function expandSummary(row) {
  const fromLines = Array.isArray(row?.__lines) && row.__lines.length ? calcLineSummary(row.__lines) : null
  const summary = fromLines || {
    itemCount: toNumber(row?.itemCount),
    totalQty: toNumber(row?.totalQty),
    inboundTotalQty: toNumber(row?.inboundTotalQty ?? row?.totalQty),
    taxExcludedTotal: toNumber(row?.taxExcludedTotal),
    taxIncludedTotal: toNumber(row?.taxIncludedTotal ?? row?.totalAmount),
    taxTotal: toNumber(row?.taxTotal),
  }
  summary.taxTotal = round(summary.taxIncludedTotal - summary.taxExcludedTotal, 2)
  return summary
}

/** 列表/展开区「入库单数据」两行话术（与定稿 E2 一致） */
function stockReceiptDataLines(row) {
  const summary = expandSummary(row)
  const line1 = `总项数: ${formatNumber(summary.itemCount, 0)}   总数量：${formatNumber(summary.totalQty)}   入库总数量: ${formatNumber(summary.inboundTotalQty)}`
  const line2 = hasPricePermission.value
    ? `含税总价: ${formatMoney(summary.taxIncludedTotal)} 元， 不含税总价: ${formatMoney(summary.taxExcludedTotal)} 元， 税点总价: ${formatMoney(summary.taxTotal)} 元`
    : ''
  return { line1, line2 }
}

function stockReceiptDataLineList(row) {
  const { line1, line2 } = stockReceiptDataLines(row)
  return line2 ? [line1, line2] : [line1]
}

function getReviewStatusTag(row) {
  if (row?.spFlag === '1') return { label: '已复核', type: 'success' }
  return { label: '未复核', type: 'info' }
}

function getLockStatusTag(row) {
  if (row?.closed === '1') return { label: '已结案', type: 'info' }
  if (String(row?.inboundType ?? '') === '8') return { label: '只读', type: 'info' }
  return null
}

function getStatusTags(row) {
  const tags = [
    row?.pass === '1' ? { label: '已审核', type: 'success' } : { label: '未审核', type: 'warning' },
    getReviewStatusTag(row),
  ]
  const lockTag = getLockStatusTag(row)
  if (lockTag) tags.push(lockTag)
  return tags
}

function recalcLine(row) {
  if (form.inTax === '2') row.tax = 0
  const qty = Number(row.kcao03 || 0)
  const ex = Number(row.kcao04 || 0)
  const tax = Number(row.tax || 0)
  row.kcao041 = round(ex * (1 + tax), 4)
  row.kcao05 = round(qty * ex, 2)
  row.kcao051 = round(qty * row.kcao041, 2)
}

function recalcLineFromTaxPrice(row) {
  if (form.inTax === '2') row.tax = 0
  const tax = Number(row.tax || 0)
  const inc = Number(row.kcao041 || 0)
  row.kcao04 = round(tax ? inc / (1 + tax) : inc, 4)
  recalcLine(row)
}

async function loadList() {
  loading.value = true
  try {
    const res = await axios.get('/api/stock-in/list', {
      params: {
        page: pager.page,
        pageSize: pager.pageSize,
        recycled: showRecycle.value ? 1 : 0,
        showUnaudited: showUnaudited.value ? 1 : 0,
        showUnreviewed: showUnreviewed.value ? 1 : 0,
        keyword: filters.keyword,
        inboundType: filters.inboundType,
        relatedParty: filters.relatedParty,
      },
    })
    list.value = res.data?.data?.list || []
    expandedRowKeys.value = []
    pager.total = Number(res.data?.data?.total || 0)
  } catch (err) {
    ElMessage.error(err.response?.data?.msg || err.message || '读取入库单失败')
  } finally {
    loading.value = false
  }
}

function onSearch() {
  pager.page = 1
  loadList()
}

function resetSearch() {
  Object.assign(filters, { keyword: '', inboundType: '', relatedParty: '' })
  filterRelatedParties.value = []
  showUnaudited.value = false
  showUnreviewed.value = false
  showRecycle.value = false
  pager.page = 1
  loadList()
}

function switchList() {
  pageMode.value = 'list'
  editId.value = null
  loadList()
}

function toggleRecycle() {
  showRecycle.value = !showRecycle.value
  onRecycleChange()
}

function onRecycleChange() {
  if (showRecycle.value) {
    showUnaudited.value = false
    showUnreviewed.value = false
  }
  pager.page = 1
  loadList()
}

async function newReceipt() {
  editId.value = null
  Object.assign(form, defaultForm())
  lines.value = []
  formTab.value = 'base'
  pageMode.value = 'form'
  await Promise.all([loadWarehouses(), loadSuggestedNo()])
  await applyDefaultWarehouse()
}

async function resetCurrentForm() {
  if (editId.value) {
    await editReceipt({ id: editId.value })
    ElMessage.success('已重置')
    return
  }
  Object.assign(form, defaultForm())
  lines.value = []
  relatedParties.value = []
  sourceOrders.value = []
  formTab.value = 'base'
  await Promise.all([loadWarehouses(), loadSuggestedNo()])
  await applyDefaultWarehouse()
  ElMessage.success('已重置')
}

async function editReceipt(row) {
  const data = await fetchDetail(row.id)
  editId.value = row.id
  Object.assign(form, {
    receiptNo: data.header.kcan01,
    inboundType: String(data.header.kcan03 || '0'),
    inboundDate: formatDateTime(data.header.kcan02),
    warehouseCode: data.header.kcan06 || '',
    warehouseName: data.header.ck || '',
    relatedPartyCode: data.header.kcan05 || '',
    relatedPartyName: data.header.kehu || '',
    sourceOrderNo: data.header.kcan04 || '',
    inTax: String(data.header.in_tax || '1'),
    paperNo: data.header.kcan08 || '',
    remark: data.header.remark || '',
  })
  lines.value = (data.lines || []).map((line, idx) => ({ ...line, info: line.Describe || '', _lineMarked: false, __key: `${idx}-${line.systemcode || line.id || Date.now()}` }))
  formTab.value = 'base'
  pageMode.value = 'form'
  await Promise.all([loadWarehouses(), loadRelatedParties(), loadSourceOrders()])
}

async function fetchDetail(id) {
  const res = await axios.get(`/api/stock-in/${id}`)
  return res.data?.data || { header: null, lines: [] }
}

async function loadExpandedLines(row) {
  if (!row || row.__linesLoaded || row.__linesLoading) return
  row.__linesLoading = true
  try {
    const data = await fetchDetail(row.id)
    row.__lines = data.lines || []
    row.__linesLoaded = true
  } catch (err) {
    row.__lines = []
    ElMessage.error(err.response?.data?.msg || err.message || '读取入库单明细失败')
  } finally {
    row.__linesLoading = false
  }
}

function onExpandChange(row, expandedRows) {
  expandedRowKeys.value = (expandedRows || []).map((item) => item.id)
  if (expandedRowKeys.value.includes(row.id)) loadExpandedLines(row)
}

function onListRowClick(row, column, event) {
  const target = event?.target
  if (target?.closest?.('.erp-col-actions, .stock-expand-inner, .el-button, .el-table__expand-icon, a')) return
  listTableRef.value?.toggleRowExpansion(row)
}

async function viewReceipt(row) {
  const data = await fetchDetail(row.id)
  detail.header = data.header
  detail.lines = data.lines || []
  detailVisible.value = true
}

async function printReceipt(row) {
  const res = await axios.get('/api/stock-in/print-data', { params: { id: row.id } })
  printData.header = res.data?.data?.header || null
  printData.lines = res.data?.data?.lines || []
  printVisible.value = true
}

function doPrint() {
  document.documentElement.classList.add('print-stock-in')
  setTimeout(() => {
    window.print()
    document.documentElement.classList.remove('print-stock-in')
  }, 50)
}

async function loadSuggestedNo() {
  const res = await axios.get('/api/stock-in/suggest-doc-no')
  suggestedNo.value = res.data?.data?.suggested || ''
}

async function loadWarehouses(keyword = '') {
  const res = await axios.get('/api/stock-in/warehouse-options', { params: { keyword } })
  warehouses.value = res.data?.data?.list || []
}

function isDefaultWarehouse(row) {
  const name = String(row?.name ?? '').trim()
  const code = String(row?.code ?? '').trim()
  return name === '\u8d27\u4ed3' || code === '\u8d27\u4ed3'
}

async function applyDefaultWarehouse() {
  if (form.warehouseCode) return
  if (!warehouses.value.some(isDefaultWarehouse)) {
    await loadWarehouses('\u8d27\u4ed3')
  }
  const target = warehouses.value.find(isDefaultWarehouse)
  if (!target) return
  form.warehouseCode = target.code || ''
  form.warehouseName = target.name || ''
}

async function loadRelatedParties(keyword = '') {
  if (isFreeType.value) return
  const res = await axios.get('/api/stock-in/related-party-options', { params: { inboundType: form.inboundType, keyword } })
  relatedParties.value = res.data?.data?.list || []
}

async function loadSourceOrders(keyword = '') {
  if (!needsSourceOrder.value && form.inboundType !== '5') return
  const res = await axios.get('/api/stock-in/source-options', {
    // 修复联想残留：手动输入关键字时不再携带旧的关联方编码，避免把候选单号误筛空
    params: { inboundType: form.inboundType, keyword },
  })
  sourceOrders.value = res.data?.data?.list || []
}

async function openSourceOrderDialog() {
  if (isFreeType.value) return
  sourceDialog.visible = true
  sourceDialog.keyword = ''
  sourceDialog.page = 1
  await loadSourceOrderPage()
}

function searchSourceOrders() {
  sourceDialog.page = 1
  loadSourceOrderPage()
}

async function loadSourceOrderPage() {
  if (isFreeType.value) return
  sourceDialog.loading = true
  try {
    const res = await axios.get('/api/stock-in/source-order-page', {
      params: {
        inboundType: form.inboundType,
        keyword: sourceDialog.keyword,
        page: sourceDialog.page,
        pageSize: sourceDialog.pageSize,
      },
    })
    sourceDialog.list = res.data?.data?.list || []
    sourceDialog.total = Number(res.data?.data?.total || 0)
  } catch (err) {
    sourceDialog.list = []
    sourceDialog.total = 0
    ElMessage.error(err.response?.data?.msg || err.message || '读取关联单据失败')
  } finally {
    sourceDialog.loading = false
  }
}

function onWarehouseChange(v) {
  form.warehouseName = warehouses.value.find((w) => w.code === v)?.name || ''
}

function onRelatedPartyChange(v) {
  form.relatedPartyName = relatedParties.value.find((p) => p.code === v)?.name || ''
  form.sourceOrderNo = ''
  sourceOrders.value = []
  loadSourceOrders()
}

function applySourceOrder(selected) {
  if (!selected) return
  form.sourceOrderNo = selected.sourceOrderNo || ''
  form.relatedPartyCode = selected.relatedPartyCode || ''
  form.relatedPartyName = selected.relatedPartyName || ''
  if (form.inboundType === '4' && selected.referenceNo) form.paperNo = selected.referenceNo
}

function onSourceOrderChange(v) {
  if (!v) {
    form.relatedPartyCode = ''
    if (!isFreeType.value) form.relatedPartyName = ''
    if (['4', '5'].includes(form.inboundType)) form.paperNo = ''
    return
  }
  const selected = sourceOrders.value.find((x) => x.sourceOrderNo === v)
  if (!selected) return
  applySourceOrder(selected)
}

function chooseSourceOrder(row) {
  if (row?.pass !== '1') return ElMessage.warning('未审核单据不能选择')
  applySourceOrder(row)
  sourceDialog.visible = false
}

function clearSourceOrder() {
  form.sourceOrderNo = ''
  form.relatedPartyCode = ''
  if (!isFreeType.value) form.relatedPartyName = ''
  if (['4', '5'].includes(form.inboundType)) form.paperNo = ''
}

async function onInboundTypeChange() {
  if (lines.value.length) {
    await ElMessageBox.confirm('切换入库类型会清空当前明细，是否继续？', '提示', { type: 'warning' })
    lines.value = []
  }
  form.relatedPartyCode = ''
  form.relatedPartyName = ''
  form.sourceOrderNo = ''
  form.paperNo = ''
  relatedParties.value = []
  sourceOrders.value = []
  loadRelatedParties()
}

async function pickInboundType(nextType) {
  if (String(nextType) === String(form.inboundType)) return
  const oldType = form.inboundType
  form.inboundType = String(nextType)
  try {
    await onInboundTypeChange()
  } catch {
    form.inboundType = String(oldType)
  }
}

function onTaxModeChange() {
  if (form.inTax === '2') lines.value.forEach((row) => { row.tax = 0; recalcLine(row) })
}

function isLineMarked(row) {
  return !!row?._lineMarked
}

function toggleLineMark(row) {
  if (!row) return
  row._lineMarked = !row._lineMarked
}

function removeSelectedLines() {
  if (!selectedLineKeys.value.length) return ElMessage.warning('请先在选择列点击“删除”标记要移除的明细')
  const s = new Set(selectedLineKeys.value)
  lines.value = lines.value.filter((x) => !s.has(x.__key))
  ElMessage.success('已删除选定明细')
}

async function removeAllLines() {
  await ElMessageBox.confirm('确定删除全部明细吗？', '提示', { type: 'warning' })
  lines.value = []
}

async function addManualLine() {
  const res = await axios.get('/api/stock-in/material-options', { params: { pageSize: 20 } })
  const first = res.data?.data?.list?.[0]
  if (!first) return ElMessage.warning('暂无可选物料')
  lines.value.push(makeLine(first))
}

async function openBatchDialog() {
  if (!form.inboundType) return ElMessage.warning('请先选择入库类型')
  if (!form.inTax) return ElMessage.warning('请先选择是否含税')
  if (!form.warehouseCode) return ElMessage.warning('请先选择仓库')
  if (needsSourceOrder.value && !form.sourceOrderNo) return ElMessage.warning(form.inboundType === '4' ? '请先选择派工单' : '请先选择关联单号')
  if (!isFreeType.value && form.inboundType !== '5' && !form.relatedPartyCode) return ElMessage.warning(`请先选择${relatedLabel.value}`)
  if (form.inboundType === '1') {
    openPurchaseBatchWindow()
    return
  }
  batchVisible.value = true
  batchKeyword.value = ''
  await loadBatchLines()
}

function buildPurchaseBatchCurrentLineKeys() {
  return lines.value.map((line) => String(line.kcao02 ?? '').trim().toLowerCase()).filter(Boolean)
}

function openPurchaseBatchWindow() {
  const sessionId = buildStockBatchSessionId()
  activePurchaseBatchSessionId.value = sessionId
  writeStockBatchContext(sessionId, {
    sourceOrderNo: form.sourceOrderNo,
    supplierCode: form.relatedPartyCode,
    supplierName: form.relatedPartyName,
    excludeReceiptNo: editId.value ? form.receiptNo : '',
    inTax: form.inTax,
    currentLineKeys: buildPurchaseBatchCurrentLineKeys(),
    pageSize: 20,
  })
  const url = `/inventory/daily/stock-in-purchase-batch-window?sessionId=${encodeURIComponent(sessionId)}&sourceOrderNo=${encodeURIComponent(form.sourceOrderNo)}`
  const opened = window.open(url, '_blank')
  purchaseBatchChildWindow.value = opened || null
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

function clearPurchaseBatchSession() {
  activePurchaseBatchSessionId.value = ''
  purchaseBatchChildWindow.value = null
}

function replyPurchaseBatch(source, payload) {
  const target = source && typeof source.postMessage === 'function'
    ? source
    : (purchaseBatchChildWindow.value && !purchaseBatchChildWindow.value.closed
      ? purchaseBatchChildWindow.value
      : null)
  if (!target || typeof target.postMessage !== 'function') return
  target.postMessage(payload, window.location.origin)
}

function applyPurchaseBatchLines(batchRows) {
  const existing = new Set(buildPurchaseBatchCurrentLineKeys())
  const newLines = (batchRows ?? []).filter((row) => {
    const key = String(row.kcao02 ?? row.lineKey ?? '').trim().toLowerCase()
    return key && !existing.has(key)
  }).map((row) => makeLine(row))
  if (!newLines.length) return ElMessage.warning('所选明细已在列表中，或未选择新行')
  lines.value.push(...newLines)
  ElMessage.success(`已批量添加 ${newLines.length} 条入库明细`)
}

function handlePurchaseBatchPayload(payload, source = null, options = {}) {
  const sessionId = String(payload?.sessionId ?? '').trim()
  const allowStoredSession = !!options.allowStoredSession
  if (!sessionId) return false
  if (sessionId !== activePurchaseBatchSessionId.value && !allowStoredSession) return false
  const validation = validateStockBatchApply({
    openedSourceOrderNo: payload.openedSourceOrderNo,
    currentSourceOrderNo: form.sourceOrderNo,
    openedSupplierCode: payload.openedSupplierCode,
    currentSupplierCode: form.relatedPartyCode,
  })
  if (!validation.ok) {
    removeStockBatchResult(sessionId)
    if (allowStoredSession) return false
    if (validation.reason === STOCK_BATCH_REJECT_SOURCE_MISMATCH) ElMessage.warning('采购单号已变更，批量添加已取消')
    else if (validation.reason === STOCK_BATCH_REJECT_SUPPLIER_MISMATCH) ElMessage.warning('供应商已变更，请重新打开批量添加')
    replyPurchaseBatch(source, { type: STOCK_BATCH_MSG_REJECTED, sessionId, reason: validation.reason })
    clearPurchaseBatchSession()
    return false
  }
  const batchRows = Array.isArray(payload.lines) ? payload.lines : []
  if (!batchRows.length) {
    removeStockBatchResult(sessionId)
    replyPurchaseBatch(source, { type: STOCK_BATCH_MSG_REJECTED, sessionId, reason: 'empty-lines' })
    return false
  }
  removeStockBatchResult(sessionId)
  applyPurchaseBatchLines(batchRows)
  replyPurchaseBatch(source, { type: STOCK_BATCH_MSG_ACCEPTED, sessionId, lineCount: batchRows.length })
  clearPurchaseBatchSession()
  return true
}

function handlePurchaseBatchMessage(event) {
  if (event.origin !== window.location.origin) return
  const data = event.data
  if (!data || data.type !== STOCK_BATCH_MSG_APPLY) return
  handlePurchaseBatchPayload(data, event.source)
}

async function loadBatchLines() {
  batchLoading.value = true
  try {
    const url = canManualAdd.value ? '/api/stock-in/material-options' : '/api/stock-in/source-lines'
    const res = await axios.get(url, {
      params: canManualAdd.value
        ? { keyword: batchKeyword.value }
        : { inboundType: form.inboundType, sourceOrderNo: form.sourceOrderNo, keyword: batchKeyword.value },
    })
    batchLines.value = (res.data?.data?.list || []).map((row) => ({ ...row, availableQty: row.availableQty ?? row.kcao03 ?? 0 }))
  } catch (err) {
    ElMessage.error(err.response?.data?.msg || err.message || '读取明细失败')
  } finally {
    batchLoading.value = false
  }
}

function onBatchSelectionChange(selection) {
  batchSelected.value = selection
}

function makeLine(row) {
  const needQty = Number(row.tempx ?? row.needQty ?? row.availableQty ?? 0)
  const overflowCap = Number(row.kcao031 ?? row.overflowCap ?? 0)
  const defaultQty = needQty > 0 ? needQty : (overflowCap > 0 ? overflowCap : 1)
  const line = {
    __key: `${Date.now()}-${Math.random()}`,
    _lineMarked: false,
    kcao02: row.kcao02 || row.lineKey || '',
    kcan04: form.sourceOrderNo,
    tempx: needQty,
    needQty,
    availableQty: overflowCap > 0 ? overflowCap : needQty,
    kcao03: defaultQty,
    kcao031: overflowCap > 0 ? overflowCap : (needQty > 0 ? needQty : 1),
    kcao04: Number(row.kcao04 || row.cost_price || 0) || 0,
    kcao041: Number(row.kcao041 || 0) || 0,
    tax: form.inTax === '2' ? 0 : Number(row.tax || 0) || 0,
    kcaa01: row.kcaa01,
    kcaa02: row.kcaa02,
    kcaa03: row.kcaa03,
    kcaa04: row.kcaa04,
    kcaa11: row.kcaa11,
    kcaa25: row.kcaa25,
    kcaa26: row.kcaa26,
    kcaa27: row.kcaa27,
    reference: row.reference || '',
    location: row.location || '',
    version: row.version || '',
    info: row.info || '',
    sale_price: row.sale_price,
    cost_price: row.cost_price,
    Customer_Name: row.Customer_Name,
    Customer_supply: row.Customer_supply,
    remark: row.remark,
    kpname: row.kpname,
    kcaa02_en: row.kcaa02_en,
    systemcode: row.systemcode || row.GUID || row.kcao02 || '',
  }
  recalcLine(line)
  return line
}

function applyBatchLines() {
  if (!batchSelected.value.length) return ElMessage.warning('请选择明细')
  lines.value.push(...batchSelected.value.map(makeLine))
  batchVisible.value = false
}

function buildPayload() {
  return {
    header: { ...form },
    lines: lines.value.map((line) => ({
      ...line,
      Describe: line.info,
      kcan04: form.sourceOrderNo || line.kcan04,
    })),
  }
}

async function saveReceipt() {
  if (!lines.value.length) return ElMessage.warning('请至少添加一条明细')
  saving.value = true
  try {
    const payload = buildPayload()
    const res = editId.value ? await axios.put(`/api/stock-in/${editId.value}`, payload) : await axios.post('/api/stock-in', payload)
    ElMessage.success(res.data?.data?.autoApproved ? '保存成功，已自动审核' : '保存成功，等待审核')
    switchList()
  } catch (err) {
    ElMessage.error(err.response?.data?.msg || err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function isLocked(row) {
  return row.spFlag === '1' || row.closed === '1' || row.inboundType === '8'
}

function canEdit(row) {
  return row.pass !== '1' && row.del !== '1' && !isLocked(row)
}

function canAudit(row) {
  return row.pass !== '1' && row.del !== '1' && !isLocked(row)
}

function canUnaudit(row) {
  return row.pass === '1' && row.del !== '1' && !isLocked(row)
}

function canDelete(row) {
  return row.pass !== '1' && row.del !== '1' && !isLocked(row)
}

function canReview(row) {
  return showUnreviewed.value
    && row.pass === '1'
    && row.del !== '1'
    && row.spFlag !== '1'
    && row.closed !== '1'
    && String(row.inboundType ?? '') !== '8'
}

function canUnreview(row) {
  return row.pass === '1'
    && row.del !== '1'
    && row.spFlag === '1'
    && row.closed !== '1'
    && String(row.inboundType ?? '') !== '8'
}

async function fetchFilterRelatedParties(keyword = '') {
  const kw = String(keyword ?? '').trim()
  filterRelatedPartyLoading.value = true
  try {
    const useTyped = ['1', '2', '3', '4', '5', '6'].includes(String(filters.inboundType ?? ''))
    const url = useTyped ? '/api/stock-in/related-party-options' : '/api/stock-in/list-related-party-options'
    const params = { keyword: kw }
    if (useTyped) params.inboundType = filters.inboundType
    const res = await axios.get(url, { params })
    filterRelatedParties.value = res.data?.data?.list || []
  } catch {
    filterRelatedParties.value = []
  } finally {
    filterRelatedPartyLoading.value = false
  }
}

function handleFilterRelatedPartyFocus() {
  if (!filterRelatedParties.value.length) fetchFilterRelatedParties('')
}

async function runAction(row, action) {
  const actionText = { audit: '审核', unaudit: '反审核', review: '复核', unreview: '反复核', delete: '删除', restore: '恢复', hard: '彻底删除' }[action]
  await ElMessageBox.confirm(`确定${actionText}这张入库单吗？`, '提示', { type: action === 'delete' || action === 'hard' ? 'warning' : 'info' })
  row.__op = action
  try {
    if (action === 'delete') await axios.delete(`/api/stock-in/${row.id}`)
    else if (action === 'hard') await axios.delete(`/api/stock-in/${row.id}/hard`)
    else await axios.post(`/api/stock-in/${row.id}/${action}`)
    ElMessage.success(`${actionText}成功`)
    loadList()
  } catch (err) {
    ElMessage.error(err.response?.data?.msg || err.message || `${actionText}失败`)
  } finally {
    row.__op = ''
  }
}

function showTodo(msg) {
  ElMessage.info(msg)
}

onMounted(() => {
  loadList()
  loadWarehouses()
  window.addEventListener('message', handlePurchaseBatchMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', handlePurchaseBatchMessage)
})
</script>

<style scoped>
.stock-in-page {
  --stock-chrome: 48px;
  /* DIY：列表「入库单数据」字号，建议 12–15px */
  --stock-receipt-data-size: 13px;
  /* DIY：状态列标签间距 */
  --stock-status-gap: 6px;
  /* DIY：第一行供应商输入框宽度 */
  --stock-filter-related-width: 240px;
  /* DIY：第一行入库类型下拉宽度 */
  --stock-filter-type-width: 160px;
  /* DIY：第二行关键词搜索框宽度 */
  --stock-filter-keyword-width: 420px;
  /* DIY：筛选开关组之间的间隔 */
  --stock-filter-switch-gap: 20px;
}
.stock-in-mode-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.stock-toolbar,
.line-toolbar,
.batch-toolbar,
.form-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.stock-line-mark-btn {
  min-width: 56px;
  color: #e6a23c;
  border-color: #f3d19e;
  background: #fdf6ec;
}
.stock-line-mark-btn:hover,
.stock-line-mark-btn:focus {
  color: #b88230;
  border-color: #eebe77;
  background: #faecd8;
}
.stock-line-mark-btn--on,
.stock-line-mark-btn--on:hover,
.stock-line-mark-btn--on:focus {
  color: #909399;
  border-color: #dcdfe6;
  background: #f4f4f5;
}
.stock-filter-bar {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  margin-bottom: 12px;
}
.stock-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
}
.stock-filter-related {
  width: min(var(--stock-filter-related-width, 240px), 100%);
}
.stock-filter-type {
  width: min(var(--stock-filter-type-width, 160px), 100%);
}
.stock-filter-keyword {
  flex: 0 1 var(--stock-filter-keyword-width, 420px);
  width: min(var(--stock-filter-keyword-width, 420px), 100%);
}
.stock-filter-divider {
  width: 1px;
  height: 22px;
  margin: 0 var(--stock-filter-switch-gap, 20px);
  background: var(--el-border-color);
  flex-shrink: 0;
}
.stock-filter-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.stock-alert {
  margin-bottom: 12px;
}
.stock-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.locked-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}
.stock-status-cell {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--stock-status-gap, 6px);
}
.stock-receipt-data {
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.6;
  font-size: var(--stock-receipt-data-size, 13px);
}
.stock-receipt-data__line {
  white-space: normal;
  word-break: break-all;
}
.code-text {
  font-variant-numeric: tabular-nums;
}
.stock-expand-inner {
  padding: 12px 14px;
  background: #f8fafc;
}
.stock-expand-lines-table {
  width: 100%;
}
.stock-link-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stock-link-info__line {
  line-height: 1.5;
}
.stock-link-info__line--primary {
  color: #1d4ed8;
}
.stock-link-info__line--danger {
  color: #dc2626;
}
.stock-link-info__line--warn {
  color: #d97706;
}
.stock-link-info__line--muted {
  color: #9ca3af;
}
.stock-pagination {
  margin-top: 12px;
  justify-content: flex-start;
}
.form-head {
  justify-content: space-between;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(280px, 1fr));
  gap: 0 16px;
}
.form-grid--single {
  grid-template-columns: minmax(320px, 1fr);
}
.form-wide {
  grid-column: 1 / -1;
}
.stock-form-tabs {
  margin-bottom: 8px;
}
.stock-form--base {
  --stock-base-input-width: 320px;
  --stock-inline-gap: 12px;
  --stock-type-btn-gap: 10px;
  --stock-type-btn-height: 42px;
  --stock-type-btn-padding-x: 14px;
  --stock-type-btn-font-size: 16px;
  --stock-type-btn-radius: 6px;
}
.stock-unified-input {
  width: var(--stock-base-input-width);
}
.copyable-field {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.copyable-field :deep(.el-input) {
  flex: 1 1 auto;
}
.copyable-field :deep(.el-button) {
  flex: 0 0 auto;
}
.source-picker-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.source-picker-field :deep(.el-input) {
  flex: 1 1 auto;
}
.source-picker-field :deep(.el-button) {
  flex: 0 0 auto;
}
.selected-source-line {
  display: flex;
  align-items: center;
  gap: 8px;
  width: var(--stock-base-input-width);
  margin-top: 4px;
  color: #606266;
  font-size: 12px;
  line-height: 18px;
}
.selected-source-line span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stock-remark-input {
  width: 50%;
}
.source-order-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.source-order-toolbar :deep(.el-input) {
  width: 320px;
}
.source-order-pagination {
  margin-top: 12px;
  justify-content: flex-start;
}
.stock-type-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--stock-type-btn-gap);
}
.stock-type-buttons :deep(.stock-type-btn) {
  height: var(--stock-type-btn-height);
  padding: 0 var(--stock-type-btn-padding-x);
  font-size: var(--stock-type-btn-font-size);
  border-radius: var(--stock-type-btn-radius);
}
.form-row-inline :deep(.el-form-item__content) {
  width: 100%;
}
.form-inline-pairs {
  display: flex;
  align-items: center;
  gap: var(--stock-inline-gap);
  width: 100%;
}
.inline-pair {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 2px;
}
.inline-pair__label {
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.detail-grid,
.print-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 10px 18px;
  margin-bottom: 14px;
}
.stock-print-page h2 {
  text-align: center;
  margin: 0 0 16px;
}
.print-table {
  width: 100%;
  border-collapse: collapse;
}
.print-table th,
.print-table td {
  border: 1px solid #333;
  padding: 6px;
  font-size: 13px;
}
.print-table .num {
  text-align: right;
}
@media (max-width: 900px) {
  .form-grid,
  .detail-grid,
  .print-grid {
    grid-template-columns: 1fr;
  }
  .stock-filter-related,
  .stock-filter-type,
  .stock-filter-keyword {
    width: 100%;
  }
  .form-inline-pairs {
    width: 100%;
    flex-direction: column;
    align-items: flex-start;
  }
  .stock-filter-divider {
    display: none;
  }
  .stock-remark-input {
    width: 100%;
  }
}
@media print {
  :global(html.print-stock-in body *) {
    visibility: hidden;
  }
  :global(html.print-stock-in .stock-print-dialog),
  :global(html.print-stock-in .stock-print-dialog *) {
    visibility: visible;
  }
  :global(html.print-stock-in .el-dialog__header),
  :global(html.print-stock-in .el-dialog__footer) {
    display: none !important;
  }
  :global(html.print-stock-in .stock-print-dialog .el-dialog) {
    box-shadow: none;
    width: 100% !important;
    margin: 0 !important;
  }
}
</style>
