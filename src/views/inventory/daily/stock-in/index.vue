<template>
  <div class="erp-module-page stock-in-page" :class="{ 'stock-in-page--form': pageMode === 'form' }">
    <div class="stock-in-mode-bar">
      <el-button :type="pageMode === 'list' ? 'primary' : 'default'" plain @click="switchList">管理入库单</el-button>
      <el-button v-permission="'add'" :type="pageMode === 'form' && !editId ? 'primary' : 'default'" plain @click="newReceipt">
        入库单添加
      </el-button>
      <el-button :type="pageMode === 'material-trace' ? 'primary' : 'default'" plain @click="switchMaterialTrace">转向物料查询</el-button>
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
            <el-option v-for="opt in filterInboundTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
          <template v-if="!showRecycle">
            <div class="stock-filter-divider stock-filter-divider--print" aria-hidden="true" />
            <div class="stock-print-actions">
              <span v-if="printSelectedCount > 0" class="stock-print-selected-hint">已选择：{{ printSelectedCount }}条记录进行打印</span>
              <el-select v-model="printMode" size="small" class="stock-print-mode" aria-label="打印类型">
                <el-option label="打印汇总" value="2" />
                <el-option label="打印明细" value="1" />
              </el-select>
              <el-button size="small" type="primary" plain @click="openSelectedPrint">打印入库单</el-button>
              <el-button size="small" type="primary" plain @click="openSelectedLabelPrint">打印标签</el-button>
            </div>
          </template>
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
          <el-button size="small" @click="resetSearch">重置</el-button>
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
                <el-table-column label="入库数量" prop="kcao03" width="110" align="right">
                  <template #default="{ row: line }">{{ formatTrimNumber(line.kcao03) }}</template>
                </el-table-column>
                <template v-if="hasPricePermission">
                  <el-table-column label="单价" prop="kcao04" width="110" align="right">
                    <template #default="{ row: line }">{{ formatTrimNumber(line.kcao04) }}</template>
                  </el-table-column>
                  <el-table-column label="单价（含税）" prop="kcao041" width="130" align="right">
                    <template #default="{ row: line }">{{ formatTrimNumber(line.kcao041) }}</template>
                  </el-table-column>
                  <el-table-column label="金额" prop="kcao05" width="110" align="right">
                    <template #default="{ row: line }">{{ formatLineAmount(line.kcao05, row.inboundType) }}</template>
                  </el-table-column>
                  <el-table-column label="金额（含税）" prop="kcao051" width="130" align="right">
                    <template #default="{ row: line }">{{ formatLineAmount(line.kcao051, row.inboundType) }}</template>
                  </el-table-column>
                  <el-table-column label="税点" prop="tax" width="100" align="right">
                    <template #default="{ row: line }">{{ formatTrimNumber(line.tax) }}</template>
                  </el-table-column>
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
              <el-button
                v-if="!showRecycle"
                size="small"
                :type="isPrintSelected(row) ? 'primary' : 'default'"
                plain
                @click="togglePrintSelect(row)"
              >
                {{ isPrintSelected(row) ? '已选择' : '打印选择' }}
              </el-button>
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

    <section v-if="pageMode === 'material-trace'" class="erp-section">
      <StockInMaterialTracePanel />
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
                <el-select
                  v-if="isWorkshopPickType"
                  v-model="form.relatedPartyCode"
                  class="stock-unified-input"
                  filterable
                  remote
                  reserve-keyword
                  clearable
                  placeholder="请选择生产车间"
                  :remote-method="loadRelatedParties"
                  @change="onWorkshopChange"
                >
                  <el-option v-for="p in relatedParties" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
                </el-select>
                <el-input
                  v-else
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
                    <el-input ref="paperNoInputRef" v-model="form.paperNo" class="stock-unified-input" />
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

          <el-table
            ref="linesTableRef"
            v-erp-list-h-scroll
            :data="lines"
            border
            stripe
            row-key="__key"
            class="erp-list-table stock-form-lines-table"
          >
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
            <el-table-column label="入库数量" width="130">
              <template #default="{ row }">
                <el-input-number v-model="row.kcao03" :min="0" :formatter="formatTrimNumber" :parser="parseTrimNumber" controls-position="right" @change="recalcLine(row)" />
              </template>
            </el-table-column>
            <template v-if="hasPricePermission">
              <el-table-column label="单价" width="140">
                <template #default="{ row }"><el-input-number v-model="row.kcao04" :formatter="formatTrimNumber" :parser="parseTrimNumber" controls-position="right" @change="recalcLine(row)" /></template>
              </el-table-column>
              <el-table-column label="税点" width="120">
                <template #default="{ row }"><el-input-number v-model="row.tax" :min="0" :formatter="formatTrimNumber" :parser="parseTrimNumber" controls-position="right" @change="recalcLine(row)" /></template>
              </el-table-column>
              <el-table-column label="单价（含税）" width="140">
                <template #default="{ row }"><el-input-number v-model="row.kcao041" :formatter="formatTrimNumber" :parser="parseTrimNumber" controls-position="right" @change="recalcLineFromTaxPrice(row)" /></template>
              </el-table-column>
              <el-table-column label="金额" prop="kcao05" width="120" align="right">
                <template #default="{ row }">{{ formatLineAmount(row.kcao05, form.inboundType) }}</template>
              </el-table-column>
              <el-table-column label="金额（含税）" prop="kcao051" width="120" align="right">
                <template #default="{ row }">{{ formatLineAmount(row.kcao051, form.inboundType) }}</template>
              </el-table-column>
            </template>
            <el-table-column label="PO/PI" width="140">
              <template #default="{ row }"><el-input v-model="row.reference" /></template>
            </el-table-column>
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
          <el-table-column label="数量" prop="kcao03" width="100" align="right">
            <template #default="{ row }">{{ formatTrimNumber(row.kcao03) }}</template>
          </el-table-column>
          <template v-if="hasPricePermission">
            <el-table-column label="单价" prop="kcao04" width="120" align="right">
              <template #default="{ row }">{{ formatTrimNumber(row.kcao04) }}</template>
            </el-table-column>
            <el-table-column label="金额（含税）" prop="kcao051" width="120" align="right">
              <template #default="{ row }">{{ formatLineAmount(row.kcao051, detail.header?.kcan03) }}</template>
            </el-table-column>
          </template>
          <el-table-column label="库位" prop="location" width="120" />
          <el-table-column label="备注" prop="Describe" min-width="160" />
        </el-table>
      </div>
    </el-dialog>

    <el-dialog
      v-model="sourceDialog.visible"
      :title="sourceDialogTitle"
      :width="sourceDialogWidth"
      class="source-order-dialog"
      :class="{ 'source-order-dialog--production': isProductionDispatchPick }"
    >
      <div class="source-order-toolbar">
        <el-select
          v-if="isAssistSourcePick"
          v-model="sourceDialog.assistSupplierCode"
          filterable
          remote
          clearable
          :remote-method="loadSourceDialogAssistSuppliers"
          :loading="sourceDialog.assistSupplierLoading"
          :disabled="sourceDialog.loading"
          placeholder="外协商"
          class="source-order-supplier-select"
          @change="onSourceOrderAssistSupplierChange"
        >
          <el-option v-for="item in sourceDialog.assistSupplierOptions" :key="item.code" :label="`${item.code} ${item.name}`" :value="item.code" />
        </el-select>
        <el-input v-model="sourceDialog.keyword" clearable :disabled="sourceDialog.loading" :placeholder="sourceDialogSearchPlaceholder" @keyup.enter="searchSourceOrders" />
        <el-switch
          v-if="isAssistSourcePick"
          v-model="sourceDialog.includeUnaudited"
          :disabled="sourceDialog.loading"
          active-text="显示未审"
          @change="onSourceOrderAssistIncludeUnauditedChange"
        />
        <el-button type="primary" :loading="sourceDialog.loading" :disabled="sourceDialog.loading" @click="searchSourceOrders">查询</el-button>
      </div>
      <div v-if="isWorkshopPickType && form.relatedPartyCode && !isProductionDispatchPick" class="source-order-workshop-hint">
        当前车间：{{ form.relatedPartyCode }} {{ form.relatedPartyName }}
      </div>
      <el-table
        v-if="isProductionDispatchPick"
        v-loading="sourceDialog.loading"
        :data="productionDispatchPickDisplayList"
        border
        stripe
        max-height="calc(100vh - 280px)"
        class="production-dispatch-pick-table"
        :empty-text="form.inboundType === '4' && !String(sourceDialog.keyword || '').trim() ? '请输入派工单号或PI号后查询' : '暂无数据'"
      >
        <el-table-column label="操作" width="110" align="center" fixed="left">
          <template #default="{ row }">
            <el-button
              v-if="row.showDispatchHead"
              size="small"
              type="primary"
              plain
              @click="chooseProductionDispatchPick(row)"
            >关联选择</el-button>
          </template>
        </el-table-column>
        <el-table-column label="派工单号" min-width="150" fixed="left" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.showDispatchHead">{{ row.dispatchNo }}</span>
          </template>
        </el-table-column>
        <el-table-column label="PI号" prop="piNo" min-width="130" show-overflow-tooltip />
        <el-table-column label="派工日期" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ formatDate(row.dispatchDate) }}</template>
        </el-table-column>
        <el-table-column label="交货日期" prop="deliveryDate" min-width="110" show-overflow-tooltip />
        <el-table-column label="货品编码" prop="kcaa01" min-width="140" show-overflow-tooltip />
        <el-table-column label="货品名称" prop="kcaa02" min-width="160" show-overflow-tooltip />
        <el-table-column label="规格" prop="kcaa03" min-width="120" show-overflow-tooltip />
        <el-table-column label="单位" prop="kcaa04" width="80" show-overflow-tooltip />
        <el-table-column label="派工数量" prop="dispatchQty" width="100" align="right" />
        <el-table-column :label="productionPickQtyLabel" prop="inboundQty" width="110" align="right">
          <template #default="{ row }">{{ form.inboundType === '5' ? row.returnedQty : row.inboundQty }}</template>
        </el-table-column>
        <el-table-column label="返修数量" prop="repairQty" width="100" align="right" />
      </el-table>
      <el-table
        v-else-if="isPurchaseSourcePick"
        v-loading="sourceDialog.loading"
        :data="sourceDialog.list"
        border
        stripe
        max-height="calc(100vh - 280px)"
        class="purchase-source-detail-table"
      >
        <el-table-column label="操作" width="100" align="center" fixed="left">
          <template #default="{ row }">
            <el-button v-if="Number(row.groupRowNo) === 1" size="small" type="primary" plain @click="chooseSourceOrder(row)">关联选择</el-button>
          </template>
        </el-table-column>
        <el-table-column label="采购单号" min-width="150" fixed="left" show-overflow-tooltip>
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? row.sourceOrderNo : '' }}</template>
        </el-table-column>
        <el-table-column label="材料编码" prop="kcaa01" min-width="150" show-overflow-tooltip />
        <el-table-column label="材料名称" prop="kcaa02" min-width="150" show-overflow-tooltip />
        <el-table-column label="规格" prop="kcaa03" min-width="120" show-overflow-tooltip />
        <el-table-column label="采购数量" prop="orderQty" width="110" align="right">
          <template #default="{ row }">{{ formatTrimNumber(row.orderQty) }}</template>
        </el-table-column>
        <template v-if="hasPricePermission">
          <el-table-column label="单价" prop="unitPrice" width="110" align="right">
            <template #default="{ row }">{{ formatTrimNumber(row.unitPrice) }}</template>
          </el-table-column>
          <el-table-column label="单价(含税)" prop="unitPriceTax" width="120" align="right">
            <template #default="{ row }">{{ formatTrimNumber(row.unitPriceTax) }}</template>
          </el-table-column>
          <el-table-column label="金额" prop="amount" width="110" align="right">
            <template #default="{ row }">{{ formatTrimNumber(row.amount) }}</template>
          </el-table-column>
          <el-table-column label="金额(含税)" prop="amountTax" width="120" align="right">
            <template #default="{ row }">{{ formatTrimNumber(row.amountTax) }}</template>
          </el-table-column>
        </template>
        <el-table-column label="入库单未审数" prop="pendingInboundQty" width="120" align="right">
          <template #default="{ row }">{{ formatTrimNumber(row.pendingInboundQty) }}</template>
        </el-table-column>
        <el-table-column label="已入库数量" prop="approvedInboundQty" width="120" align="right">
          <template #default="{ row }">{{ formatTrimNumber(row.approvedInboundQty) }}</template>
        </el-table-column>
        <el-table-column label="退货数量" prop="returnQty" width="110" align="right">
          <template #default="{ row }">{{ formatTrimNumber(row.returnQty) }}</template>
        </el-table-column>
        <el-table-column label="差数" prop="diffQty" width="100" align="right">
          <template #default="{ row }">
            <span :class="{ 'source-diff-positive': Number(row.diffQty || 0) > 0 }">{{ formatTrimNumber(row.diffQty) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="是否存在转换数据" prop="unitConvertText" min-width="190" show-overflow-tooltip />
      </el-table>
      <el-table
        v-else-if="isAssistSourcePick"
        v-loading="sourceDialog.loading"
        :data="sourceDialog.list"
        border
        stripe
        max-height="calc(100vh - 280px)"
        class="assist-source-detail-table"
      >
        <el-table-column label="操作" width="100" align="center" fixed="left">
          <template #default="{ row }">
            <el-button v-if="Number(row.groupRowNo) === 1 && row.pass === '1'" size="small" type="primary" plain @click="chooseSourceOrder(row)">关联选择</el-button>
            <el-tag v-else-if="Number(row.groupRowNo) === 1" type="warning" size="small">未审</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="外协单号" min-width="150" fixed="left" show-overflow-tooltip>
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? row.sourceOrderNo : '' }}</template>
        </el-table-column>
        <el-table-column label="外协日期" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ formatDate(row.assistDate) }}</template>
        </el-table-column>
        <el-table-column label="供应商" min-width="190" show-overflow-tooltip>
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? row.relatedPartyName || '' : '' }}</template>
        </el-table-column>
        <el-table-column label="关联单号" prop="referenceNo" min-width="140" show-overflow-tooltip />
        <el-table-column label="是否含税" width="90" align="center">
          <template #default="{ row }">
            <span v-if="String(row.inTax || '').trim() === '1'" class="source-tax-yes">√</span>
            <span v-else>×</span>
          </template>
        </el-table-column>
        <el-table-column label="备注" prop="remark" min-width="150" show-overflow-tooltip />
        <el-table-column label="材料编码" prop="kcaa01" min-width="150" show-overflow-tooltip />
        <el-table-column label="材料名称" prop="kcaa02" min-width="150" show-overflow-tooltip />
        <el-table-column label="规格" prop="kcaa03" min-width="120" show-overflow-tooltip />
        <el-table-column label="外协数量" prop="orderQty" width="110" align="right">
          <template #default="{ row }">{{ formatTrimNumber(row.orderQty) }}</template>
        </el-table-column>
        <el-table-column label="入库数量" prop="approvedInboundQty" width="110" align="right">
          <template #default="{ row }">{{ formatTrimNumber(row.approvedInboundQty) }}</template>
        </el-table-column>
        <el-table-column label="出库数量" prop="outboundQty" width="110" align="right">
          <template #default="{ row }">{{ formatTrimNumber(row.outboundQty) }}</template>
        </el-table-column>
        <el-table-column label="是否存在转换数据" prop="unitConvertText" min-width="190" show-overflow-tooltip />
      </el-table>
      <el-table v-else v-loading="sourceDialog.loading" :data="sourceDialog.list" border stripe>
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
        <el-table-column :label="sourceOrderLabel" prop="sourceOrderNo" min-width="170" show-overflow-tooltip />
        <el-table-column label="PI号" prop="referenceNo" min-width="150" show-overflow-tooltip />
        <el-table-column :label="relatedLabel" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.relatedPartyCode }} {{ row.relatedPartyName }}
          </template>
        </el-table-column>
        <el-table-column v-if="isPurchaseSourcePick" label="采购日期" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ formatDate(row.buyDate) }}</template>
        </el-table-column>
        <el-table-column v-if="isPurchaseSourcePick" label="交货日期" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column v-if="isPurchaseSourcePick" label="采购员" prop="purchaserName" min-width="120" show-overflow-tooltip />
      </el-table>
      <el-pagination
        v-model:current-page="sourceDialog.page"
        v-model:page-size="sourceDialog.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="sourceDialog.total"
        class="source-order-pagination"
        @size-change="onSourceOrderSizeChange"
        @current-change="onSourceOrderPageChange"
      />
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import { refreshErpTableViewportHScroll } from '@/utils/erpTableViewportHScroll'
import StockInMaterialTracePanel from './material-trace-panel.vue'
import {
  STOCK_BATCH_MSG_ACCEPTED,
  STOCK_BATCH_MSG_APPLY,
  STOCK_BATCH_MSG_REJECTED,
  STOCK_BATCH_REJECT_SOURCE_MISMATCH,
  STOCK_BATCH_REJECT_SUPPLIER_MISMATCH,
  STOCK_BATCH_REJECT_WAREHOUSE_MISMATCH,
  buildStockBatchSessionId,
  buildAssistReturnLineKey,
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
  { value: '4', label: '生产入库' },
  { value: '5', label: '生产退料' },
  { value: '7', label: '盘盈入库' },
  { value: '8', label: '加工入库' },
  { value: '3', label: '外协退料' },
  { value: '6', label: '销售退货' },
]
const filterInboundTypeOptions = inboundTypeOptions
const addableInboundTypes = inboundTypeOptions.filter((x) => !['3', '6', '8'].includes(x.value))

const pageMode = ref('list')
const loading = ref(false)
const saving = ref(false)
const showUnaudited = ref(false)
const showUnreviewed = ref(false)
const showRecycle = ref(false)
const listTableRef = ref(null)
const linesTableRef = ref(null)
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
const paperNoInputRef = ref(null)
const prevWorkshopCode = ref('')

const detailVisible = ref(false)
const detail = reactive({ header: null, lines: [] })
const PURCHASE_SOURCE_PREFETCH_PAGES = 3
const sourceDialog = reactive({
  visible: false,
  loading: false,
  keyword: '',
  page: 1,
  pageSize: 10,
  total: 0,
  list: [],
  cacheKey: '',
  pageCache: {},
  loadedUntilPage: 0,
  loadedRows: 0,
  hasMore: false,
  assistSupplierCode: '',
  assistSupplierOptions: [],
  assistSupplierLoading: false,
  includeUnaudited: false,
})
const activePurchaseBatchSessionId = ref('')
const purchaseBatchChildWindow = ref(null)
const activeOtherBatchSessionId = ref('')
const otherBatchChildWindow = ref(null)
const printMode = ref('2')
const printSelectedReceiptNos = ref(new Set())
const printSelectedCount = computed(() => printSelectedReceiptNos.value.size)

const isFreeType = computed(() => ['0', '7'].includes(form.inboundType))
const isWorkshopPickType = computed(() => ['4', '5'].includes(form.inboundType))
const isProductionDispatchPick = computed(() => ['4', '5'].includes(form.inboundType))
const isPurchaseSourcePick = computed(() => form.inboundType === '1')
const isAssistSourcePick = computed(() => form.inboundType === '2')
const isPrefetchSourcePick = computed(() => isPurchaseSourcePick.value || isAssistSourcePick.value)
const needsSourceOrder = computed(() => ['1', '2', '3', '4', '5', '6'].includes(form.inboundType))
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
const displayReceiptNo = computed(() => (editId.value ? form.receiptNo : suggestedNo.value || '保存后生成最终单号'))
const productionPickQtyLabel = computed(() => (form.inboundType === '5' ? '已退料数量' : '已入库数量'))
const sourceDialogSearchPlaceholder = computed(() => {
  if (isProductionDispatchPick.value) return '派工单号 / PI号'
  if (isWorkshopPickType.value) return `${sourceOrderLabel.value} / PI号`
  return `${sourceOrderLabel.value} / PI号 / ${relatedLabel.value}`
})
const sourceDialogTitle = computed(() => {
  if (isProductionDispatchPick.value) {
    const name = form.relatedPartyName || form.relatedPartyCode || '—'
    return `${form.inboundType === '5' ? '生产退料派工单列表' : '派工单列表'}（已选：${name}）`
  }
  return `选择${sourceOrderLabel.value}`
})
const sourceDialogWidth = computed(() => {
  if (isProductionDispatchPick.value) return '96%'
  if (isPurchaseSourcePick.value) return '96%'
  if (isAssistSourcePick.value) return '96%'
  return '920px'
})
/** 生产入库选派工：同派工单号仅首行显示「关联选择」与单号（对齐旧系统 s_search4） */
const productionDispatchPickDisplayList = computed(() => {
  const seen = new Set()
  return sourceDialog.list.map((row) => {
    const key = String(row.dispatchNo ?? '').trim()
    if (!key) return { ...row, showDispatchHead: true }
    const showDispatchHead = !seen.has(key)
    if (showDispatchHead) seen.add(key)
    return { ...row, showDispatchHead }
  })
})

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
    dispatchSystemcode: '',
    sourceSystemcodeId: '',
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
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const year = v.getFullYear()
    const month = String(v.getMonth() + 1).padStart(2, '0')
    const day = String(v.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const text = String(v).trim()
  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`
  }
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear()
    const month = String(parsed.getMonth() + 1).padStart(2, '0')
    const day = String(parsed.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return text.replace('T', ' ').slice(0, 10)
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

function trimTrailingZeros(text) {
  if (!text.includes('.')) return text
  return text.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
}

function formatTrimNumber(value) {
  if (value === null || value === undefined || value === '') return ''
  const raw = String(value).trim().replace(/,/g, '')
  if (!raw) return ''
  const num = Number(raw)
  if (!Number.isFinite(num)) return String(value)
  if (/e/i.test(raw)) return trimTrailingZeros(num.toString())
  return trimTrailingZeros(raw)
}

function amountPrecisionByInboundType(type = form.inboundType) {
  return String(type ?? '') === '2' ? 4 : 2
}

function formatLineAmount(value, inboundType = form.inboundType) {
  if (value === null || value === undefined || value === '') return ''
  const raw = String(value).trim().replace(/,/g, '')
  if (!raw) return ''
  const num = Number(raw)
  if (!Number.isFinite(num)) return String(value)
  return trimTrailingZeros(num.toFixed(amountPrecisionByInboundType(inboundType)))
}

function parseTrimNumber(value) {
  const num = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(num) ? num : 0
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

function isQuantityLimitedType(type = form.inboundType, sourceOrderNo = form.sourceOrderNo) {
  const t = String(type ?? '')
  return ['1', '2', '3', '4', '5', '6'].includes(t)
}

function getLineQuantityLimit(row) {
  if (!isQuantityLimitedType()) return null
  if (form.inboundType === '3' && Number(row?.kcao031 ?? 0) >= 100000) return null
  if (!String(row?.kcao02 ?? row?.lineKey ?? row?.systemcode ?? '').trim()) return null
  const candidates = [row?.kcao031, row?.availableQty, row?.tempx, row?.needQty]
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n))
  if (!candidates.length) return null
  return Math.max(0, ...candidates)
}

function enforceTaxMode(row, notify = true) {
  const tax = Number(row?.tax ?? 0)
  if (form.inTax === '2' && tax > 0) {
    row.tax = 0
    if (notify) ElMessage.warning('已选择不含税，不可输入税点！如需配置含税参数，请选择含税选项！')
    return false
  }
  return true
}

function enforceQuantityLimit(row, notify = true) {
  const limit = getLineQuantityLimit(row)
  if (limit == null) return true
  const qty = Number(row?.kcao03 ?? 0)
  if (!Number.isFinite(qty)) return true
  if (qty > limit) {
    row.kcao03 = limit
    if (notify) {
      ElMessage.warning(`入库数量不能大于可入库数量！此情况一般出现供应商多送。如需超量入库，请通知采购部门进行订单超订量入库申请。可电邮或通过ERP系统的内部通讯功能通知对方。现可入库最大数量为：${limit}`)
    }
    return false
  }
  return true
}

function recalcLine(row, options = {}) {
  const notify = options.notify !== false
  enforceTaxMode(row, notify)
  enforceQuantityLimit(row, notify)
  const qty = Number(row.kcao03 || 0)
  const ex = Number(row.kcao04 || 0)
  const tax = Number(row.tax || 0)
  const amountPrecision = amountPrecisionByInboundType()
  row.kcao041 = round(ex * (1 + tax), 4)
  row.kcao05 = round(qty * ex, amountPrecision)
  row.kcao051 = round(qty * row.kcao041, amountPrecision)
}

function recalcLineFromTaxPrice(row, options = {}) {
  enforceTaxMode(row, options.notify !== false)
  const tax = Number(row.tax || 0)
  const inc = Number(row.kcao041 || 0)
  row.kcao04 = round(tax ? inc / (1 + tax) : inc, 4)
  recalcLine(row, options)
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
    reconcilePrintSelection()
  } catch (err) {
    ElMessage.error(err.response?.data?.msg || err.message || '读取入库单失败')
  } finally {
    loading.value = false
  }
}

function onSearch() {
  pager.page = 1
  printSelectedReceiptNos.value = new Set()
  loadList()
}

function resetSearch() {
  Object.assign(filters, { keyword: '', inboundType: '', relatedParty: '' })
  filterRelatedParties.value = []
  showUnaudited.value = false
  showUnreviewed.value = false
  showRecycle.value = false
  printSelectedReceiptNos.value = new Set()
  pager.page = 1
  loadList()
}

function switchList() {
  pageMode.value = 'list'
  editId.value = null
  loadList()
}

function switchMaterialTrace() {
  pageMode.value = 'material-trace'
  editId.value = null
}

function onRecycleChange() {
  if (showRecycle.value) {
    showUnaudited.value = false
    showUnreviewed.value = false
  }
  printSelectedReceiptNos.value = new Set()
  pager.page = 1
  loadList()
}

async function newReceipt() {
  editId.value = null
  Object.assign(form, defaultForm())
  lines.value = []
  prevWorkshopCode.value = ''
  relatedParties.value = []
  sourceOrders.value = []
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
  prevWorkshopCode.value = ''
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
    dispatchSystemcode: '',
    sourceSystemcodeId: '',
  })
  lines.value = (data.lines || []).map((line, idx) => ({ ...line, info: line.Describe || '', _lineMarked: false, __key: `${idx}-${line.systemcode || line.id || Date.now()}` }))
  formTab.value = 'base'
  pageMode.value = 'form'
  await Promise.all([loadWarehouses(), loadRelatedParties(), loadSourceOrders()])
  prevWorkshopCode.value = form.relatedPartyCode || ''
  ensureWorkshopOptionVisible()
  await restoreLinkedProductionDispatch()
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

function printKey(row) {
  return String(row?.receiptNo ?? row?.kcan01 ?? '').trim()
}

function reconcilePrintSelection() {
  const visibleKeys = new Set((list.value || []).map((row) => printKey(row)).filter(Boolean))
  const next = new Set()
  for (const key of printSelectedReceiptNos.value) {
    if (visibleKeys.has(key)) next.add(key)
  }
  printSelectedReceiptNos.value = next
}

function isPrintSelected(row) {
  const key = printKey(row)
  return !!key && printSelectedReceiptNos.value.has(key)
}

function togglePrintSelect(row) {
  const key = printKey(row)
  if (!key) {
    ElMessage.warning('该入库单缺少入库单号，不能加入打印')
    return
  }
  const next = new Set(printSelectedReceiptNos.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  printSelectedReceiptNos.value = next
}

function openSelectedPrint() {
  const selected = (list.value || []).filter((row) => isPrintSelected(row)).map((row) => printKey(row))
  if (!selected.length) {
    ElMessage.warning('请选择需要打印的单据。')
    return
  }
  const query = new URLSearchParams({
    p_sum: selected.join(','),
    print_cn: printMode.value || '2',
  })
  window.open(`/inventory/daily/stock-in-print?${query.toString()}`, '_blank')
}

function openSelectedLabelPrint() {
  const selected = (list.value || []).filter((row) => isPrintSelected(row)).map((row) => printKey(row))
  if (!selected.length) {
    ElMessage.warning('请选择需要打印标签的入库单。')
    return
  }
  const query = new URLSearchParams({
    p_sumbq: selected.join(','),
  })
  window.open(`/inventory/daily/stock-in-label-print?${query.toString()}`, '_blank')
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

function isProductionDefaultWarehouse(row) {
  const name = String(row?.name ?? '').trim()
  const code = String(row?.code ?? '').trim()
  return name === '成品仓' || code === '成品仓'
}

async function applyGeneralWarehouseDefault({ force = false } = {}) {
  if (!force && form.warehouseCode) return
  if (!warehouses.value.some(isDefaultWarehouse)) {
    await loadWarehouses('\u8d27\u4ed3')
  }
  const target = warehouses.value.find(isDefaultWarehouse)
  if (!target) return
  form.warehouseCode = target.code || ''
  form.warehouseName = target.name || ''
}

/** 新建单首次填仓库：仅当仓库为空时默认货仓 */
async function applyDefaultWarehouse() {
  await applyGeneralWarehouseDefault({ force: false })
}

/** 切换入库类型后按类型重设仓库：仅生产入库(4)默认成品仓，其余默认货仓 */
async function applyWarehouseForInboundType(inboundType = form.inboundType) {
  if (String(inboundType) === '4') {
    await applyProductionInboundWarehouseDefault()
    return
  }
  await applyGeneralWarehouseDefault({ force: true })
}

async function applyProductionInboundWarehouseDefault() {
  if (!warehouses.value.some(isProductionDefaultWarehouse)) {
    await loadWarehouses('成品仓')
  }
  const target = warehouses.value.find(isProductionDefaultWarehouse)
  if (!target) return
  form.warehouseCode = target.code || ''
  form.warehouseName = target.name || ''
}

async function loadRelatedParties(keyword = '') {
  if (isFreeType.value) return
  const res = await axios.get('/api/stock-in/related-party-options', { params: { inboundType: form.inboundType, keyword } })
  relatedParties.value = res.data?.data?.list || []
  return relatedParties.value
}

async function loadSourceOrders(keyword = '') {
  if (!needsSourceOrder.value && form.inboundType !== '5') return
  const params = { inboundType: form.inboundType, keyword }
  if (isWorkshopPickType.value && form.relatedPartyCode) params.relatedPartyCode = form.relatedPartyCode
  const res = await axios.get('/api/stock-in/source-options', { params })
  sourceOrders.value = res.data?.data?.list || []
}

async function loadSourceDialogAssistSuppliers(keyword = '') {
  if (!isAssistSourcePick.value) return
  sourceDialog.assistSupplierLoading = true
  try {
    const res = await axios.get('/api/stock-in/related-party-options', { params: { inboundType: '2', keyword } })
    sourceDialog.assistSupplierOptions = res.data?.data?.list || []
    if (sourceDialog.assistSupplierCode && !sourceDialog.assistSupplierOptions.some((item) => item.code === sourceDialog.assistSupplierCode)) {
      sourceDialog.assistSupplierOptions.unshift({ code: sourceDialog.assistSupplierCode, name: form.relatedPartyName || sourceDialog.assistSupplierCode })
    }
  } finally {
    sourceDialog.assistSupplierLoading = false
  }
}

function ensureWorkshopOptionVisible() {
  if (!isWorkshopPickType.value || !form.relatedPartyCode) return
  if (relatedParties.value.some((p) => p.code === form.relatedPartyCode)) return
  relatedParties.value.unshift({ code: form.relatedPartyCode, name: form.relatedPartyName || form.relatedPartyCode })
}

function findProductionDefaultWorkshop() {
  return relatedParties.value.find((row) => {
    const name = String(row?.name ?? '').trim()
    const code = String(row?.code ?? '').trim()
    return name === '包装部' || code === '包装部'
  })
}

async function applyProductionInboundWorkshopDefault() {
  if (form.relatedPartyCode) return
  if (!relatedParties.value.some((row) => String(row?.name ?? '').trim() === '包装部' || String(row?.code ?? '').trim() === '包装部')) {
    await loadRelatedParties('包装部')
  }
  const target = findProductionDefaultWorkshop()
  if (!target) return
  form.relatedPartyCode = target.code || ''
  form.relatedPartyName = target.name || ''
  prevWorkshopCode.value = form.relatedPartyCode
}

async function applyProductionInboundDefaults() {
  if (editId.value || form.inboundType !== '4') return
  await Promise.all([
    applyProductionInboundWarehouseDefault(),
    applyProductionInboundWorkshopDefault(),
  ])
}

async function ensureWorkshopValidBeforePick() {
  if (!isWorkshopPickType.value) return true
  const code = String(form.relatedPartyCode ?? '').trim()
  if (!code) {
    ElMessage.warning('请先选择生产车间')
    return false
  }
  if (!relatedParties.value.some((p) => p.code === code)) {
    await loadRelatedParties(code)
  }
  const selected = relatedParties.value.find((p) => p.code === code)
  if (!selected) {
    ElMessage.warning('生产车间选择错误,请重新选择!')
    return false
  }
  form.relatedPartyName = selected.name || form.relatedPartyName || code
  return true
}

async function openSourceOrderDialog() {
  if (!form.inboundType) return ElMessage.warning('请先选择入库类型.')
  if (isFreeType.value) return
  if (isWorkshopPickType.value) {
    const ok = await ensureWorkshopValidBeforePick()
    if (!ok) return
  }
  sourceDialog.visible = true
  sourceDialog.keyword = ''
  sourceDialog.page = 1
  sourceDialog.pageSize = 10
  sourceDialog.includeUnaudited = false
  sourceDialog.assistSupplierCode = isAssistSourcePick.value ? form.relatedPartyCode || '' : ''
  sourceDialog.assistSupplierOptions = []
  resetSourceOrderCache()
  if (isAssistSourcePick.value) await loadSourceDialogAssistSuppliers(form.relatedPartyName || form.relatedPartyCode || '')
  if (form.inboundType === '4') {
    sourceDialog.list = []
    sourceDialog.total = 0
    return
  }
  await loadSourceOrderPage()
}

function searchSourceOrders() {
  if (sourceDialog.loading) return
  sourceDialog.page = 1
  resetSourceOrderCache()
  loadSourceOrderPage()
}

function sourceOrderCacheKey() {
  return [
    form.inboundType,
    sourceDialog.pageSize,
    String(sourceDialog.keyword ?? '').trim(),
    isAssistSourcePick.value ? sourceDialog.assistSupplierCode || '' : '',
    isAssistSourcePick.value ? (sourceDialog.includeUnaudited ? '1' : '0') : '',
  ].join('|')
}

function resetSourceOrderCache() {
  sourceDialog.cacheKey = sourceOrderCacheKey()
  sourceDialog.pageCache = {}
  sourceDialog.loadedUntilPage = 0
  sourceDialog.loadedRows = 0
  sourceDialog.hasMore = false
}

function cacheSourceOrderRows(startPage, rows = []) {
  const pageSize = Number(sourceDialog.pageSize || 10)
  const nextCache = { ...sourceDialog.pageCache }
  const pageCount = Math.ceil(rows.length / pageSize)
  for (let i = 0; i < pageCount; i += 1) {
    const page = startPage + i
    const pageRows = rows.slice(i * pageSize, (i + 1) * pageSize)
    if (pageRows.length) nextCache[page] = pageRows
  }
  sourceDialog.pageCache = nextCache
  sourceDialog.list = nextCache[sourceDialog.page] || []
}

function onSourceOrderSizeChange() {
  sourceDialog.page = 1
  resetSourceOrderCache()
  loadSourceOrderPage()
}

function onSourceOrderPageChange() {
  loadSourceOrderPage()
}

function onSourceOrderAssistSupplierChange() {
  sourceDialog.page = 1
  resetSourceOrderCache()
  loadSourceOrderPage()
}

function onSourceOrderAssistIncludeUnauditedChange() {
  sourceDialog.page = 1
  resetSourceOrderCache()
  loadSourceOrderPage()
}

async function loadSourceOrderPage() {
  if (isFreeType.value) return
  if (isPrefetchSourcePick.value) {
    const cacheKey = sourceOrderCacheKey()
    if (sourceDialog.cacheKey !== cacheKey) resetSourceOrderCache()
    const cachedRows = sourceDialog.pageCache[sourceDialog.page]
    if (cachedRows) {
      sourceDialog.list = cachedRows
      return
    }
  }
  sourceDialog.loading = true
  try {
    if (isProductionDispatchPick.value) {
      const params = {
        workshopCode: form.relatedPartyCode,
        inboundType: form.inboundType,
        keyword: sourceDialog.keyword,
        page: sourceDialog.page,
        pageSize: sourceDialog.pageSize,
      }
      const res = await axios.get('/api/stock-in/production-dispatch-pick-page', { params })
      sourceDialog.list = res.data?.data?.list || []
      sourceDialog.total = Number(res.data?.data?.total || 0)
      if (res.data?.data?.workshopName) form.relatedPartyName = res.data.data.workshopName
      return
    }
    if (isPurchaseSourcePick.value) {
      const cacheKey = sourceOrderCacheKey()
      if (sourceDialog.cacheKey !== cacheKey) resetSourceOrderCache()
      const params = {
        inboundType: form.inboundType,
        keyword: sourceDialog.keyword,
        page: sourceDialog.page,
        pageSize: sourceDialog.pageSize,
        prefetchPages: PURCHASE_SOURCE_PREFETCH_PAGES,
      }
      const res = await axios.get('/api/stock-in/source-order-page', { params })
      const data = res.data?.data || {}
      cacheSourceOrderRows(sourceDialog.page, data.list || [])
      sourceDialog.total = Number(data.total || 0)
      sourceDialog.loadedUntilPage = Number(data.loadedUntilPage || sourceDialog.page)
      sourceDialog.loadedRows = Number(data.loadedRows || 0)
      sourceDialog.hasMore = Boolean(data.hasMore)
      return
    }
    if (isAssistSourcePick.value) {
      const cacheKey = sourceOrderCacheKey()
      if (sourceDialog.cacheKey !== cacheKey) resetSourceOrderCache()
      const params = {
        inboundType: form.inboundType,
        keyword: sourceDialog.keyword,
        page: sourceDialog.page,
        pageSize: sourceDialog.pageSize,
        prefetchPages: PURCHASE_SOURCE_PREFETCH_PAGES,
        assistSupplierCode: sourceDialog.assistSupplierCode || '',
        includeUnaudited: sourceDialog.includeUnaudited ? '1' : '0',
      }
      const res = await axios.get('/api/stock-in/source-order-page', { params })
      const data = res.data?.data || {}
      cacheSourceOrderRows(sourceDialog.page, data.list || [])
      sourceDialog.total = Number(data.total || 0)
      sourceDialog.loadedUntilPage = Number(data.loadedUntilPage || sourceDialog.page)
      sourceDialog.loadedRows = Number(data.loadedRows || 0)
      sourceDialog.hasMore = Boolean(data.hasMore)
      return
    }
    const params = {
      inboundType: form.inboundType,
      keyword: sourceDialog.keyword,
      page: sourceDialog.page,
      pageSize: sourceDialog.pageSize,
    }
    if (isWorkshopPickType.value) params.relatedPartyCode = form.relatedPartyCode
    const res = await axios.get('/api/stock-in/source-order-page', { params })
    sourceDialog.list = res.data?.data?.list || []
    sourceDialog.total = Number(res.data?.data?.total || 0)
  } catch (err) {
    sourceDialog.list = []
    sourceDialog.total = 0
    ElMessage.error(err.response?.data?.msg || err.message || '读取关联单据失败')
    if (isProductionDispatchPick.value && err.response?.status === 400) {
      sourceDialog.visible = false
    }
  } finally {
    sourceDialog.loading = false
  }
}

async function restoreLinkedProductionDispatch() {
  if (!['4', '5'].includes(form.inboundType)) return
  if (String(form.dispatchSystemcode ?? '').trim()) return
  const workshopCode = String(form.relatedPartyCode ?? '').trim()
  const sourceOrderNo = String(form.sourceOrderNo ?? '').trim()
  if (!workshopCode || !sourceOrderNo) return
  let optionMatched = sourceOrders.value.find((item) => String(item.sourceOrderNo ?? '').trim() === sourceOrderNo)
  if (!optionMatched?.sourceSystemcode) {
    try {
      const res = await axios.get('/api/stock-in/source-options', {
        params: {
          inboundType: form.inboundType,
          relatedPartyCode: workshopCode,
          keyword: sourceOrderNo,
        },
      })
      optionMatched = (res.data?.data?.list || []).find((item) => String(item.sourceOrderNo ?? '').trim() === sourceOrderNo)
    } catch {
      optionMatched = null
    }
  }
  if (optionMatched?.sourceSystemcode) {
    form.dispatchSystemcode = optionMatched.sourceSystemcode
    form.sourceSystemcodeId = optionMatched.sourceSystemcode
    if (!form.paperNo && optionMatched.referenceNo) form.paperNo = optionMatched.referenceNo
    if (optionMatched.relatedPartyName) form.relatedPartyName = optionMatched.relatedPartyName
    return
  }
  try {
    const res = await axios.get('/api/stock-in/production-dispatch-pick-page', {
      params: {
        workshopCode,
        inboundType: form.inboundType,
        keyword: sourceOrderNo,
        page: 1,
        pageSize: 20,
      },
    })
    const list = res.data?.data?.list || []
    const matched = list.find((item) => String(item.dispatchNo ?? '').trim() === sourceOrderNo) || list[0]
    if (!matched) return
    form.dispatchSystemcode = matched.dispatchSystemcode || ''
    form.sourceSystemcodeId = matched.dispatchSystemcode || ''
    if (!form.paperNo && matched.piNo) form.paperNo = matched.piNo
    if (matched.workshopName) form.relatedPartyName = matched.workshopName
  } catch {
    // 历史单据如果派工单已无可选明细，仍保留原有关联单号，由批量添加前置校验提示用户重新选择。
  }
}

function onWarehouseChange(v) {
  form.warehouseName = warehouses.value.find((w) => w.code === v)?.name || ''
}

async function onWorkshopChange(v) {
  const nextCode = String(v ?? '').trim()
  const oldCode = String(prevWorkshopCode.value ?? '').trim()
  const hadData = Boolean(form.sourceOrderNo || (isWorkshopPickType.value && form.paperNo) || lines.value.length)
  if (oldCode && oldCode !== nextCode && hadData) {
    try {
      await ElMessageBox.confirm('更换生产车间将清空已选派工单、PI号及明细，是否继续？', '提示', { type: 'warning' })
      lines.value = []
      form.sourceOrderNo = ''
      form.dispatchSystemcode = ''
      form.sourceSystemcodeId = ''
      if (isWorkshopPickType.value) form.paperNo = ''
      sourceOrders.value = []
    } catch {
      form.relatedPartyCode = oldCode
      return
    }
  }
  form.relatedPartyName = relatedParties.value.find((p) => p.code === nextCode)?.name || ''
  if (!nextCode) {
    form.sourceOrderNo = ''
    form.dispatchSystemcode = ''
    form.sourceSystemcodeId = ''
    if (isWorkshopPickType.value) form.paperNo = ''
    sourceOrders.value = []
  }
  prevWorkshopCode.value = nextCode
  loadSourceOrders()
}

function onRelatedPartyChange(v) {
  form.relatedPartyName = relatedParties.value.find((p) => p.code === v)?.name || ''
  form.sourceOrderNo = ''
  form.sourceSystemcodeId = ''
  sourceOrders.value = []
  loadSourceOrders()
}

function applySourceOrder(selected) {
  if (!selected) return
  const nextSourceOrderNo = selected.sourceOrderNo || ''
  const shouldClearPurchaseLines = form.inboundType === '1' && lines.value.length > 0 && form.sourceOrderNo !== nextSourceOrderNo
  const shouldClearAssistLines = form.inboundType === '2' && lines.value.length > 0 && form.sourceOrderNo !== nextSourceOrderNo
  form.sourceOrderNo = selected.sourceOrderNo || ''
  form.sourceSystemcodeId = selected.sourceSystemcode || selected.sourceSystemcodeId || selected.systemCode || ''
  if (!isWorkshopPickType.value) {
    form.relatedPartyCode = selected.relatedPartyCode || ''
    form.relatedPartyName = selected.relatedPartyName || ''
  }
  if (form.inboundType === '4' && selected.referenceNo) form.paperNo = selected.referenceNo
  if (shouldClearPurchaseLines || shouldClearAssistLines) lines.value = []
}

function onSourceOrderChange(v) {
  if (!v) {
    if (!isWorkshopPickType.value) {
      form.relatedPartyCode = ''
      if (!isFreeType.value) form.relatedPartyName = ''
    }
    form.sourceSystemcodeId = ''
    if (['4', '5'].includes(form.inboundType)) form.paperNo = ''
    return
  }
  const selected = sourceOrders.value.find((x) => x.sourceOrderNo === v)
  if (!selected) return
  applySourceOrder(selected)
}

function chooseProductionDispatchPick(row) {
  if (!row) return
  const wsCode = String(row.workshopCode ?? '').trim()
  if (wsCode && form.relatedPartyCode && wsCode !== form.relatedPartyCode) {
    return ElMessage.error('派工单车间与当前所选生产车间不一致')
  }
  form.sourceOrderNo = row.dispatchNo || ''
  form.paperNo = row.piNo || ''
  if (row.workshopName) form.relatedPartyName = row.workshopName
  form.dispatchSystemcode = row.dispatchSystemcode || ''
  form.sourceSystemcodeId = row.dispatchSystemcode || ''
  lines.value = []
  sourceDialog.visible = false
}

function chooseSourceOrder(row) {
  if (row?.pass !== '1') return ElMessage.warning('未审核单据不能选择')
  applySourceOrder(row)
  sourceDialog.visible = false
}

function clearSourceOrder() {
  form.sourceOrderNo = ''
  form.dispatchSystemcode = ''
  form.sourceSystemcodeId = ''
  if (!isWorkshopPickType.value) {
    form.relatedPartyCode = ''
    if (!isFreeType.value) form.relatedPartyName = ''
  }
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
  form.dispatchSystemcode = ''
  form.sourceSystemcodeId = ''
  prevWorkshopCode.value = ''
  relatedParties.value = []
  sourceOrders.value = []
  await loadRelatedParties()
  await applyProductionInboundDefaults()
  await applyWarehouseForInboundType()
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
  if (form.inTax !== '2') return
  const hadTax = lines.value.some((row) => Number(row.tax || 0) > 0)
  lines.value.forEach((row) => { row.tax = 0; recalcLine(row, { notify: false }) })
  if (hadTax) ElMessage.warning('已选择不含税，不可输入税点！如需配置含税参数，请选择含税选项！')
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
  if (['4', '5'].includes(form.inboundType) && !form.relatedPartyCode) return ElMessage.warning('请先选择生产车间')
  if (needsSourceOrder.value && !form.sourceOrderNo) return ElMessage.warning(['4', '5'].includes(form.inboundType) ? '请先选择派工单' : '请先选择关联单号')
  if (form.inboundType === '5') await restoreLinkedProductionDispatch()
  if (form.inboundType === '5' && !String(form.dispatchSystemcode ?? '').trim()) {
    return ElMessage.warning('请先通过「选择」关联派工单后再批量添加')
  }
  if (!isFreeType.value && !form.relatedPartyCode) return ElMessage.warning(`请先选择${relatedLabel.value}`)
  if (form.inboundType === '1') {
    openPurchaseBatchWindow()
    return
  }
  if (form.inboundType === '2') {
    openAssistBatchWindow()
    return
  }
  if (form.inboundType === '3') {
    openAssistReturnBatchWindow()
    return
  }
  if (['4', '5'].includes(form.inboundType)) {
    openProductionBatchWindow()
    return
  }
  if (form.inboundType === '7') {
    openSurplusBatchWindow()
    return
  }
  if (form.inboundType === '0') {
    openOtherInboundBatchWindow()
  }
}

function buildPurchaseBatchCurrentLineKeys() {
  return lines.value.map((line) => String(line.kcao02 ?? '').trim().toLowerCase()).filter(Boolean)
}

function buildAssistReturnCurrentLineKeys() {
  return lines.value
    .map((line) => buildAssistReturnLineKey(line.systemcode ?? line.kcao02, line.pm ?? line.productKcaa01))
    .filter(Boolean)
}

function buildSurplusCurrentLineKeys() {
  return lines.value
    .map((line) => String(line.kcao02 || line.systemcode || line.kcaa01 || '').trim().toLowerCase())
    .filter(Boolean)
}

function buildOtherInboundCurrentLineKeys() {
  return lines.value
    .map((line) => String(line.kcao02 || line.systemcode || line.kcaa01 || '').trim().toLowerCase())
    .filter(Boolean)
}

function openPurchaseBatchWindow() {
  const sessionId = buildStockBatchSessionId()
  activePurchaseBatchSessionId.value = sessionId
  writeStockBatchContext(sessionId, {
    batchType: 'purchase',
    inboundType: form.inboundType,
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

function openAssistBatchWindow() {
  const sessionId = buildStockBatchSessionId()
  activePurchaseBatchSessionId.value = sessionId
  writeStockBatchContext(sessionId, {
    batchType: 'assist',
    inboundType: '2',
    sourceOrderNo: form.sourceOrderNo,
    supplierCode: form.relatedPartyCode,
    supplierName: form.relatedPartyName,
    excludeReceiptNo: editId.value ? form.receiptNo : '',
    inTax: form.inTax,
    currentLineKeys: buildPurchaseBatchCurrentLineKeys(),
    pageSize: 20,
  })
  const url = `/inventory/daily/stock-in-assist-batch-window?sessionId=${encodeURIComponent(sessionId)}&sourceOrderNo=${encodeURIComponent(form.sourceOrderNo)}`
  const opened = window.open(url, '_blank')
  purchaseBatchChildWindow.value = opened || null
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

function openAssistReturnBatchWindow() {
  const sessionId = buildStockBatchSessionId()
  activePurchaseBatchSessionId.value = sessionId
  writeStockBatchContext(sessionId, {
    batchType: 'assist-return',
    inboundType: '3',
    sourceOrderNo: form.sourceOrderNo,
    supplierCode: form.relatedPartyCode,
    supplierName: form.relatedPartyName,
    excludeReceiptNo: editId.value ? form.receiptNo : '',
    inTax: form.inTax,
    currentLineKeys: buildAssistReturnCurrentLineKeys(),
    pageSize: 20,
  })
  const url = `/inventory/daily/stock-in-assist-return-batch-window?sessionId=${encodeURIComponent(sessionId)}&sourceOrderNo=${encodeURIComponent(form.sourceOrderNo)}`
  const opened = window.open(url, '_blank')
  purchaseBatchChildWindow.value = opened || null
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

function openProductionBatchWindow() {
  const sessionId = buildStockBatchSessionId()
  activePurchaseBatchSessionId.value = sessionId
  const isProductionReturn = form.inboundType === '5'
  writeStockBatchContext(sessionId, {
    batchType: isProductionReturn ? 'production-return' : 'production',
    inboundType: isProductionReturn ? '5' : '4',
    sourceOrderNo: form.sourceOrderNo,
    supplierCode: form.relatedPartyCode,
    supplierName: form.relatedPartyName,
    warehouseCode: form.warehouseCode,
    warehouseName: form.warehouseName,
    piNo: form.paperNo,
    dispatchSystemcode: form.dispatchSystemcode,
    excludeReceiptNo: editId.value ? form.receiptNo : '',
    inTax: form.inTax,
    currentLineKeys: buildPurchaseBatchCurrentLineKeys(),
    pageSize: 20,
  })
  const url = `/inventory/daily/stock-in-production-batch-window?sessionId=${encodeURIComponent(sessionId)}&sourceOrderNo=${encodeURIComponent(form.sourceOrderNo)}`
  const opened = window.open(url, '_blank')
  purchaseBatchChildWindow.value = opened || null
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

function openSurplusBatchWindow() {
  const sessionId = buildStockBatchSessionId()
  activePurchaseBatchSessionId.value = sessionId
  writeStockBatchContext(sessionId, {
    batchType: 'surplus',
    inboundType: '7',
    warehouseCode: form.warehouseCode,
    warehouseName: form.warehouseName,
    inTax: form.inTax,
    currentLineKeys: buildSurplusCurrentLineKeys(),
    pageSize: 10,
  })
  const url = `/inventory/daily/stock-in-surplus-batch-window?sessionId=${encodeURIComponent(sessionId)}`
  const opened = window.open(url, '_blank')
  purchaseBatchChildWindow.value = opened || null
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

function openOtherInboundBatchWindow() {
  const sessionId = buildStockBatchSessionId()
  activeOtherBatchSessionId.value = sessionId
  writeStockBatchContext(sessionId, {
    batchType: 'other',
    inboundType: '0',
    warehouseCode: form.warehouseCode,
    warehouseName: form.warehouseName,
    inTax: form.inTax,
    currentLineKeys: buildOtherInboundCurrentLineKeys(),
    pageSize: 10,
  })
  const url = `/inventory/daily/stock-in-other-batch-window?sessionId=${encodeURIComponent(sessionId)}&warehouseCode=${encodeURIComponent(form.warehouseCode)}`
  const opened = window.open(url, '_blank')
  otherBatchChildWindow.value = opened || null
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

function clearOtherInboundBatchSession() {
  activeOtherBatchSessionId.value = ''
  otherBatchChildWindow.value = null
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

function replyOtherInboundBatch(source, payload) {
  const target = source && typeof source.postMessage === 'function'
    ? source
    : (otherBatchChildWindow.value && !otherBatchChildWindow.value.closed ? otherBatchChildWindow.value : null)
  if (!target || typeof target.postMessage !== 'function') return
  target.postMessage(payload, window.location.origin)
}

function applyPurchaseBatchLines(batchRows, batchType = 'purchase') {
  const isReturn = batchType === 'assist-return'
  const isSurplus = batchType === 'surplus'
  const existing = new Set(
    isReturn ? buildAssistReturnCurrentLineKeys() : (isSurplus ? buildSurplusCurrentLineKeys() : buildPurchaseBatchCurrentLineKeys()),
  )
  const newLines = (batchRows ?? []).filter((row) => {
    const key = isReturn
      ? buildAssistReturnLineKey(row.systemcode ?? row.kcao02, row.pm ?? row.productKcaa01)
      : String(row.kcao02 ?? row.lineKey ?? row.systemcode ?? row.kcaa01 ?? '').trim().toLowerCase()
    return key && !existing.has(key)
  }).map((row) => makeLine(row, { batchType }))
  if (!newLines.length) return ElMessage.warning('所选明细已在列表中，或未选择新行')
  lines.value.push(...newLines)
  ElMessage.success(`已批量添加 ${newLines.length} 条入库明细`)
}

function applyOtherInboundBatchLines(batchRows) {
  const existing = new Set(buildOtherInboundCurrentLineKeys())
  const newLines = (batchRows ?? [])
    .filter((row) => {
      const key = String(row.systemcode ?? row.kcaa01 ?? row.lineKey ?? '').trim().toLowerCase()
      return key && !existing.has(key)
    })
    .map((row) => makeLine(row, { batchType: 'other' }))
  if (!newLines.length) return ElMessage.warning('所选明细已在列表中，或未选择新行')
  lines.value.push(...newLines)
  ElMessage.success(`已批量添加 ${newLines.length} 条入库明细`)
}

function handlePurchaseBatchPayload(payload, source = null, options = {}) {
  const sessionId = String(payload?.sessionId ?? '').trim()
  const allowStoredSession = !!options.allowStoredSession
  if (!sessionId) return false
  if (sessionId !== activePurchaseBatchSessionId.value && !allowStoredSession) return false
  const batchType = String(payload?.batchType ?? 'purchase')
  const validation = batchType === 'surplus'
    ? {
        ok: String(payload.openedWarehouseCode ?? '').trim() && String(payload.openedWarehouseCode ?? '').trim() === String(form.warehouseCode ?? '').trim(),
        reason: 'warehouse-mismatch',
      }
    : validateStockBatchApply({
        openedSourceOrderNo: payload.openedSourceOrderNo,
        currentSourceOrderNo: form.sourceOrderNo,
        openedSupplierCode: payload.openedSupplierCode,
        currentSupplierCode: form.relatedPartyCode,
      })
  if (!validation.ok) {
    removeStockBatchResult(sessionId)
    if (allowStoredSession) return false
    if (validation.reason === 'warehouse-mismatch') ElMessage.warning('仓库数据错误，请检查所选仓库')
    else if (validation.reason === STOCK_BATCH_REJECT_SOURCE_MISMATCH) ElMessage.warning('采购单号已变更，批量添加已取消')
    else if (validation.reason === STOCK_BATCH_REJECT_SUPPLIER_MISMATCH) {
      ElMessage.warning(['4', '5'].includes(form.inboundType) ? '生产车间已变更，请重新打开批量添加' : '供应商已变更，请重新打开批量添加')
    }
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
  applyPurchaseBatchLines(batchRows, batchType)
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

function handleOtherInboundBatchPayload(payload, source = null, options = {}) {
  const sessionId = String(payload?.sessionId ?? '').trim()
  const allowStoredSession = !!options.allowStoredSession
  if (!sessionId) return false
  if (sessionId !== activeOtherBatchSessionId.value && !allowStoredSession) return false
  const openedWarehouse = String(payload?.openedWarehouseCode ?? '').trim()
  const currentWarehouse = String(form.warehouseCode ?? '').trim()
  if (!openedWarehouse || !currentWarehouse || openedWarehouse !== currentWarehouse) {
    removeStockBatchResult(sessionId)
    if (!allowStoredSession) {
      ElMessage.warning('仓库数据错误，请检查所选仓库')
      replyOtherInboundBatch(source, { type: STOCK_BATCH_MSG_REJECTED, sessionId, reason: STOCK_BATCH_REJECT_WAREHOUSE_MISMATCH })
      clearOtherInboundBatchSession()
    }
    return false
  }
  const batchRows = Array.isArray(payload.lines) ? payload.lines : []
  if (!batchRows.length) {
    removeStockBatchResult(sessionId)
    replyOtherInboundBatch(source, { type: STOCK_BATCH_MSG_REJECTED, sessionId, reason: 'empty-lines' })
    return false
  }
  removeStockBatchResult(sessionId)
  applyOtherInboundBatchLines(batchRows)
  replyOtherInboundBatch(source, { type: STOCK_BATCH_MSG_ACCEPTED, sessionId, lineCount: batchRows.length })
  clearOtherInboundBatchSession()
  return true
}

function handleOtherInboundBatchMessage(event) {
  if (event.origin !== window.location.origin) return
  const data = event.data
  if (!data || data.type !== STOCK_BATCH_MSG_APPLY) return
  if (String(data?.batchType ?? '') !== 'other') return
  handleOtherInboundBatchPayload(data, event.source)
}

function makeLine(row, options = {}) {
  const isAssistReturn = options.batchType === 'assist-return' || form.inboundType === '3'
  const isProduction = options.batchType === 'production' || options.batchType === 'production-return'
  const needQty = Number(row.tempx ?? row.needQty ?? row.availableQty ?? 0)
  const overflowCap = isAssistReturn ? 100000 : Number(row.kcao031 ?? row.overflowCap ?? 0)
  const defaultQty = isAssistReturn ? 0 : (needQty > 0 ? needQty : (overflowCap > 0 ? overflowCap : 1))
  const line = {
    __key: `${Date.now()}-${Math.random()}`,
    _lineMarked: false,
    kcao02: row.kcao02 || row.lineKey || row.systemcode || '',
    kcan04: form.sourceOrderNo,
    pm: row.pm ?? row.productKcaa01 ?? '',
    productKcaa01: row.pm ?? row.productKcaa01 ?? '',
    tempx: needQty,
    needQty,
    availableQty: isAssistReturn ? 100000 : (overflowCap > 0 ? overflowCap : needQty),
    kcao03: defaultQty,
    kcao031: isAssistReturn ? 100000 : (overflowCap > 0 ? overflowCap : (needQty > 0 ? needQty : 1)),
    kcao04: isProduction ? 0 : (Number(row.kcao04 || row.unitPrice || row.cost_price || 0) || 0),
    kcao041: (isAssistReturn || isProduction) ? 0 : (Number(row.kcao041 || 0) || 0),
    tax: (isProduction || form.inTax === '2') ? 0 : Number(row.tax || 0) || 0,
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
  if (isProduction) {
    for (let i = 1; i <= 35; i += 1) {
      const col = `kcaa${String(i).padStart(2, '0')}`
      if (row[col] != null && row[col] !== '') line[col] = row[col]
    }
  }
  recalcLine(line, { notify: false })
  return line
}

async function refreshLinesTableHScroll() {
  await nextTick()
  linesTableRef.value?.doLayout?.()
  const el = linesTableRef.value?.$el
  if (el) refreshErpTableViewportHScroll(el)
}

watch([formTab, () => lines.value.length], ([tab]) => {
  if (tab !== 'lines') return
  refreshLinesTableHScroll()
})

function validateLineBeforeSave() {
  for (let i = 0; i < lines.value.length; i += 1) {
    const row = lines.value[i]
    if (editId.value && (row.tax === '' || row.tax == null)) {
      ElMessage.warning(`第 ${i + 1} 行税点不能为空，如无税点，则可以填写0。`)
      return false
    }
    if (!enforceTaxMode(row, true)) {
      recalcLine(row, { notify: false })
      return false
    }
    if (!enforceQuantityLimit(row, true)) {
      recalcLine(row, { notify: false })
      return false
    }
  }
  return true
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

async function focusPaperNoInput() {
  formTab.value = 'base'
  await nextTick()
  paperNoInputRef.value?.focus?.()
}

async function validateHeaderBeforeSave() {
  // 外协退料来货单号允许为空
  if (form.inboundType !== '3' && !String(form.paperNo ?? '').trim()) {
    ElMessage.warning(`${paperNoLabel.value}不能为空`)
    await focusPaperNoInput()
    return false
  }
  if (['4', '5'].includes(form.inboundType) && !String(form.relatedPartyCode ?? '').trim()) {
    formTab.value = 'base'
    ElMessage.warning('请先选择生产车间')
    return false
  }
  if (['4', '5'].includes(form.inboundType) && !String(form.sourceOrderNo ?? '').trim()) {
    formTab.value = 'base'
    ElMessage.warning(form.inboundType === '5' ? '生产退料必须选择派工单' : '生产入库必须选择派工单')
    return false
  }
  return true
}

async function saveReceipt() {
  if (!(await validateHeaderBeforeSave())) return
  if (!lines.value.length) return ElMessage.warning('请至少添加一条明细')
  if (!validateLineBeforeSave()) return
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
  window.addEventListener('message', handleOtherInboundBatchMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', handlePurchaseBatchMessage)
  window.removeEventListener('message', handleOtherInboundBatchMessage)
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
.stock-filter-divider--print {
  margin-left: 28px;
  margin-right: 16px;
}
.stock-print-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.stock-print-mode {
  width: 112px;
}
.stock-print-selected-hint {
  font-size: 13px;
  color: var(--el-color-primary);
  white-space: nowrap;
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
.source-order-workshop-hint {
  margin: -4px 0 10px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.source-order-toolbar :deep(.el-input) {
  width: 320px;
}
.source-order-supplier-select {
  width: 260px;
}
.source-order-pagination {
  margin-top: 12px;
  justify-content: flex-start;
}
.source-order-dialog--production :deep(.el-dialog__body) {
  overflow-x: auto;
}
.production-dispatch-pick-table {
  min-width: 1200px;
}
.purchase-source-detail-table {
  min-width: 1680px;
}
.assist-source-detail-table {
  min-width: 1580px;
}
.source-diff-positive {
  color: #dc2626;
  font-weight: 600;
}
.source-tax-yes {
  color: #dc2626;
  font-weight: 700;
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
.detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 10px 18px;
  margin-bottom: 14px;
}
@media (max-width: 900px) {
  .form-grid,
  .detail-grid {
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
</style>
