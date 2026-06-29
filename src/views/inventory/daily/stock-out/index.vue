<template>
  <div class="erp-module-page stock-out-page" :class="{ 'stock-out-page--form': pageMode === 'form' }">
    <div class="stock-out-mode-bar">
      <el-button :type="pageMode === 'list' ? 'primary' : 'default'" plain @click="switchList">管理出库单</el-button>
      <el-button v-permission="'add'" :type="pageMode === 'form' && !editId ? 'primary' : 'default'" plain @click="newOrder">出库单添加</el-button>
      <el-button v-if="isSuperAdmin" plain @click="openCuttingIssueConfig">开料出库配置</el-button>
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
          <el-select v-model="filters.outboundType" clearable class="stock-filter-type" placeholder="出库类型">
            <el-option v-for="opt in outboundTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </div>
        <div class="stock-filter-row stock-filter-row--bottom">
          <el-input
            v-model="filters.keyword"
            clearable
            class="stock-filter-keyword"
            placeholder="出库单号 / 关联单号 / 备注"
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
          </template>
          <el-button size="small" @click="resetSearch">重置</el-button>
        </div>
      </div>

      <el-alert v-if="showRecycle" type="info" show-icon title="当前是回收站：只处理已软删除的待审核出库单。" class="stock-alert" />
      <el-alert v-else-if="showUnaudited" type="warning" show-icon title="当前显示待审核出库单，可编辑、审核或删除。" class="stock-alert" />

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
                :summary-method="(param) => expandLineSummaryMethod(row, param)"
              >
                <el-table-column label="序号" type="index" width="60" align="center" />
                <el-table-column label="材料编码" prop="kcaa01" min-width="140" show-overflow-tooltip />
                <el-table-column label="材料名称" prop="kcaa02" min-width="160" show-overflow-tooltip />
                <el-table-column v-if="!isFinishedOutbound(row)" label="规格" prop="kcaa03" min-width="140" show-overflow-tooltip />
                <el-table-column label="颜色" min-width="120" show-overflow-tooltip>
                  <template #default="{ row: line }">{{ formatCell(line.colorText || line.kcaa11) }}</template>
                </el-table-column>
                <el-table-column v-if="!isFinishedOutbound(row)" label="单位" prop="kcaa04" width="80" />
                <el-table-column label="数量" prop="kcaq03" :width="isFinishedOutbound(row) ? 88 : 110" align="right">
                  <template #default="{ row: line }">{{ formatOutboundQtyDisplay(line.kcaq03) }}</template>
                </el-table-column>
                <template v-if="hasPricePermission">
                  <el-table-column label="单价" prop="kcaq04" :width="isFinishedOutbound(row) ? 92 : 110" align="right">
                    <template #default="{ row: line }">{{ formatExpandDecimal(line.kcaq04) }}</template>
                  </el-table-column>
                  <el-table-column v-if="!isFinishedOutbound(row)" label="单价（含税）" prop="kcaq041" width="130" align="right">
                    <template #default="{ row: line }">{{ formatExpandDecimal(line.kcaq041) }}</template>
                  </el-table-column>
                  <el-table-column label="金额" prop="kcaq05" :width="isFinishedOutbound(row) ? 92 : 110" align="right">
                    <template #default="{ row: line }">{{ formatExpandDecimal(line.kcaq05) }}</template>
                  </el-table-column>
                  <el-table-column v-if="!isFinishedOutbound(row)" label="金额（含税）" prop="kcaq051" width="130" align="right">
                    <template #default="{ row: line }">{{ formatExpandDecimal(line.kcaq051) }}</template>
                  </el-table-column>
                  <el-table-column label="税点" prop="tax" :width="isFinishedOutbound(row) ? 72 : 100" align="right" />
                </template>
                <template v-if="isFinishedOutbound(row)">
                  <el-table-column label="报关单号" prop="reference" min-width="110" show-overflow-tooltip />
                  <el-table-column label="报关型号" prop="Describe" min-width="140" show-overflow-tooltip />
                  <el-table-column label="报关单价" prop="kcaq08" width="92" align="right">
                    <template #default="{ row: line }">{{ formatExpandDecimal(line.kcaq08) }}</template>
                  </el-table-column>
                </template>
                <template v-else>
                  <el-table-column label="PO/PI" prop="reference" min-width="120" show-overflow-tooltip />
                  <el-table-column label="备注" prop="Describe" min-width="180" show-overflow-tooltip />
                </template>
              </el-table>
              <el-empty v-else-if="!row.__linesLoading" description="暂无明细" />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" fixed="left" width="260">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button size="small" plain @click="viewOrder(row)">查看</el-button>
              <el-button size="small" plain @click="printOrder(row)">打印</el-button>
              <template v-if="!showRecycle">
                <el-button v-if="canEdit(row)" v-permission="'edit'" size="small" type="primary" plain @click="editOrder(row)">编辑</el-button>
                <el-button v-if="canAudit(row)" v-permission="'audit'" size="small" plain :loading="row.__op === 'audit'" @click="runAction(row, 'audit')">审核</el-button>
                <el-button v-if="canUnaudit(row)" v-permission="'audit'" size="small" plain :loading="row.__op === 'unaudit'" @click="runAction(row, 'unaudit')">反审核</el-button>
                <el-button v-if="canDelete(row)" v-permission="'delete'" size="small" type="danger" plain :loading="row.__op === 'delete'" @click="runAction(row, 'delete')">删除</el-button>
                <span v-if="isLocked(row)" class="locked-mark" title="此单已结案，不可操作">只读</span>
              </template>
              <template v-else>
                <el-button v-permission="'delete'" size="small" type="primary" plain :loading="row.__op === 'restore'" @click="runAction(row, 'restore')">恢复</el-button>
                <el-button v-permission="'delete'" size="small" type="danger" plain :loading="row.__op === 'hard'" @click="runAction(row, 'hard')">彻底删除</el-button>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <div class="status-tags">
              <el-tag :type="row.pass === '1' ? 'success' : 'warning'" size="small">{{ row.pass === '1' ? '已审核' : '待审核' }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="出库类型" width="130">
          <template #default="{ row }">{{ outboundTypeText(row.outboundType) }}</template>
        </el-table-column>
        <el-table-column label="出库单号" prop="outboundNo" min-width="150" show-overflow-tooltip />
        <el-table-column label="关联单号" prop="sourceOrderNo" min-width="150" show-overflow-tooltip />
        <el-table-column label="出库日期" width="120">
          <template #default="{ row }">{{ formatDate(row.outboundDate) }}</template>
        </el-table-column>
        <el-table-column label="出库单数据" min-width="500" class-name="stock-out-data-col">
          <template #default="{ row }">
            <template v-for="s in [stockOutListSummary(row)]" :key="row.id">
              <div class="stock-out-data">
                <div class="stock-out-data__line">
                  关联单位：<span class="stock-out-data__blue">{{ s.relatedPartyName }}</span>，
                  货仓：<span class="stock-out-data__blue">{{ s.warehouseName }}</span>
                </div>
                <div class="stock-out-data__line">
                  总项数: <span class="stock-out-data__blue">{{ formatNumber(s.itemCount, 0) }}</span>
                  <template v-if="hasPricePermission">
                    &nbsp;&nbsp;含税总价: <span class="stock-out-data__purple">{{ formatMoney(s.taxIncludedTotal) }} 元</span>，
                    不含税总价: <span class="stock-out-data__danger">{{ formatMoney(s.taxExcludedTotal) }} 元</span>，
                    税点总价: <span class="stock-out-data__danger">{{ formatMoney(s.taxTotal) }} 元</span> ,
                  </template>
                  出库总数量: <span class="stock-out-data__danger">{{ formatNumber(s.totalQty) }}</span>
                </div>
              </div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="仓库" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouseName || row.warehouseCode || '-' }}</template>
        </el-table-column>
        <el-table-column label="关联方" prop="relatedPartyName" min-width="180" show-overflow-tooltip />
        <el-table-column label="经手人" prop="handlerName" min-width="110" show-overflow-tooltip />
        <el-table-column label="备注" prop="remark" min-width="180" show-overflow-tooltip />
      </el-table>

      <el-pagination
        v-model:current-page="pager.page"
        v-model:page-size="pager.pageSize"
        :page-sizes="[10, 20, 50, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="pager.total"
        class="pagination"
        @size-change="loadList"
        @current-change="loadList"
      />
    </section>

    <section v-show="pageMode === 'form'" class="erp-section">
      <div class="form-head">
        <strong>{{ editId ? '编辑出库单' : '新增出库单' }}</strong>
        <div>
          <el-button @click="resetForm">重置</el-button>
          <el-button type="primary" :loading="saving" @click="saveOrder">保存</el-button>
        </div>
      </div>

      <el-tabs v-model="formTab">
        <el-tab-pane label="出库单基础资料" name="base">
          <el-form :model="form" label-width="96px" class="stock-form stock-form--base">
            <el-form-item label="出库单号">
              <el-input :model-value="displayOutboundNo" readonly class="stock-unified-input" />
            </el-form-item>
            <el-form-item label="出库日期">
              <el-date-picker v-model="form.outboundDate" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" class="stock-unified-input" />
            </el-form-item>
            <el-form-item label="出库类型">
              <div class="stock-type-buttons">
                <el-button
                  v-for="opt in addableOutboundTypes"
                  :key="opt.value"
                  size="large"
                  class="stock-type-btn"
                  :type="form.outboundType === opt.value ? 'primary' : 'default'"
                  :plain="form.outboundType !== opt.value"
                  :disabled="!!editId"
                  @click="pickOutboundType(opt.value)"
                >
                  {{ opt.label }}
                </el-button>
              </div>
            </el-form-item>
            <el-form-item label="关联单号">
              <el-input
                v-if="isFreeSourceOrder"
                v-model="form.sourceOrderNo"
                class="stock-unified-input"
                clearable
                placeholder="请输入关联单号（选填）"
              />
              <div v-else-if="isPurchaseReturnPicker" class="source-picker-field">
                <el-input :model-value="form.sourceOrderNo" class="stock-unified-input" readonly placeholder="请选择采购单" />
                <el-button type="primary" plain @click="openPurchaseSourcePicker">选择</el-button>
                <el-button plain :disabled="!form.sourceOrderNo" @click="clearSourceOrder">清空</el-button>
              </div>
              <div v-else-if="isAssistIssuePicker" class="source-picker-field">
                <el-input :model-value="form.sourceOrderNo" class="stock-unified-input" readonly placeholder="请选择外协单" />
                <el-button type="primary" plain @click="openAssistSourcePicker">选择</el-button>
                <el-button plain :disabled="!form.sourceOrderNo" @click="clearSourceOrder">清空</el-button>
              </div>
              <div v-else-if="isProductionIssuePicker" class="source-picker-field">
                <el-input :model-value="form.sourceOrderNo" class="stock-unified-input" readonly placeholder="请选择派工单" />
                <el-button type="primary" plain @click="openProductionDispatchSourcePicker">选择</el-button>
                <el-button plain :disabled="!form.sourceOrderNo" @click="clearSourceOrder">清空</el-button>
              </div>
              <div v-else-if="isSupplementProductionIssuePicker" class="source-picker-field">
                <el-input :model-value="form.sourceOrderNo" class="stock-unified-input" readonly placeholder="请选择派工单（选填）" />
                <el-button type="primary" plain @click="openProductionDispatchSourcePicker">选择</el-button>
                <el-button plain :disabled="!form.sourceOrderNo" @click="clearSourceOrder">清空</el-button>
              </div>
              <div v-else-if="isFinishedGoodsPicker" class="source-picker-field">
                <el-input :model-value="form.sourceOrderNo" class="stock-unified-input" readonly placeholder="请选择销售订单" />
                <el-button type="primary" plain @click="openFinishedGoodsSourcePicker">选择</el-button>
                <el-button plain :disabled="!form.sourceOrderNo" @click="clearSourceOrder">清空</el-button>
              </div>
              <el-input
                v-else-if="isLinkedType"
                v-model="form.sourceOrderNo"
                class="stock-unified-input"
                placeholder="关联型出库必须填写来源单号"
              />
              <el-input
                v-else
                v-model="form.sourceOrderNo"
                class="stock-unified-input"
                disabled
                placeholder="当前出库类型无需关联单号"
              />
            </el-form-item>
            <el-form-item :label="relatedPartyLabel">
              <span v-if="form.outboundType === '9'" class="muted">盘亏出库不强制关联单位；关联单号可空且可直接批量添加</span>
              <div v-else-if="form.outboundType === '2'" class="assist-party-row">
                <el-select
                  v-model="form.relatedPartyCode"
                  filterable
                  remote
                  reserve-keyword
                  clearable
                  class="stock-unified-input assist-party-row__party"
                  :remote-method="fetchRelatedParties"
                  @focus="fetchRelatedParties('')"
                  @change="onAssistRelatedPartyChange"
                  placeholder="请选择外协商"
                >
                  <el-option
                    v-for="item in relatedPartyOptions"
                    :key="item.code"
                    :label="formatRelatedPartyOptionLabel(item)"
                    :value="item.code"
                  />
                </el-select>
              </div>
              <el-autocomplete
                v-else-if="form.outboundType === '0'"
                v-model="otherOutboundRelatedPartyInput"
                clearable
                class="stock-unified-input"
                :fetch-suggestions="queryOtherOutboundRelatedParties"
                placeholder="可选销售客户或手填关联单位"
                @select="onOtherOutboundRelatedPartySelect"
              />
              <el-select
                v-else
                v-model="form.relatedPartyCode"
                filterable
                remote
                reserve-keyword
                clearable
                class="stock-unified-input"
                :remote-method="fetchRelatedParties"
                @focus="fetchRelatedParties('')"
                @change="onRelatedPartySelectChange"
                placeholder="请选择关联单位"
              >
                <el-option
                  v-for="item in relatedPartyOptions"
                  :key="item.code"
                  :label="formatRelatedPartyOptionLabel(item)"
                  :value="item.code"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="仓库" class="form-row-inline stock-inline-triple">
              <div class="form-inline-pairs form-inline-pairs--nowrap">
                <el-select v-model="form.warehouseCode" filterable remote reserve-keyword clearable class="stock-inline-input" :remote-method="fetchWarehouses" @focus="fetchWarehouses('')" placeholder="请选择仓库">
                  <el-option v-for="item in warehouseOptions" :key="item.code" :label="`${item.code} ${item.name}`" :value="item.code" />
                </el-select>
                <div class="inline-pair">
                  <span class="inline-pair__label">{{ isAssistIssuePicker || isProductionIssuePicker || supplementProductionIssueUsesPi ? 'PI单号' : (isFinishedGoodsPicker ? 'PO号' : '纸质单号') }}</span>
                  <el-input v-if="isAssistIssuePicker || isProductionIssuePicker || supplementProductionIssueUsesPi" :model-value="form.piNo" class="stock-inline-input" readonly :placeholder="isProductionIssuePicker || supplementProductionIssueUsesPi ? '选择派工单后自动带入' : '选择外协单后自动带入'" />
                  <el-input v-else-if="isFinishedGoodsPicker" :model-value="form.paperNo" class="stock-inline-input" readonly placeholder="选择销售订单后自动带入" />
                  <el-input v-else v-model="form.paperNo" class="stock-inline-input" clearable placeholder="纸质单号" />
                </div>
                <div class="inline-pair">
                  <span class="inline-pair__label">预留单号</span>
                  <el-input v-model="form.reserveNo" class="stock-inline-input" clearable placeholder="预留单号" />
                </div>
              </div>
            </el-form-item>
            <el-form-item label="是否含税">
              <el-radio-group v-model="form.inTax">
                <el-radio-button label="1">含税</el-radio-button>
                <el-radio-button label="2">不含税</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="form.remark" class="stock-remark-input" type="textarea" :rows="3" />
            </el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="出库单明细" name="lines">
          <div class="line-toolbar">
            <el-button type="primary" plain @click="openMaterialPicker">批量添加</el-button>
            <el-button type="danger" plain :disabled="!selectedLineKeys.length" @click="removeSelectedLines">删除选定明细</el-button>
            <el-button type="danger" plain :disabled="!form.lines.length" @click="removeAllLines">删除全部明细</el-button>
            <el-button
              v-if="isFinishedGoodsPicker"
              type="primary"
              plain
              :disabled="!form.lines.length"
              @click="fillCustomsReferenceNo"
            >
              填报关单号
            </el-button>
          </div>
          <el-table
            ref="linesTableRef"
            v-erp-list-h-scroll
            :data="form.lines"
            border
            stripe
            row-key="__key"
            class="erp-list-table stock-out-lines-table"
            :class="{ 'stock-out-lines-table--finished-goods': isFinishedGoodsPicker }"
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
            <el-table-column label="材料编码" prop="kcaa01" :min-width="isFinishedGoodsPicker ? 120 : 140" show-overflow-tooltip />
            <el-table-column label="名称" prop="kcaa02" :min-width="isFinishedGoodsPicker ? 120 : 150" show-overflow-tooltip />
            <el-table-column v-if="!isFinishedGoodsPicker" label="规格" prop="kcaa03" min-width="130" show-overflow-tooltip />
            <el-table-column label="颜色" prop="kcaa11" :min-width="isFinishedGoodsPicker ? 80 : 100" show-overflow-tooltip />
            <el-table-column v-if="!isFinishedGoodsPicker" label="单位" prop="kcaa04" width="90" show-overflow-tooltip />
            <el-table-column label="数量" :width="isFinishedGoodsPicker ? finishedGoodsLineColWidth.qty : 130">
              <template #default="{ row }">
                <el-input-number
                  v-model="row.kcaq03"
                  :min="0"
                  :precision="3"
                  :controls="!isFinishedGoodsPicker"
                  :controls-position="isFinishedGoodsPicker ? undefined : 'right'"
                  class="stock-out-line-number-input"
                  @change="normalizeLineQty(row)"
                />
              </template>
            </el-table-column>
            <template v-if="hasPricePermission">
              <el-table-column label="单价" :width="isFinishedGoodsPicker ? finishedGoodsLineColWidth.price : 140">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.kcaq04"
                    :min="0"
                    :precision="4"
                    :controls="!isFinishedGoodsPicker"
                    :controls-position="isFinishedGoodsPicker ? undefined : 'right'"
                    class="stock-out-line-number-input"
                    @change="recalcLine(row)"
                  />
                </template>
              </el-table-column>
              <el-table-column v-if="!isFinishedGoodsPicker" label="单价(含税)" width="140">
                <template #default="{ row }"><el-input-number v-model="row.kcaq041" :min="0" :precision="4" controls-position="right" @change="reverseLine(row)" /></template>
              </el-table-column>
              <el-table-column label="税点" :width="isFinishedGoodsPicker ? finishedGoodsLineColWidth.tax : 120">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.tax"
                    :min="0"
                    :precision="4"
                    :controls="!isFinishedGoodsPicker"
                    :controls-position="isFinishedGoodsPicker ? undefined : 'right'"
                    class="stock-out-line-number-input"
                    @change="recalcLine(row)"
                  />
                </template>
              </el-table-column>
              <el-table-column label="金额" :width="isFinishedGoodsPicker ? finishedGoodsLineColWidth.amount : 110" prop="kcaq05" />
              <el-table-column v-if="!isFinishedGoodsPicker" label="金额(含税)" width="120" prop="kcaq051" />
            </template>
            <template v-if="isFinishedGoodsPicker">
              <el-table-column label="报关单号" :min-width="finishedGoodsLineColWidth.customsRef" class-name="stock-out-line-wide-col">
                <template #default="{ row }">
                  <el-input v-model="row.reference" class="stock-out-line-wide-input" />
                </template>
              </el-table-column>
              <el-table-column label="报关型号" :min-width="finishedGoodsLineColWidth.customsModel" class-name="stock-out-line-wide-col">
                <template #default="{ row }">
                  <el-input v-model="row.Describe" class="stock-out-line-wide-input" />
                </template>
              </el-table-column>
              <el-table-column label="报关单价" :width="finishedGoodsLineColWidth.customsPrice">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.kcaq08"
                    :min="0"
                    :precision="4"
                    :controls="false"
                    class="stock-out-line-number-input"
                  />
                </template>
              </el-table-column>
            </template>
            <template v-else>
              <el-table-column label="厂款号/PI号" min-width="420" class-name="stock-out-line-wide-col">
                <template #default="{ row }">
                  <el-input v-model="row.reference" class="stock-out-line-wide-input" />
                </template>
              </el-table-column>
              <el-table-column label="备注" min-width="420" class-name="stock-out-line-wide-col">
                <template #default="{ row }">
                  <el-input v-model="row.Describe" class="stock-out-line-wide-input" />
                </template>
              </el-table-column>
            </template>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-dialog v-model="purchaseSourceDialog.visible" title="采购订单列表" width="92%">
      <div class="stock-filter-row" style="margin-bottom: 10px;">
        <el-input
          v-model="purchaseSourceDialog.supplier"
          clearable
          class="stock-unified-input"
          placeholder="供应商（编码或名称）"
          @keyup.enter="searchPurchaseSourcePage"
        />
        <el-input
          v-model="purchaseSourceDialog.keyword"
          clearable
          class="stock-filter-keyword"
          placeholder="采购单号/日期/供应商/币别等模糊查询"
          @keyup.enter="searchPurchaseSourcePage"
        />
        <el-button type="primary" @click="searchPurchaseSourcePage">查询</el-button>
        <el-button @click="clearPurchaseSourceFilter">重置</el-button>
      </div>
      <el-table v-loading="purchaseSourceDialog.loading" :data="purchaseSourceDialog.list" border stripe height="460">
        <el-table-column label="操作" width="90" fixed="left">
          <template #default="{ row }">
            <el-button v-if="Number(row.groupRowNo) === 1" type="primary" size="small" @click="choosePurchaseSource(row)">关联选择</el-button>
          </template>
        </el-table-column>
        <el-table-column label="采购单号" min-width="150">
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? row.sourceOrderNo : '' }}</template>
        </el-table-column>
        <el-table-column label="采购日期" min-width="120">
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? formatDate(row.buyDate) : '' }}</template>
        </el-table-column>
        <el-table-column label="供应商" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? `${row.supplierCode || ''},${row.supplierName || ''}` : '' }}</template>
        </el-table-column>
        <el-table-column label="是否含税" width="90" align="center">
          <template #default="{ row }">
            <span v-if="Number(row.groupRowNo) === 1" :style="{ color: isPurchaseTaxIncluded(row.taxIncluded) ? '#dc2626' : '#a855f7' }">
              {{ purchaseTaxMark(row.taxIncluded) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? (row.remark || '-') : '' }}</template>
        </el-table-column>
        <el-table-column label="材料编码" prop="kcaa01" min-width="130" show-overflow-tooltip />
        <el-table-column label="入库数量" prop="orderQty" width="110" align="right" />
        <el-table-column label="材料名称" prop="kcaa02" min-width="150" show-overflow-tooltip />
        <el-table-column label="规格" prop="kcaa03" min-width="120" show-overflow-tooltip />
        <el-table-column label="采购币别/汇率" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ `${row.currencyName || '-'} / ${row.exchangeRate || '1'}` }}</template>
        </el-table-column>
        <el-table-column label="使用单位" prop="kcaa04" width="90" />
        <el-table-column label="采购数量" prop="orderQty" width="110" align="right" />
        <el-table-column label="单价" prop="kcak04" width="110" align="right" />
        <el-table-column label="单价含税" prop="kcak041" width="120" align="right" />
        <el-table-column label="金额" prop="kcak05" width="110" align="right" />
        <el-table-column label="金额含税" prop="kcak051" width="120" align="right" />
        <el-table-column label="出库数量" prop="outQty" width="110" align="right" />
        <el-table-column label="是否存在转换数据" prop="hasConvertData" width="150" />
      </el-table>
      <el-pagination
        v-model:current-page="purchaseSourceDialog.page"
        v-model:page-size="purchaseSourceDialog.pageSize"
        :page-sizes="[10, 20, 50, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="purchaseSourceDialog.total"
        class="pagination"
        @size-change="searchPurchaseSourcePage"
        @current-change="loadPurchaseSourcePage"
      />
    </el-dialog>

    <el-dialog v-model="assistSourceDialog.visible" title="外协订单列表" width="92%">
      <div class="stock-filter-row" style="margin-bottom: 10px;">
        <el-input
          v-model="assistSourceDialog.keyword"
          clearable
          class="stock-filter-keyword"
          placeholder="PI号 / 外协商 / 外协单号模糊查询"
          @keyup.enter="searchAssistSourcePage"
        />
        <el-button type="primary" @click="searchAssistSourcePage">查询</el-button>
        <el-button @click="clearAssistSourceFilter">重置</el-button>
      </div>
      <el-table v-loading="assistSourceDialog.loading" :data="assistSourceDialog.list" border stripe height="460">
        <el-table-column label="操作" width="90" fixed="left">
          <template #default="{ row }">
            <el-button v-if="Number(row.groupRowNo) === 1" type="primary" size="small" @click="chooseAssistSource(row)">关联选择</el-button>
          </template>
        </el-table-column>
        <el-table-column label="外协单号" min-width="150">
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? row.sourceOrderNo : '' }}</template>
        </el-table-column>
        <el-table-column label="关联单号" min-width="130">
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? (row.referenceNo || '-') : '' }}</template>
        </el-table-column>
        <el-table-column label="外协日期" min-width="120">
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? formatDate(row.assistDate) : '' }}</template>
        </el-table-column>
        <el-table-column label="供应商" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? `${row.supplierCode || ''},${row.supplierName || ''}` : '' }}</template>
        </el-table-column>
        <el-table-column label="是否含税" width="90" align="center">
          <template #default="{ row }">
            <span v-if="Number(row.groupRowNo) === 1" :style="{ color: isPurchaseTaxIncluded(row.taxIncluded) ? '#dc2626' : '#a855f7' }">
              {{ purchaseTaxMark(row.taxIncluded) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? (row.remark || '-') : '' }}</template>
        </el-table-column>
        <el-table-column label="材料编码" prop="kcaa01" min-width="130" show-overflow-tooltip />
        <el-table-column label="材料名称" prop="kcaa02" min-width="150" show-overflow-tooltip />
        <el-table-column label="规格" prop="kcaa03" min-width="120" show-overflow-tooltip />
        <el-table-column label="外协币别/汇率" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ `${row.currencyName || '-'} / ${row.exchangeRate || '1'}` }}</template>
        </el-table-column>
        <el-table-column label="使用单位" prop="kcaa04" width="90" />
        <el-table-column label="外协数量" prop="orderQty" width="110" align="right" />
        <template v-if="hasPricePermission">
          <el-table-column label="单价" prop="wxak04" width="110" align="right" />
          <el-table-column label="单价含税" prop="wxak041" width="120" align="right" />
          <el-table-column label="金额" prop="wxak05" width="110" align="right" />
          <el-table-column label="金额含税" prop="wxak051" width="120" align="right" />
        </template>
        <el-table-column label="入库数量" prop="inboundQty" width="110" align="right" />
        <el-table-column label="出库数量" prop="outQty" width="110" align="right" />
        <el-table-column label="是否存在转换数据" prop="hasConvertData" width="150" />
      </el-table>
      <el-pagination
        v-model:current-page="assistSourceDialog.page"
        v-model:page-size="assistSourceDialog.pageSize"
        :page-sizes="[10, 20, 50, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="assistSourceDialog.total"
        class="pagination"
        @size-change="searchAssistSourcePage"
        @current-change="loadAssistSourcePage"
      />
    </el-dialog>

    <el-dialog
      v-model="productionDispatchSourceDialog.visible"
      :title="productionDispatchSourceDialogTitle"
      width="96%"
      class="production-dispatch-source-dialog"
    >
      <div class="stock-filter-row production-dispatch-toolbar">
        <span class="production-dispatch-toolbar__label">显示条件</span>
        <el-radio-group v-model="productionDispatchSourceDialog.displayMode" @change="onProductionDispatchDisplayModeChange">
          <el-radio-button label="header">只显示派工单号</el-radio-button>
          <el-radio-button label="full">全部显示</el-radio-button>
        </el-radio-group>
      </div>
      <div class="stock-filter-row production-dispatch-toolbar">
        <span class="production-dispatch-toolbar__label">查询条件</span>
        <el-input
          v-model="productionDispatchSourceDialog.keyword"
          clearable
          class="stock-filter-keyword"
          placeholder="派工单号 / PI号 / 日期 / 货品等"
          @keyup.enter="searchProductionDispatchSourcePage"
        />
        <el-button type="primary" @click="searchProductionDispatchSourcePage">立即查询</el-button>
        <el-button @click="resetProductionDispatchSourceFilter">重置</el-button>
        <el-button @click="queryAllProductionDispatchSourcePage">查询全部</el-button>
        <el-button @click="productionDispatchSourceDialog.visible = false">关闭</el-button>
      </div>
      <el-table
        v-loading="productionDispatchSourceDialog.loading"
        :data="productionDispatchSourceDialog.list"
        border
        stripe
        height="460"
      >
        <el-table-column label="操作" width="100" fixed="left">
          <template #default="{ row }">
            <el-button
              v-if="Number(row.groupRowNo) === 1"
              type="primary"
              size="small"
              @click="chooseProductionDispatchSource(row)"
            >关联选择</el-button>
          </template>
        </el-table-column>
        <el-table-column label="关联出库单号" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? (row.relatedOutboundNo || '-') : '' }}</template>
        </el-table-column>
        <el-table-column label="派工单号" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? (row.dispatchNo || '-') : '' }}</template>
        </el-table-column>
        <el-table-column label="PI号" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? (row.piNo || '-') : '' }}</template>
        </el-table-column>
        <el-table-column label="派工日期" min-width="120">
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? formatDate(row.dispatchDate) : '' }}</template>
        </el-table-column>
        <el-table-column label="交货日期" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? formatDate(row.deliveryDate) : '' }}</template>
        </el-table-column>
        <el-table-column label="录入时间" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ Number(row.groupRowNo) === 1 ? formatDateTime(row.addtime) : '' }}</template>
        </el-table-column>
        <template v-if="productionDispatchSourceDialog.displayMode === 'full'">
          <el-table-column label="货品编码" prop="kcaa01" min-width="140" show-overflow-tooltip />
          <el-table-column label="货品名称" prop="kcaa02" min-width="160" show-overflow-tooltip />
          <el-table-column label="规格" prop="kcaa03" min-width="120" show-overflow-tooltip />
          <el-table-column label="单位" prop="kcaa04" width="80" show-overflow-tooltip />
          <el-table-column label="派工数量" prop="dispatchQty" width="100" align="right" />
          <el-table-column label="已入库数量" prop="inboundQty" width="110" align="right" />
          <el-table-column label="返修数量" prop="repairQty" width="100" align="right" />
        </template>
      </el-table>
      <el-pagination
        v-model:current-page="productionDispatchSourceDialog.page"
        v-model:page-size="productionDispatchSourceDialog.pageSize"
        :page-sizes="[5, 10, 25, 50, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="productionDispatchSourceDialog.total"
        class="pagination"
        @size-change="searchProductionDispatchSourcePage"
        @current-change="loadProductionDispatchSourcePage"
      />
    </el-dialog>

    <el-dialog v-model="finishedGoodsSourceDialog.visible" title="PI关联选择" width="760px">
      <div class="stock-filter-row production-dispatch-toolbar">
        <span class="production-dispatch-toolbar__label">查询条件</span>
        <el-input
          v-model="finishedGoodsSourceDialog.keyword"
          clearable
          class="stock-filter-keyword"
          placeholder="PI号 / PO号 / 客户 / 销售单号等"
          @keyup.enter="searchFinishedGoodsSourcePage"
        />
        <el-button type="primary" @click="searchFinishedGoodsSourcePage">立即查询</el-button>
        <el-button @click="resetFinishedGoodsSourceFilter">重置</el-button>
        <el-button @click="queryAllFinishedGoodsSourcePage">查询全部</el-button>
        <el-button @click="finishedGoodsSourceDialog.visible = false">关闭</el-button>
      </div>
      <el-table v-loading="finishedGoodsSourceDialog.loading" :data="finishedGoodsSourceDialog.list" border stripe height="460">
        <el-table-column label="操作" width="100" fixed="left">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="chooseFinishedGoodsSource(row)">关联选择</el-button>
          </template>
        </el-table-column>
        <el-table-column label="PI号" prop="sourceOrderNo" min-width="150" show-overflow-tooltip />
        <el-table-column label="PO号" prop="poNo" min-width="140" show-overflow-tooltip />
        <el-table-column label="客户" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ `${row.customerCode || ''},${row.customerName || ''},` }}</template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="finishedGoodsSourceDialog.page"
        v-model:page-size="finishedGoodsSourceDialog.pageSize"
        :page-sizes="[10, 20, 50, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="finishedGoodsSourceDialog.total"
        class="pagination"
        @size-change="searchFinishedGoodsSourcePage"
        @current-change="loadFinishedGoodsSourcePage"
      />
    </el-dialog>

    <el-dialog v-model="cuttingIssueConfigDialog.visible" title="开料出库配置" width="720px" destroy-on-close>
      <p class="cutting-config-desc">
        勾选纳入开料部（车间 04）生产领料批量添加的物料分类；对应物理表字段 <code>UB_ERP_Stocks_material.cutting_issue</code>。
      </p>
      <el-alert
        v-if="cuttingIssueConfigDialog.errorMsg"
        :title="cuttingIssueConfigDialog.errorMsg"
        type="error"
        show-icon
        class="cutting-config-alert"
      />
      <el-table v-loading="cuttingIssueConfigDialog.loading" :data="cuttingIssueConfigDialog.list" border stripe max-height="420">
        <el-table-column prop="code" label="分类编码" width="120" />
        <el-table-column prop="name" label="分类名称" min-width="200" show-overflow-tooltip />
        <el-table-column label="纳入开料出库" width="140" align="center">
          <template #default="{ row }">
            <el-switch
              v-model="row.cutting_issue"
              active-value="1"
              inactive-value="0"
              :disabled="cuttingIssueConfigDialog.saving"
            />
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="cuttingIssueConfigDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="cuttingIssueConfigDialog.saving" @click="saveCuttingIssueConfig">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="出库单详情" width="86%">
      <el-descriptions v-if="detail.header" :column="3" border>
        <el-descriptions-item label="出库单号">{{ detail.header.kcap01 || detail.header.outboundNo }}</el-descriptions-item>
        <el-descriptions-item label="出库类型">{{ outboundTypeText(detail.header.kcap03 || detail.header.outboundType) }}</el-descriptions-item>
        <el-descriptions-item label="审核状态">{{ detail.header.pass === '1' ? '已审核' : '待审核' }}</el-descriptions-item>
        <el-descriptions-item label="仓库">{{ detail.header.ck || detail.header.kcap06 }}</el-descriptions-item>
        <el-descriptions-item label="关联方">{{ detail.header.kehu || detail.header.kcap05 }}</el-descriptions-item>
        <el-descriptions-item label="关联单号">{{ detail.header.kcap04 || '-' }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="detail.lines" border stripe class="detail-lines">
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column prop="kcaa01" label="材料编码" min-width="140" />
        <el-table-column prop="kcaa02" label="名称" min-width="150" />
        <el-table-column prop="kcaa03" label="规格" min-width="130" />
        <el-table-column prop="kcaa11" label="颜色" width="100" />
        <el-table-column prop="kcaq03" label="数量" width="110" />
        <template v-if="hasPricePermission">
          <el-table-column prop="kcaq04" label="单价" width="110" />
          <el-table-column prop="kcaq05" label="金额" width="110" />
        </template>
        <template v-if="isFinishedOutbound(detail.header)">
          <el-table-column prop="reference" label="报关单号" min-width="140" show-overflow-tooltip />
          <el-table-column prop="Describe" label="报关型号" min-width="180" show-overflow-tooltip />
          <el-table-column prop="kcaq08" label="报关单价" width="110" align="right" />
        </template>
        <template v-else>
          <el-table-column prop="reference" label="PO/PI" min-width="120" show-overflow-tooltip />
          <el-table-column prop="Describe" label="备注" min-width="180" show-overflow-tooltip />
        </template>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import { refreshErpTableViewportHScroll } from '@/utils/erpTableViewportHScroll'
import {
  STOCK_OUT_BATCH_MSG_APPLY,
  STOCK_OUT_BATCH_MSG_ACCEPTED,
  STOCK_OUT_BATCH_MSG_REJECTED,
  STOCK_OUT_BATCH_REJECT_WAREHOUSE_MISMATCH,
  buildStockOutBatchSessionId,
  readStockOutBatchResult,
  removeStockOutBatchResult,
  validateStockOutBatchApply,
  writeStockOutBatchContext,
} from '@/utils/stockOutBatchAdd'
import {
  STOCK_OUT_PR_BATCH_MSG_APPLY,
  STOCK_OUT_PR_BATCH_MSG_ACCEPTED,
  STOCK_OUT_PR_BATCH_MSG_REJECTED,
  buildStockOutPurchaseReturnBatchSessionId,
  readStockOutPurchaseReturnBatchResult,
  removeStockOutPurchaseReturnBatchResult,
  validateStockOutPurchaseReturnBatchApply,
  writeStockOutPurchaseReturnBatchContext,
} from '@/utils/stockOutPurchaseReturnBatchAdd'
import {
  STOCK_OUT_AI_BATCH_MSG_APPLY,
  STOCK_OUT_AI_BATCH_MSG_ACCEPTED,
  STOCK_OUT_AI_BATCH_MSG_REJECTED,
  buildStockOutAssistIssueBatchSessionId,
  readStockOutAssistIssueBatchResult,
  removeStockOutAssistIssueBatchResult,
  validateStockOutAssistIssueBatchApply,
  writeStockOutAssistIssueBatchContext,
} from '@/utils/stockOutAssistIssueBatchAdd'
import {
  STOCK_OUT_PI_BATCH_MSG_APPLY,
  STOCK_OUT_PI_BATCH_MSG_ACCEPTED,
  STOCK_OUT_PI_BATCH_MSG_REJECTED,
  buildStockOutProductionIssueBatchSessionId,
  readStockOutProductionIssueBatchResult,
  removeStockOutProductionIssueBatchResult,
  resolveProductionIssueBatchLineKey,
  validateStockOutProductionIssueBatchApply,
  writeStockOutProductionIssueBatchContext,
} from '@/utils/stockOutProductionIssueBatchAdd'
import {
  buildAssistIssueLineKey,
  buildAssistIssueMaterialDedupKey,
  resolveAssistIssueBatchLineKey,
} from '@/utils/stockOutAssistIssueLineKey'
import {
  STOCK_OUT_FG_BATCH_MSG_APPLY,
  STOCK_OUT_FG_BATCH_MSG_ACCEPTED,
  STOCK_OUT_FG_BATCH_MSG_REJECTED,
  buildStockOutFinishedGoodsBatchSessionId,
  deriveFinishedGoodsCustomsModel,
  readStockOutFinishedGoodsBatchResult,
  removeStockOutFinishedGoodsBatchResult,
  validateStockOutFinishedGoodsBatchApply,
  writeStockOutFinishedGoodsBatchContext,
} from '@/utils/stockOutFinishedGoodsBatchAdd'

const MENU_PATH = 'inventory/daily/stock-out'
const OUTBOUND_TYPES = [
  { value: '0', label: '其他出库' },
  { value: '1', label: '采购退货' },
  { value: '2', label: '外协领料' },
  { value: '3', label: '外协退货' },
  { value: '4', label: '生产领料' },
  { value: '5', label: '生产返修' },
  { value: '6', label: '成品出库' },
  { value: '10', label: '销售出库' },
  { value: '7', label: '生产领料（计划外）' },
  { value: '8', label: '生产领料（补数）' },
  { value: '9', label: '盘亏出库' },
]
const pageMode = ref('list')
const formTab = ref('base')
const showRecycle = ref(false)
const showUnaudited = ref(false)
const listTableRef = ref(null)
const linesTableRef = ref(null)
const expandedRowKeys = ref([])
const loading = ref(false)
const saving = ref(false)
const list = ref([])
const editId = ref(null)
const suggestedNo = ref('')
const warehouseOptions = ref([])
const relatedPartyOptions = ref([])
/** 其他出库：关联单位输入框展示值（下拉候选 + 手填文本） */
const otherOutboundRelatedPartyInput = ref('')
const filterRelatedParties = ref([])
const filterRelatedPartyLoading = ref(false)
const detailVisible = ref(false)
const detail = reactive({ header: null, lines: [] })
const activeOtherBatchSessionId = ref('')
const otherBatchChildWindow = ref(null)
const activePurchaseReturnBatchSessionId = ref('')
const purchaseReturnBatchChildWindow = ref(null)
const activeAssistIssueBatchSessionId = ref('')
const assistIssueBatchChildWindow = ref(null)
const activeProductionIssueBatchSessionId = ref('')
const productionIssueBatchChildWindow = ref(null)
const activeFinishedGoodsBatchSessionId = ref('')
const finishedGoodsBatchChildWindow = ref(null)
const purchaseSourceDialog = reactive({
  visible: false,
  loading: false,
  supplier: '',
  keyword: '',
  page: 1,
  pageSize: 10,
  total: 0,
  list: [],
})
const assistSourceDialog = reactive({
  visible: false,
  loading: false,
  keyword: '',
  page: 1,
  pageSize: 10,
  total: 0,
  list: [],
})
const productionDispatchSourceDialog = reactive({
  visible: false,
  loading: false,
  displayMode: 'header',
  keyword: '',
  page: 1,
  pageSize: 10,
  total: 0,
  list: [],
})
const finishedGoodsSourceDialog = reactive({
  visible: false,
  loading: false,
  keyword: '',
  page: 1,
  pageSize: 10,
  total: 0,
  list: [],
})
const prevWorkshopCode = ref('')

/** 超级管理员：开料出库配置按钮（读登录写入的 erp_user；兼容旧会话未带 is_admin 字段） */
const isSuperAdmin = computed(() => {
  try {
    const raw = localStorage.getItem('erp_user')
    if (!raw) return false
    const user = JSON.parse(raw)
    if (
      Number(user?.is_admin) === 1
      || Number(user?.IsAdmin) === 1
      || user?.isAdmin === true
      || user?.IsAdmin === true
    ) {
      return true
    }
    // 旧会话：超级管理员登录时 Permissions 为 {"*":["all"]} 或角色名为系统管理员
    if (String(user?.RoleName ?? '').trim() === '系统管理员') return true
    const permRaw = String(user?.Permissions ?? '').trim()
    if (permRaw.includes('"*"') && permRaw.includes('all')) return true
    return false
  } catch {
    return false
  }
})

const cuttingIssueConfigDialog = reactive({
  visible: false,
  loading: false,
  saving: false,
  errorMsg: '',
  list: [],
})

const pager = reactive({ page: 1, pageSize: 10, total: 0 })
const filters = reactive({ outboundType: '', keyword: '', relatedParty: '' })
const form = reactive(defaultForm())

const outboundTypeOptions = OUTBOUND_TYPES
/** 新增页类型按钮：隐藏外协退货(3)、生产返修(5)；历史单编辑仍可读原类型 */
const addableOutboundTypes = computed(() => OUTBOUND_TYPES.filter((t) => !['3', '5'].includes(t.value)))
const permissionModel = computed(() => getPermissionModelFromStorage())
const hasPricePermission = computed(() => hasPageAction(permissionModel.value, MENU_PATH, 'price'))
const displayOutboundNo = computed(() => form.outboundNo || suggestedNo.value || '保存时生成')
const isLinkedType = computed(() => ['1', '2', '3', '4', '5', '6'].includes(form.outboundType))
const isFreeSourceOrder = computed(() => ['0', '9', '10'].includes(form.outboundType))
const isPurchaseReturnPicker = computed(() => form.outboundType === '1')
const isAssistIssuePicker = computed(() => form.outboundType === '2')
const isProductionIssuePicker = computed(() => form.outboundType === '4')
const isSupplementProductionIssuePicker = computed(() => ['7', '8'].includes(form.outboundType))
/** 计划外领料：已选派工单时 PI 占 kcap08，与生产领料一致 */
const supplementProductionIssueUsesPi = computed(() => isSupplementProductionIssuePicker.value && !!String(form.sourceOrderNo ?? '').trim())
/** 计划外领料且已选派工：批量/数量校验与生产领料同口径 */
const isSupplementProductionIssueWithDispatch = computed(() => supplementProductionIssueUsesPi.value)
const isFinishedGoodsPicker = computed(() => form.outboundType === '6')
/** 成品出库编辑明细：收窄列宽，尽量一屏展示（仅 UI，数据仍完整保存） */
const finishedGoodsLineColWidth = computed(() => ({
  qty: 100,
  price: 100,
  tax: 88,
  amount: 96,
  customsRef: 140,
  customsModel: 160,
  customsPrice: 110,
}))
const productionDispatchSourceDialogTitle = computed(() => {
  const name = form.relatedPartyName || form.relatedPartyCode || '—'
  return `派工单列表(已选生产车间:${name})`
})
const selectedLineKeys = computed(() => form.lines.filter((line) => line._lineMarked).map((line) => line.__key))
const relatedPartyLabel = computed(() => {
  if (['1'].includes(form.outboundType)) return '供应商'
  if (form.outboundType === '2') return '外协商'
  if (['3'].includes(form.outboundType)) return '外协客户'
  if (['4', '5', '7', '8'].includes(form.outboundType)) return '生产车间'
  if (form.outboundType === '6') return '客户'
  return '关联单位'
})

/** 其他出库关联单位为销售客户，选项格式：编码,名称 */
function formatRelatedPartyOptionLabel(item) {
  const code = String(item?.code ?? '').trim()
  const name = String(item?.name ?? '').trim()
  if (form.outboundType === '0' || form.outboundType === '2' || form.outboundType === '6') return name ? `${code},${name}` : code
  if (['4', '5', '7', '8'].includes(form.outboundType)) return name ? `${code},${name},` : `${code},`
  return name ? `${code} ${name}` : code
}

function ensureRelatedPartyOptionSeed() {
  const code = String(form.relatedPartyCode ?? '').trim()
  const name = String(form.relatedPartyName ?? '').trim()
  if (!code && !name) return
  if (!relatedPartyOptions.value.some((item) => item.code === code)) {
    relatedPartyOptions.value = [{ code, name }, ...relatedPartyOptions.value]
  }
}

function syncOtherOutboundRelatedPartyDisplay() {
  const code = String(form.relatedPartyCode ?? '').trim()
  const name = String(form.relatedPartyName ?? '').trim()
  if (code) {
    otherOutboundRelatedPartyInput.value = name ? `${code},${name}` : code
    return
  }
  otherOutboundRelatedPartyInput.value = name
}

function matchOtherOutboundRelatedPartyOption(text) {
  const t = String(text ?? '').trim()
  if (!t) return null
  return relatedPartyOptions.value.find((item) => {
    const label = formatRelatedPartyOptionLabel(item)
    return label === t || item.code === t
  }) || null
}

function applyOtherOutboundRelatedPartyInput(val) {
  const text = String(val ?? '').trim()
  if (!text) {
    form.relatedPartyCode = ''
    form.relatedPartyName = ''
    return
  }
  const hit = matchOtherOutboundRelatedPartyOption(text)
  if (hit) {
    form.relatedPartyCode = hit.code
    form.relatedPartyName = hit.name
    return
  }
  // 手填文本：只写 kehu，kcap05 留空
  form.relatedPartyCode = ''
  form.relatedPartyName = text
}

function onOtherOutboundRelatedPartySelect(item) {
  form.relatedPartyCode = String(item?.code ?? '').trim()
  form.relatedPartyName = String(item?.name ?? '').trim()
  otherOutboundRelatedPartyInput.value = formatRelatedPartyOptionLabel(item)
}

async function queryOtherOutboundRelatedParties(queryString, cb) {
  await fetchRelatedParties(queryString)
  cb(relatedPartyOptions.value.map((item) => ({
    value: formatRelatedPartyOptionLabel(item),
    code: item.code,
    name: item.name,
  })))
}

watch(otherOutboundRelatedPartyInput, (val) => {
  if (form.outboundType !== '0') return
  applyOtherOutboundRelatedPartyInput(val)
})

function nowText() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function formatDateTime(v) {
  if (!v) return ''
  return String(v).replace('T', ' ').slice(0, 19)
}

function defaultForm() {
  return {
    outboundNo: '',
    outboundDate: nowText(),
    outboundType: '0',
    sourceOrderNo: '',
    relatedPartyCode: '',
    relatedPartyName: '',
    warehouseCode: '',
    handlerName: '',
    paperNo: '',
    piNo: '',
    reserveNo: '',
    postProcessAssist: false,
    workshopCode: '',
    workshopName: '',
    sourceSystemcodeId: '',
    inTax: '1',
    remark: '',
    lines: [],
  }
}

function outboundTypeText(value) {
  return OUTBOUND_TYPES.find((item) => item.value === String(value ?? ''))?.label || '-'
}

function formatDate(value) {
  return String(value ?? '').slice(0, 10) || '-'
}

function onRelatedPartySelectChange(code) {
  if (form.outboundType === '4' || isSupplementProductionIssuePicker.value) {
    onProductionWorkshopChange(code)
    return
  }
  const hit = relatedPartyOptions.value.find((item) => item.code === code)
  form.relatedPartyName = hit?.name || ''
}

async function onProductionWorkshopChange(code) {
  const nextCode = String(code ?? '').trim()
  const oldCode = String(prevWorkshopCode.value ?? '').trim()
  const hadData = Boolean(form.sourceOrderNo || form.piNo || form.lines.length)
  if (oldCode && oldCode !== nextCode && hadData) {
    try {
      await ElMessageBox.confirm('更换生产车间将清空已选派工单、PI号及明细，是否继续？', '提示', { type: 'warning' })
      form.lines = []
      form.sourceOrderNo = ''
      form.sourceSystemcodeId = ''
      form.piNo = ''
    } catch {
      form.relatedPartyCode = oldCode
      return
    }
  }
  const hit = relatedPartyOptions.value.find((item) => item.code === nextCode)
  form.relatedPartyName = hit?.name || ''
  if (!nextCode) {
    form.sourceOrderNo = ''
    form.sourceSystemcodeId = ''
    form.piNo = ''
    form.lines = []
  }
  prevWorkshopCode.value = nextCode
}

function formatCell(value) {
  const text = String(value ?? '').trim()
  return text || '-'
}

function coerceScalarValue(value) {
  if (Array.isArray(value)) return value.length ? value[0] : null
  return value
}

function toNumber(value) {
  const scalar = coerceScalarValue(value)
  const n = Number(scalar)
  return Number.isFinite(n) ? n : 0
}

function formatNumber(value, precision = 2) {
  return toNumber(value).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: precision })
}

function formatMoney(value) {
  return toNumber(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 出库数量：界面和提交统一保留三位小数 */
function roundOutboundQty(value) {
  const n = toNumber(value)
  return Math.round(n * 1000) / 1000
}

/** 生产领料明细：取最紧上限（需出库 / 还需出库 / PI剩余 / 实际库存），批量带回行才有这些字段 */
function getProductionIssueLineQtyCap(row) {
  if (!row) return null
  const sourceLine = String(row.kcaq02 ?? row.sourceLineCode ?? row.scak02 ?? '').trim()
  if (!sourceLine) return null

  const limits = []
  const push = (value, label) => {
    const v = roundOutboundQty(value)
    if (v > 0) limits.push({ value: v, label })
  }
  push(row.sourceDemandQty ?? row.dispatchDemandQty, '需出库数量')
  push(row.stillNeedQty, '还需出库数量')
  push(row.piRemainingQty, 'PI剩余可领数量')
  push(row.kcaq031 ?? row.warehouseActualQty, '实际库存')

  if (!limits.length) return null
  return limits.reduce((min, item) => (item.value < min.value ? item : min), limits[0])
}

let productionIssueQtyAlerting = false

async function normalizeLineQty(row) {
  if (!row) return
  const qty = roundOutboundQty(row.kcaq03)
  row.kcaq03 = qty

  const useProductionIssueQtyCap = form.outboundType === '4'
    || (isSupplementProductionIssuePicker.value && isSupplementProductionIssueWithDispatch.value)
  if (useProductionIssueQtyCap && !productionIssueQtyAlerting) {
    const capInfo = getProductionIssueLineQtyCap(row)
    if (capInfo && qty > capInfo.value) {
      productionIssueQtyAlerting = true
      try {
        await ElMessageBox.alert(
          `出库数量不能大于${capInfo.label} ${formatOutboundQtyDisplay(capInfo.value)}`,
          '提示',
          { type: 'warning', confirmButtonText: '确定' },
        )
      } finally {
        productionIssueQtyAlerting = false
      }
      row.kcaq03 = capInfo.value
    }
  }
  recalcLine(row)
}

function formatOutboundQtyDisplay(value) {
  return String(roundOutboundQty(value))
}

/** 展开明细数值：固定两位小数、不加千分位逗号 */
function formatExpandDecimal(value) {
  const n = toNumber(value)
  return (Math.round(n * 100) / 100).toFixed(2)
}

/** 列表「出库单数据」汇总（主表 kehu/ck + 明细聚合字段） */
function stockOutListSummary(row) {
  const taxIncludedTotal = toNumber(row?.taxIncludedTotal)
  const taxExcludedTotal = toNumber(row?.taxExcludedTotal)
  const taxTotal = row?.taxTotal != null && row?.taxTotal !== ''
    ? toNumber(row.taxTotal)
    : Math.round((taxIncludedTotal - taxExcludedTotal) * 100) / 100
  return {
    relatedPartyName: formatCell(row?.relatedPartyName),
    warehouseName: formatCell(row?.warehouseName || row?.warehouseCode),
    itemCount: toNumber(row?.itemCount),
    taxIncludedTotal,
    taxExcludedTotal,
    taxTotal,
    totalQty: toNumber(row?.totalQty),
  }
}

function canEdit(row) {
  return row.pass !== '1' && row.del !== '1' && row.closed !== '1'
}
function canAudit(row) {
  return row.pass !== '1' && row.del !== '1' && row.closed !== '1'
}
function canUnaudit(row) {
  return row.pass === '1' && row.del !== '1' && row.closed !== '1'
}
function canDelete(row) {
  return row.pass !== '1' && row.del !== '1' && row.closed !== '1'
}
function isLocked(row) {
  return row.closed === '1'
}

function isFinishedOutbound(row) {
  return String(row?.outboundType ?? row?.kcap03 ?? '') === '6'
}

function formatSubtotalQty(n) {
  return formatOutboundQtyDisplay(n)
}

function formatSubtotalUnitPrice(n) {
  if (n === null || n === undefined) return '—'
  const num = Number(n)
  if (!Number.isFinite(num)) return '—'
  return formatExpandDecimal(num)
}

/** 展开明细小计：汇总数量与金额，单价为金额÷数量 */
function calcStockOutExpandSubtotal(lines = []) {
  let quantity = 0
  let amountEx = 0
  let amountInc = 0
  for (const line of lines) {
    quantity += toNumber(line?.kcaq03)
    amountEx += toNumber(line?.kcaq05)
    amountInc += toNumber(line?.kcaq051 ?? line?.kcaq05)
  }
  return {
    quantity,
    amountEx,
    amountInc,
    unitPriceEx: quantity > 0 ? amountEx / quantity : null,
    unitPriceInc: quantity > 0 ? amountInc / quantity : null,
  }
}

function expandLineSummaryMethod(row, { columns }) {
  const sub = calcStockOutExpandSubtotal(row?.__lines || [])
  const finished = isFinishedOutbound(row)
  return columns.map((col) => {
    const prop = col.property
    if (prop === 'kcaa04') return '小计：'
    if (prop === 'kcaq03') return formatSubtotalQty(sub.quantity)
    if (prop === 'kcaq04') return formatSubtotalUnitPrice(sub.unitPriceEx)
    if (prop === 'kcaq041') return formatSubtotalUnitPrice(sub.unitPriceInc)
    if (prop === 'kcaq05') return formatExpandDecimal(sub.amountEx)
    if (prop === 'kcaq051') return formatExpandDecimal(sub.amountInc)
    if (finished && prop === 'kcaq08') return ''
    return ''
  })
}

async function fetchDetail(id) {
  const res = await axios.get(`/api/stock-out/${id}`)
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
    ElMessage.error(err.response?.data?.msg || err.message || '读取出库单明细失败')
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
  if (target?.closest?.('.row-actions, .stock-expand-inner, .el-button, .el-table__expand-icon, a')) return
  listTableRef.value?.toggleRowExpansion(row)
}

async function loadList() {
  loading.value = true
  try {
    const { data } = await axios.get('/api/stock-out/list', {
      params: {
        page: pager.page,
        pageSize: pager.pageSize,
        recycled: showRecycle.value ? 1 : 0,
        showUnaudited: showUnaudited.value ? 1 : 0,
        outboundType: filters.outboundType,
        keyword: filters.keyword,
        relatedParty: filters.relatedParty,
      },
    })
    list.value = data?.data?.list || []
    pager.total = Number(data?.data?.total || 0)
    expandedRowKeys.value = []
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '读取出库单列表失败')
  } finally {
    loading.value = false
  }
}

function onSearch() {
  pager.page = 1
  loadList()
}
function resetSearch() {
  Object.assign(filters, { outboundType: '', keyword: '', relatedParty: '' })
  filterRelatedParties.value = []
  showUnaudited.value = false
  showRecycle.value = false
  pager.page = 1
  loadList()
}
function onRecycleChange() {
  showUnaudited.value = false
  onSearch()
}
function toggleRecycle() {
  showRecycle.value = !showRecycle.value
  onRecycleChange()
}

async function openCuttingIssueConfig() {
  if (!isSuperAdmin.value) return
  cuttingIssueConfigDialog.visible = true
  cuttingIssueConfigDialog.errorMsg = ''
  cuttingIssueConfigDialog.loading = true
  try {
    const { data } = await axios.get('/api/stock-out/cutting-issue-config')
    if (data?.code !== 200) {
      cuttingIssueConfigDialog.errorMsg = data?.msg || '读取配置失败'
      cuttingIssueConfigDialog.list = []
      return
    }
    cuttingIssueConfigDialog.list = (data?.data?.list ?? []).map((row) => ({
      ...row,
      cutting_issue: String(row.cutting_issue) === '1' ? '1' : '0',
    }))
  } catch (err) {
    cuttingIssueConfigDialog.errorMsg = err?.response?.data?.msg || err.message || '读取配置失败'
    cuttingIssueConfigDialog.list = []
  } finally {
    cuttingIssueConfigDialog.loading = false
  }
}

async function saveCuttingIssueConfig() {
  if (!isSuperAdmin.value || cuttingIssueConfigDialog.saving) return
  cuttingIssueConfigDialog.saving = true
  cuttingIssueConfigDialog.errorMsg = ''
  try {
    const items = cuttingIssueConfigDialog.list.map((row) => ({
      id: row.id,
      cutting_issue: String(row.cutting_issue) === '1' ? '1' : '0',
    }))
    const { data } = await axios.put('/api/stock-out/cutting-issue-config', { items })
    if (data?.code !== 200) {
      ElMessage.error(data?.msg || '保存失败')
      return
    }
    ElMessage.success(data?.msg || '保存成功')
    cuttingIssueConfigDialog.visible = false
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '保存失败')
  } finally {
    cuttingIssueConfigDialog.saving = false
  }
}

function switchList() {
  pageMode.value = 'list'
  loadList()
}

async function newOrder() {
  editId.value = null
  Object.assign(form, defaultForm())
  form.lines = []
  otherOutboundRelatedPartyInput.value = ''
  prevWorkshopCode.value = ''
  pageMode.value = 'form'
  formTab.value = 'base'
  await applyDefaultWarehouseForType()
  try {
    const { data } = await axios.get('/api/stock-out/suggest-doc-no')
    suggestedNo.value = data?.data?.suggested || ''
  } catch {
    suggestedNo.value = ''
  }
}

/** 生产领料编辑态：按派工单批量接口补齐明细行的数量上限字段（库中不存，仅供前端校验） */
async function enrichProductionIssueLineQtyCaps() {
  const isDispatchIssue = form.outboundType === '4'
    || (isSupplementProductionIssuePicker.value && isSupplementProductionIssueWithDispatch.value)
  if (!isDispatchIssue) return
  if (!form.sourceOrderNo || !form.warehouseCode || !form.piNo || !form.relatedPartyCode) return
  if (!form.lines.length) return
  try {
    const { data } = await axios.get('/api/stock-out/production-issue-batch-lines', {
      params: {
        sourceOrderNo: form.sourceOrderNo,
        workshopCode: form.relatedPartyCode,
        warehouseCode: form.warehouseCode,
        piNo: form.piNo,
        excludeOutboundNo: editId.value ? form.outboundNo : '',
        page: 1,
        pageSize: 200,
      },
    })
    const capByMaterial = new Map()
    for (const row of data?.data?.list || []) {
      const key = String(row.kcaa01 ?? '').trim().toLowerCase()
      if (key) capByMaterial.set(key, row)
    }
    if (!capByMaterial.size) return
    for (const line of form.lines) {
      const cap = capByMaterial.get(String(line.kcaa01 ?? '').trim().toLowerCase())
      if (!cap) continue
      const stockCap = roundOutboundQty(cap.warehouseActualQty ?? cap.kcaq031)
      const stillNeed = roundOutboundQty(cap.stillNeedQty)
      const sourceDemand = roundOutboundQty(cap.sourceDemandQty ?? cap.dispatchDemandQty)
      const piRemaining = roundOutboundQty(cap.piRemainingQty)
      if (sourceDemand > 0) line.sourceDemandQty = sourceDemand
      if (stillNeed > 0) line.stillNeedQty = stillNeed
      if (piRemaining >= 0 && cap.piRemainingQty != null) line.piRemainingQty = piRemaining
      if (cap.piDemandQty != null) line.piDemandQty = roundOutboundQty(cap.piDemandQty)
      if (cap.piIssuedQty != null) line.piIssuedQty = roundOutboundQty(cap.piIssuedQty)
      if (cap.dispatchStillNeedQty != null) line.dispatchStillNeedQty = roundOutboundQty(cap.dispatchStillNeedQty)
      if (stockCap > 0) {
        line.kcaq031 = stockCap
        line.availableQty = stockCap
      }
      if (stillNeed > 0) line.sourceAvailableQty = stillNeed
    }
  } catch {
    // 上限补齐失败不阻断编辑；保存时后端仍会校验
  }
}

async function editOrder(row) {
  try {
    const { data } = await axios.get(`/api/stock-out/${row.id}`)
    const h = data?.data?.header || {}
    const outboundType = String(h.kcap03 || row.outboundType || '0')
    const isAssist = outboundType === '2'
    const isProduction = outboundType === '4'
    const isSupplementProduction = ['7', '8'].includes(outboundType)
    const sourceOrderNo = h.kcap04 || ''
    const usesPiNo = isAssist || isProduction || (isSupplementProduction && String(sourceOrderNo).trim())
    editId.value = row.id
    Object.assign(form, {
      outboundNo: h.kcap01 || row.outboundNo || '',
      outboundDate: formatDateTime(h.kcap02 || row.outboundDate),
      outboundType,
      sourceOrderNo,
      relatedPartyCode: h.kcap05 || '',
      relatedPartyName: h.kehu || '',
      warehouseCode: h.kcap06 || '',
      handlerName: h.kcap07 || '',
      paperNo: usesPiNo ? '' : (h.kcap08 || ''),
      piNo: usesPiNo ? (h.kcap08 || '') : '',
      reserveNo: h.kcap09 || '',
      postProcessAssist: false,
      workshopCode: '',
      workshopName: '',
      sourceSystemcodeId: '',
      inTax: String(h.in_tax || '1'),
      remark: h.remark || '',
      lines: (data?.data?.lines || []).map((line, idx) => {
        const enriched = { ...line, tax: Number(line.tax ?? line.Tax ?? 0) }
        if (isAssist) {
          const sourceLineCode = String(enriched.kcaq02 ?? enriched.sourceLineCode ?? '').trim()
          enriched.sourceLineCode = sourceLineCode
          enriched.lineKey = buildAssistIssueLineKey(sourceLineCode, enriched.kcaa01)
        }
        if (isProduction || (isSupplementProduction && String(sourceOrderNo).trim())) {
          const sourceLineCode = String(enriched.kcaq02 ?? enriched.sourceLineCode ?? '').trim()
          enriched.sourceLineCode = sourceLineCode
          enriched.scak02 = sourceLineCode
          enriched.lineKey = resolveProductionIssueBatchLineKey(enriched)
        }
        return wrapOutboundLine(enriched, idx)
      }),
    })
    pageMode.value = 'form'
    formTab.value = 'base'
    prevWorkshopCode.value = String(h.kcap05 || '').trim()
    ensureRelatedPartyOptionSeed()
    syncOtherOutboundRelatedPartyDisplay()
    if (isProduction || (isSupplementProduction && String(sourceOrderNo).trim())) await enrichProductionIssueLineQtyCaps()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '读取出库单失败')
  }
}

function resetForm() {
  if (editId.value) return ElMessage.info('编辑时请重新打开单据恢复原内容')
  Object.assign(form, defaultForm())
  form.lines = []
  otherOutboundRelatedPartyInput.value = ''
  prevWorkshopCode.value = ''
  applyDefaultWarehouseForType()
}

function isDefaultWarehouse(row) {
  const name = String(row?.name ?? '').trim()
  const code = String(row?.code ?? '').trim()
  return name === '货仓' || code === '货仓'
}

function isFinishedGoodsWarehouse(row) {
  const name = String(row?.name ?? '').trim()
  const code = String(row?.code ?? '').trim()
  return name === '成品仓' || code === '成品仓'
}

/** 新增/重置或切换出库类型时：成品出库默认成品仓，其它默认货仓 */
async function applyDefaultWarehouseForType() {
  if (form.warehouseCode) return
  const isFg = form.outboundType === '6'
  const matcher = isFg ? isFinishedGoodsWarehouse : isDefaultWarehouse
  const keyword = isFg ? '成品仓' : '货仓'
  if (!warehouseOptions.value.some(matcher)) {
    await fetchWarehouses(keyword)
  }
  const target = warehouseOptions.value.find(matcher)
  if (!target) return
  form.warehouseCode = target.code || ''
}

function pickOutboundType(type) {
  if (form.outboundType === type) return
  applyOutboundTypeSwitch(type)
}

function applyOutboundTypeSwitch(type) {
  const wasFinishedGoods = form.outboundType === '6'
  form.outboundType = type
  form.sourceOrderNo = ''
  form.sourceSystemcodeId = ''
  form.relatedPartyCode = ''
  form.relatedPartyName = ''
  form.piNo = ''
  form.paperNo = ''
  form.reserveNo = ''
  form.postProcessAssist = false
  form.workshopCode = ''
  form.workshopName = ''
  prevWorkshopCode.value = ''
  otherOutboundRelatedPartyInput.value = ''
  form.lines = []
  // 只有成品出库默认不含税；切回其它类型时恢复含税，避免沿用成品出库的不含税状态。
  form.inTax = type === '6' ? '2' : '1'
  // 切换涉及成品出库时重置仓库，再按类型带入默认仓
  if (type === '6' || wasFinishedGoods) form.warehouseCode = ''
  applyDefaultWarehouseForType()
}

async function openPurchaseSourcePicker() {
  purchaseSourceDialog.visible = true
  purchaseSourceDialog.supplier = form.relatedPartyCode || form.relatedPartyName || ''
  purchaseSourceDialog.keyword = ''
  purchaseSourceDialog.page = 1
  purchaseSourceDialog.pageSize = 10
  await loadPurchaseSourcePage()
}

function clearSourceOrder() {
  form.sourceOrderNo = ''
  if (form.outboundType === '1' || form.outboundType === '2') {
    form.relatedPartyCode = ''
    form.relatedPartyName = ''
    form.sourceSystemcodeId = ''
    form.piNo = ''
    form.lines = []
  }
  if (form.outboundType === '4' || isSupplementProductionIssuePicker.value) {
    form.sourceSystemcodeId = ''
    form.piNo = ''
    form.lines = []
  }
  if (form.outboundType === '6') {
    form.relatedPartyCode = ''
    form.relatedPartyName = ''
    form.sourceSystemcodeId = ''
    form.paperNo = ''
    form.lines = []
  }
}

function purchaseTaxMark(v) {
  const s = String(v ?? '').trim()
  if (s === '1') return '√'
  if (s === '2') return '×'
  return '-'
}

function isPurchaseTaxIncluded(v) {
  return String(v ?? '').trim() === '1'
}

async function loadPurchaseSourcePage() {
  purchaseSourceDialog.loading = true
  try {
    const { data } = await axios.get('/api/stock-out/purchase-return-source-page', {
      params: {
        supplier: purchaseSourceDialog.supplier || undefined,
        keyword: purchaseSourceDialog.keyword || undefined,
        page: purchaseSourceDialog.page,
        pageSize: purchaseSourceDialog.pageSize,
      },
    })
    purchaseSourceDialog.list = data?.data?.list || []
    purchaseSourceDialog.total = Number(data?.data?.total || 0)
  } catch (err) {
    purchaseSourceDialog.list = []
    purchaseSourceDialog.total = 0
    ElMessage.error(err?.response?.data?.msg || err.message || '读取采购单失败')
  } finally {
    purchaseSourceDialog.loading = false
  }
}

function searchPurchaseSourcePage() {
  purchaseSourceDialog.page = 1
  loadPurchaseSourcePage()
}

function clearPurchaseSourceFilter() {
  purchaseSourceDialog.supplier = ''
  purchaseSourceDialog.keyword = ''
  searchPurchaseSourcePage()
}

function choosePurchaseSource(row) {
  if (!row) return
  form.sourceOrderNo = String(row.sourceOrderNo ?? '').trim()
  form.relatedPartyCode = String(row.supplierCode ?? '').trim()
  form.relatedPartyName = String(row.supplierName ?? '').trim()
  form.sourceSystemcodeId = String(row.sourceSystemcode ?? '').trim()
  form.lines = []
  ensureRelatedPartyOptionSeed()
  purchaseSourceDialog.visible = false
  ElMessage.success('已关联采购单，旧明细已清空')
}

async function openAssistSourcePicker() {
  assistSourceDialog.visible = true
  assistSourceDialog.keyword = ''
  assistSourceDialog.page = 1
  assistSourceDialog.pageSize = 10
  await loadAssistSourcePage()
}

async function loadAssistSourcePage() {
  assistSourceDialog.loading = true
  try {
    const { data } = await axios.get('/api/stock-out/assist-issue-source-page', {
      params: {
        keyword: assistSourceDialog.keyword || undefined,
        page: assistSourceDialog.page,
        pageSize: assistSourceDialog.pageSize,
      },
    })
    assistSourceDialog.list = data?.data?.list || []
    assistSourceDialog.total = Number(data?.data?.total || 0)
  } catch (err) {
    assistSourceDialog.list = []
    assistSourceDialog.total = 0
    ElMessage.error(err?.response?.data?.msg || err.message || '读取外协单失败')
  } finally {
    assistSourceDialog.loading = false
  }
}

function searchAssistSourcePage() {
  assistSourceDialog.page = 1
  loadAssistSourcePage()
}

function clearAssistSourceFilter() {
  assistSourceDialog.keyword = ''
  searchAssistSourcePage()
}

function chooseAssistSource(row) {
  if (!row) return
  form.sourceOrderNo = String(row.sourceOrderNo ?? '').trim()
  form.piNo = String(row.referenceNo ?? '').trim()
  form.relatedPartyCode = String(row.supplierCode ?? '').trim()
  form.relatedPartyName = String(row.supplierName ?? '').trim()
  form.sourceSystemcodeId = String(row.sourceSystemcode ?? '').trim()
  form.lines = []
  ensureRelatedPartyOptionSeed()
  assistSourceDialog.visible = false
  ElMessage.success('已关联外协单，旧明细已清空')
}

function openProductionDispatchSourcePicker() {
  if (!form.relatedPartyCode) {
    return ElMessage.warning('请先选择生产车间!')
  }
  productionDispatchSourceDialog.visible = true
  productionDispatchSourceDialog.keyword = ''
  productionDispatchSourceDialog.page = 1
  productionDispatchSourceDialog.pageSize = 10
  loadProductionDispatchSourcePage()
}

function onProductionDispatchDisplayModeChange() {
  productionDispatchSourceDialog.page = 1
  loadProductionDispatchSourcePage()
}

async function loadProductionDispatchSourcePage() {
  if (!form.relatedPartyCode) return
  productionDispatchSourceDialog.loading = true
  try {
    const { data } = await axios.get('/api/stock-out/production-dispatch-source-page', {
      params: {
        workshopCode: form.relatedPartyCode,
        workshopName: form.relatedPartyName || undefined,
        displayMode: productionDispatchSourceDialog.displayMode,
        keyword: productionDispatchSourceDialog.keyword || undefined,
        page: productionDispatchSourceDialog.page,
        pageSize: productionDispatchSourceDialog.pageSize,
      },
    })
    productionDispatchSourceDialog.list = data?.data?.list || []
    productionDispatchSourceDialog.total = Number(data?.data?.total || 0)
    if (data?.data?.workshopName) form.relatedPartyName = data.data.workshopName
  } catch (err) {
    productionDispatchSourceDialog.list = []
    productionDispatchSourceDialog.total = 0
    ElMessage.error(err?.response?.data?.msg || err.message || '读取派工单列表失败')
    if (err?.response?.status === 400) {
      productionDispatchSourceDialog.visible = false
    }
  } finally {
    productionDispatchSourceDialog.loading = false
  }
}

function searchProductionDispatchSourcePage() {
  productionDispatchSourceDialog.page = 1
  loadProductionDispatchSourcePage()
}

function resetProductionDispatchSourceFilter() {
  productionDispatchSourceDialog.keyword = ''
  productionDispatchSourceDialog.page = 1
  loadProductionDispatchSourcePage()
}

function queryAllProductionDispatchSourcePage() {
  productionDispatchSourceDialog.keyword = ''
  productionDispatchSourceDialog.page = 1
  loadProductionDispatchSourcePage()
}

function chooseProductionDispatchSource(row) {
  if (!row) return
  const wsCode = String(row.workshopCode ?? '').trim()
  if (wsCode && form.relatedPartyCode && wsCode !== form.relatedPartyCode) {
    return ElMessage.error('派工单车间与当前所选生产车间不一致')
  }
  form.sourceOrderNo = String(row.dispatchNo ?? '').trim()
  form.piNo = String(row.piNo ?? '').trim()
  if (row.workshopCode) form.relatedPartyCode = String(row.workshopCode).trim()
  if (row.workshopName) form.relatedPartyName = String(row.workshopName).trim()
  form.sourceSystemcodeId = String(row.sourceSystemcode ?? '').trim()
  form.lines = []
  ensureRelatedPartyOptionSeed()
  prevWorkshopCode.value = form.relatedPartyCode
  productionDispatchSourceDialog.visible = false
  ElMessage.success('已关联派工单，旧明细已清空')
}

async function openFinishedGoodsSourcePicker() {
  finishedGoodsSourceDialog.visible = true
  finishedGoodsSourceDialog.keyword = ''
  finishedGoodsSourceDialog.page = 1
  finishedGoodsSourceDialog.pageSize = 10
  await loadFinishedGoodsSourcePage()
}

async function loadFinishedGoodsSourcePage() {
  finishedGoodsSourceDialog.loading = true
  try {
    const { data } = await axios.get('/api/stock-out/finished-goods-source-page', {
      params: {
        keyword: finishedGoodsSourceDialog.keyword || undefined,
        page: finishedGoodsSourceDialog.page,
        pageSize: finishedGoodsSourceDialog.pageSize,
      },
    })
    finishedGoodsSourceDialog.list = data?.data?.list || []
    finishedGoodsSourceDialog.total = Number(data?.data?.total || 0)
  } catch (err) {
    finishedGoodsSourceDialog.list = []
    finishedGoodsSourceDialog.total = 0
    ElMessage.error(err?.response?.data?.msg || err.message || '读取销售订单列表失败')
  } finally {
    finishedGoodsSourceDialog.loading = false
  }
}

function searchFinishedGoodsSourcePage() {
  finishedGoodsSourceDialog.page = 1
  loadFinishedGoodsSourcePage()
}

function resetFinishedGoodsSourceFilter() {
  finishedGoodsSourceDialog.keyword = ''
  finishedGoodsSourceDialog.page = 1
  loadFinishedGoodsSourcePage()
}

function queryAllFinishedGoodsSourcePage() {
  finishedGoodsSourceDialog.keyword = ''
  finishedGoodsSourceDialog.page = 1
  loadFinishedGoodsSourcePage()
}

function chooseFinishedGoodsSource(row) {
  if (!row) return
  form.sourceOrderNo = String(row.sourceOrderNo ?? '').trim()
  form.paperNo = String(row.poNo ?? '').trim()
  form.relatedPartyCode = String(row.customerCode ?? '').trim()
  form.relatedPartyName = String(row.customerName ?? '').trim()
  form.sourceSystemcodeId = String(row.sourceSystemcode ?? '').trim()
  form.lines = []
  ensureRelatedPartyOptionSeed()
  finishedGoodsSourceDialog.visible = false
  ElMessage.success('已关联销售订单，旧明细已清空')
}

function onAssistRelatedPartyChange(code) {
  const hit = relatedPartyOptions.value.find((item) => item.code === code)
  form.relatedPartyName = hit?.name || ''
}

async function fetchWarehouses(keyword = '') {
  const { data } = await axios.get('/api/stock-out/warehouse-options', { params: { keyword } })
  warehouseOptions.value = data?.data?.list || []
}

async function fetchFilterRelatedParties(keyword = '') {
  const kw = String(keyword ?? '').trim()
  filterRelatedPartyLoading.value = true
  try {
    const useTyped = ['1', '2', '3', '4', '5', '6', '7', '8'].includes(String(filters.outboundType ?? ''))
    const url = useTyped ? '/api/stock-out/related-party-options' : '/api/stock-out/list-related-party-options'
    const params = { keyword: kw }
    if (useTyped) params.outboundType = filters.outboundType
    const { data } = await axios.get(url, { params })
    filterRelatedParties.value = data?.data?.list || []
  } catch {
    filterRelatedParties.value = []
  } finally {
    filterRelatedPartyLoading.value = false
  }
}

function handleFilterRelatedPartyFocus() {
  if (!filterRelatedParties.value.length) fetchFilterRelatedParties('')
}

async function fetchRelatedParties(keyword = '') {
  if (form.outboundType === '9') return
  const { data } = await axios.get('/api/stock-out/related-party-options', { params: { outboundType: form.outboundType, keyword } })
  relatedPartyOptions.value = data?.data?.list || []
  ensureRelatedPartyOptionSeed()
}

function validateBeforeSave() {
  if (!form.outboundType) return '请先选择出库类型。'
  if (!form.inTax) return '请先选择是否含税。'
  if (!form.warehouseCode) return '请先选择仓库。'
  if (['4', '5', '7', '8'].includes(form.outboundType) && !form.relatedPartyCode) return '生产车间不能为空'
  if (isLinkedType.value && !form.sourceOrderNo) return '关联型出库必须填写关联单号'
  // 草稿允许空明细保存；审核时后端拦截无明细单据
  const bad = form.lines.findIndex((line) => !line.kcaa01 || Number(line.kcaq03 || 0) <= 0)
  if (bad >= 0) return `第 ${bad + 1} 行请填写材料编码和出库数量`
  return ''
}

async function saveOrder() {
  const msg = validateBeforeSave()
  if (msg) return ElMessage.warning(msg)
  saving.value = true
  try {
    const lines = form.lines.map((line) => ({ ...line, kcaq03: roundOutboundQty(line.kcaq03) }))
    const body = {
      header: { ...form, postProcessAssist: false, workshopCode: '', workshopName: '' },
      lines,
    }
    const { data } = editId.value
      ? await axios.put(`/api/stock-out/${editId.value}`, body)
      : await axios.post('/api/stock-out', body)
    ElMessage.success(data?.msg || '保存成功')
    pageMode.value = 'list'
    await loadList()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '保存出库单失败')
  } finally {
    saving.value = false
  }
}

async function viewOrder(row) {
  try {
    const data = await fetchDetail(row.id)
    detail.header = data.header || null
    detail.lines = data.lines || []
    detailVisible.value = true
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '读取出库单失败')
  }
}

function printOrder(row) {
  window.open(`/api/stock-out/print-data?id=${encodeURIComponent(row.id)}`, '_blank')
}

function removeListRow(row) {
  const id = row?.id
  const before = list.value.length
  list.value = list.value.filter((item) => item.id !== id)
  if (list.value.length !== before) {
    pager.total = Math.max(0, Number(pager.total || 0) - 1)
    expandedRowKeys.value = expandedRowKeys.value.filter((key) => key !== id)
  }
}

function applyAuditActionToCurrentList(row, action) {
  if (action === 'audit') {
    row.pass = '1'
    if (showUnaudited.value) removeListRow(row)
    return true
  }
  if (action === 'unaudit') {
    row.pass = '0'
    if (!showUnaudited.value) removeListRow(row)
    return true
  }
  return false
}

async function runAction(row, action) {
  const map = {
    audit: { method: 'post', url: `/api/stock-out/${row.id}/audit`, text: '审核' },
    unaudit: { method: 'post', url: `/api/stock-out/${row.id}/unaudit`, text: '反审核' },
    restore: { method: 'post', url: `/api/stock-out/${row.id}/restore`, text: '恢复' },
    delete: { method: 'delete', url: `/api/stock-out/${row.id}`, text: '删除' },
    hard: { method: 'delete', url: `/api/stock-out/${row.id}/hard`, text: '彻底删除' },
  }
  const cfg = map[action]
  if (!cfg) return
  let body = undefined
  if (action === 'unaudit') {
    const { value } = await ElMessageBox.prompt(`请输入出库单【${row.outboundNo || row.kcap01 || row.id}】反审原因`, '反审原因', {
      inputType: 'textarea',
      inputValidator: (v) => !!String(v || '').trim(),
      inputErrorMessage: '反审原因必填',
    })
    body = { reason: String(value || '').trim() }
  } else {
    await ElMessageBox.confirm(`确认${cfg.text}这张出库单？`, '确认操作', { type: action === 'hard' || action === 'delete' ? 'warning' : 'info' })
  }
  row.__op = action
  try {
    const { data } = await axios({ method: cfg.method, url: cfg.url, data: body })
    ElMessage.success(data?.msg || `${cfg.text}成功`)
    if (!applyAuditActionToCurrentList(row, action)) await loadList()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || `${cfg.text}失败`)
  } finally {
    row.__op = ''
  }
}

function wrapOutboundLine(line, idx = 0) {
  const reference = String(line.reference ?? line.Reference ?? '').trim()
  return {
    ...line,
    reference,
    _lineMarked: false,
    __key: line.__key || `${idx}-${line.systemcode || line.id || Date.now()}-${Math.random()}`,
  }
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
  form.lines = form.lines.filter((x) => !s.has(x.__key))
  ElMessage.success('已删除选定明细')
}

async function removeAllLines() {
  await ElMessageBox.confirm('确定删除全部明细吗？', '提示', { type: 'warning' })
  form.lines = []
}

/** 成品出库：一张单报关单号通常相同，一键填满所有明细行 Reference */
async function fillCustomsReferenceNo() {
  if (!form.lines.length) return ElMessage.warning('请先添加明细')
  try {
    const { value } = await ElMessageBox.prompt('填写后所有明细行的报关单号将统一为该值', '填报关单号', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPlaceholder: '报关单号',
    })
    const refNo = String(value ?? '').trim()
    form.lines.forEach((line) => {
      line.reference = refNo
    })
    ElMessage.success('已统一填报关单号')
  } catch {
    // 用户取消
  }
}

function buildOtherBatchCurrentLineKeys() {
  return form.lines.map((line) => String(line.kcaa01 ?? '').trim().toLowerCase()).filter(Boolean)
}

function buildAssistIssueBatchCurrentLineKeys() {
  const keys = []
  for (const line of form.lines) {
    const lineKey = resolveAssistIssueBatchLineKey(line)
    if (lineKey) keys.push(lineKey)
    const matKey = buildAssistIssueMaterialDedupKey(line.kcaa01)
    if (matKey) keys.push(matKey)
  }
  return [...new Set(keys)]
}

function openAssistIssueBatchWindow() {
  const sessionId = buildStockOutAssistIssueBatchSessionId()
  activeAssistIssueBatchSessionId.value = sessionId
  writeStockOutAssistIssueBatchContext(sessionId, {
    sourceOrderNo: form.sourceOrderNo,
    supplierCode: form.relatedPartyCode,
    supplierName: form.relatedPartyName,
    piNo: form.piNo,
    warehouseCode: form.warehouseCode,
    warehouseName: resolveWarehouseName(),
    excludeOutboundNo: editId.value ? form.outboundNo : '',
    inTax: form.inTax,
    currentLineKeys: buildAssistIssueBatchCurrentLineKeys(),
    pageSize: 20,
  })
  const url = `/inventory/daily/stock-out-assist-issue-batch-window?sessionId=${encodeURIComponent(sessionId)}&warehouseCode=${encodeURIComponent(form.warehouseCode)}`
  const opened = window.open(url, '_blank')
  assistIssueBatchChildWindow.value = opened || null
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

function clearAssistIssueBatchSession() {
  activeAssistIssueBatchSessionId.value = ''
  assistIssueBatchChildWindow.value = null
}

function replyAssistIssueBatch(source, payload) {
  const target = source && typeof source.postMessage === 'function'
    ? source
    : (assistIssueBatchChildWindow.value && !assistIssueBatchChildWindow.value.closed
      ? assistIssueBatchChildWindow.value
      : null)
  if (!target || typeof target.postMessage !== 'function') return
  target.postMessage(payload, window.location.origin)
}

function applyAssistIssueBatchLines(batchRows) {
  const existing = new Set(buildAssistIssueBatchCurrentLineKeys())
  const newLines = (batchRows ?? []).filter((row) => {
    const key = String(row.lineKey ?? '').trim().toLowerCase()
      || resolveAssistIssueBatchLineKey(row)
    const matKey = buildAssistIssueMaterialDedupKey(row.kcaa01 ?? row.materialCode)
    if (matKey && existing.has(matKey)) return false
    return key && !existing.has(key)
  }).map((row) => makeBatchLine({
    ...row,
    lineKey: row.lineKey || resolveAssistIssueBatchLineKey(row),
  }))
  if (!newLines.length) return ElMessage.warning('所选明细已在列表中，或未选择新行')
  form.lines.push(...newLines)
  ElMessage.success(`已批量添加 ${newLines.length} 条出库明细`)
}

function handleAssistIssueBatchPayload(payload, source = null, options = {}) {
  const sessionId = String(payload?.sessionId ?? '').trim()
  const allowStoredSession = !!options.allowStoredSession
  if (!sessionId) return false
  if (sessionId !== activeAssistIssueBatchSessionId.value && !allowStoredSession) return false
  const validation = validateStockOutAssistIssueBatchApply({
    openedWarehouseCode: payload.openedWarehouseCode,
    currentWarehouseCode: form.warehouseCode,
    openedSourceOrderNo: payload.openedSourceOrderNo,
    currentSourceOrderNo: form.sourceOrderNo,
    openedSupplierCode: payload.openedSupplierCode,
    currentSupplierCode: form.relatedPartyCode,
    openedPiNo: payload.openedPiNo,
    currentPiNo: form.piNo,
  })
  if (!validation.ok) {
    removeStockOutAssistIssueBatchResult(sessionId)
    if (!allowStoredSession) {
      ElMessage.warning('外协单/外协商/仓库/PI 数据已变更，请重新打开批量添加')
      replyAssistIssueBatch(source, { type: STOCK_OUT_AI_BATCH_MSG_REJECTED, sessionId, reason: validation.reason })
      clearAssistIssueBatchSession()
    }
    return false
  }
  const batchRows = Array.isArray(payload.lines) ? payload.lines : []
  if (!batchRows.length) {
    removeStockOutAssistIssueBatchResult(sessionId)
    replyAssistIssueBatch(source, { type: STOCK_OUT_AI_BATCH_MSG_REJECTED, sessionId, reason: 'empty-lines' })
    return false
  }
  removeStockOutAssistIssueBatchResult(sessionId)
  applyAssistIssueBatchLines(batchRows)
  replyAssistIssueBatch(source, { type: STOCK_OUT_AI_BATCH_MSG_ACCEPTED, sessionId, lineCount: batchRows.length })
  clearAssistIssueBatchSession()
  return true
}

function handleAssistIssueBatchMessage(event) {
  if (event.origin !== window.location.origin) return
  const data = event.data
  if (!data || data.type !== STOCK_OUT_AI_BATCH_MSG_APPLY) return
  handleAssistIssueBatchPayload(data, event.source)
}

function buildProductionIssueBatchCurrentLineKeys() {
  const keys = []
  for (const line of form.lines) {
    const lineKey = resolveProductionIssueBatchLineKey(line)
    if (lineKey) keys.push(lineKey)
    const matKey = buildAssistIssueMaterialDedupKey(line.kcaa01)
    if (matKey) keys.push(matKey)
  }
  return [...new Set(keys)]
}

function openProductionIssueBatchWindow() {
  const sessionId = buildStockOutProductionIssueBatchSessionId()
  activeProductionIssueBatchSessionId.value = sessionId
  writeStockOutProductionIssueBatchContext(sessionId, {
    outboundType: form.outboundType,
    sourceOrderNo: form.sourceOrderNo,
    workshopCode: form.relatedPartyCode,
    workshopName: form.relatedPartyName,
    piNo: form.piNo,
    warehouseCode: form.warehouseCode,
    warehouseName: resolveWarehouseName(),
    dispatchSystemcode: form.sourceSystemcodeId,
    excludeOutboundNo: editId.value ? form.outboundNo : '',
    inTax: form.inTax,
    currentLineKeys: buildProductionIssueBatchCurrentLineKeys(),
    pageSize: 20,
  })
  const url = `/inventory/daily/stock-out-production-issue-batch-window?sessionId=${encodeURIComponent(sessionId)}&warehouseCode=${encodeURIComponent(form.warehouseCode)}`
  const opened = window.open(url, '_blank')
  productionIssueBatchChildWindow.value = opened || null
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

function clearProductionIssueBatchSession() {
  activeProductionIssueBatchSessionId.value = ''
  productionIssueBatchChildWindow.value = null
}

function replyProductionIssueBatch(source, payload) {
  const target = source && typeof source.postMessage === 'function'
    ? source
    : (productionIssueBatchChildWindow.value && !productionIssueBatchChildWindow.value.closed
      ? productionIssueBatchChildWindow.value
      : null)
  if (!target || typeof target.postMessage !== 'function') return
  target.postMessage(payload, window.location.origin)
}

function applyProductionIssueBatchLines(batchRows) {
  const existing = new Set(buildProductionIssueBatchCurrentLineKeys())
  const newLines = (batchRows ?? []).filter((row) => {
    const key = String(row.lineKey ?? '').trim().toLowerCase()
      || resolveProductionIssueBatchLineKey(row)
    const matKey = buildAssistIssueMaterialDedupKey(row.kcaa01 ?? row.materialCode)
    if (matKey && existing.has(matKey)) return false
    return key && !existing.has(key)
  }).map((row) => makeBatchLine({
    ...row,
    lineKey: row.lineKey || resolveProductionIssueBatchLineKey(row),
  }))
  if (!newLines.length) return ElMessage.warning('所选明细已在列表中，或未选择新行')
  form.lines.push(...newLines)
  ElMessage.success(`已批量添加 ${newLines.length} 条出库明细`)
}

function handleProductionIssueBatchPayload(payload, source = null, options = {}) {
  const sessionId = String(payload?.sessionId ?? '').trim()
  const allowStoredSession = !!options.allowStoredSession
  if (!sessionId) return false
  if (sessionId !== activeProductionIssueBatchSessionId.value && !allowStoredSession) return false
  const validation = validateStockOutProductionIssueBatchApply({
    openedWarehouseCode: payload.openedWarehouseCode,
    currentWarehouseCode: form.warehouseCode,
    openedSourceOrderNo: payload.openedSourceOrderNo,
    currentSourceOrderNo: form.sourceOrderNo,
    openedWorkshopCode: payload.openedWorkshopCode,
    currentWorkshopCode: form.relatedPartyCode,
    openedPiNo: payload.openedPiNo,
    currentPiNo: form.piNo,
  })
  if (!validation.ok) {
    removeStockOutProductionIssueBatchResult(sessionId)
    if (!allowStoredSession) {
      ElMessage.warning('派工单/车间/仓库/PI 数据已变更，请重新打开批量添加')
      replyProductionIssueBatch(source, { type: STOCK_OUT_PI_BATCH_MSG_REJECTED, sessionId, reason: validation.reason })
      clearProductionIssueBatchSession()
    }
    return false
  }
  const batchRows = Array.isArray(payload.lines) ? payload.lines : []
  if (!batchRows.length) {
    removeStockOutProductionIssueBatchResult(sessionId)
    replyProductionIssueBatch(source, { type: STOCK_OUT_PI_BATCH_MSG_REJECTED, sessionId, reason: 'empty-lines' })
    return false
  }
  removeStockOutProductionIssueBatchResult(sessionId)
  applyProductionIssueBatchLines(batchRows)
  replyProductionIssueBatch(source, { type: STOCK_OUT_PI_BATCH_MSG_ACCEPTED, sessionId, lineCount: batchRows.length })
  clearProductionIssueBatchSession()
  return true
}

function handleProductionIssueBatchMessage(event) {
  if (event.origin !== window.location.origin) return
  const data = event.data
  if (!data || data.type !== STOCK_OUT_PI_BATCH_MSG_APPLY) return
  handleProductionIssueBatchPayload(data, event.source)
}

function buildPurchaseReturnBatchCurrentLineKeys() {
  return form.lines
    .map((line) => String(line.sourceLineCode ?? line.kcaq02 ?? '').trim().toLowerCase())
    .filter(Boolean)
}

function buildFinishedGoodsBatchCurrentLineKeys() {
  return form.lines
    .map((line) => String(line.sourceLineCode ?? line.kcaq02 ?? line.xsak02 ?? '').trim().toLowerCase())
    .filter(Boolean)
}

function resolveWarehouseName() {
  const code = String(form.warehouseCode ?? '').trim()
  const hit = warehouseOptions.value.find((item) => String(item.code ?? '').trim() === code)
  return String(hit?.name ?? '').trim()
}

function openOtherBatchWindow() {
  const sessionId = buildStockOutBatchSessionId()
  activeOtherBatchSessionId.value = sessionId
  writeStockOutBatchContext(sessionId, {
    outboundType: form.outboundType,
    warehouseCode: form.warehouseCode,
    warehouseName: resolveWarehouseName(),
    excludeOutboundNo: editId.value ? form.outboundNo : '',
    inTax: form.inTax,
    currentLineKeys: buildOtherBatchCurrentLineKeys(),
    pageSize: 5,
  })
  const url = `/inventory/daily/stock-out-other-batch-window?sessionId=${encodeURIComponent(sessionId)}&warehouseCode=${encodeURIComponent(form.warehouseCode)}`
  const opened = window.open(url, '_blank')
  otherBatchChildWindow.value = opened || null
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

function clearOtherBatchSession() {
  activeOtherBatchSessionId.value = ''
  otherBatchChildWindow.value = null
}

function openPurchaseReturnBatchWindow() {
  const sessionId = buildStockOutPurchaseReturnBatchSessionId()
  activePurchaseReturnBatchSessionId.value = sessionId
  writeStockOutPurchaseReturnBatchContext(sessionId, {
    sourceOrderNo: form.sourceOrderNo,
    supplierCode: form.relatedPartyCode,
    supplierName: form.relatedPartyName,
    warehouseCode: form.warehouseCode,
    warehouseName: resolveWarehouseName(),
    excludeOutboundNo: editId.value ? form.outboundNo : '',
    inTax: form.inTax,
    currentLineKeys: buildPurchaseReturnBatchCurrentLineKeys(),
    pageSize: 20,
  })
  const url = `/inventory/daily/stock-out-purchase-return-batch-window?sessionId=${encodeURIComponent(sessionId)}&warehouseCode=${encodeURIComponent(form.warehouseCode)}`
  const opened = window.open(url, '_blank')
  purchaseReturnBatchChildWindow.value = opened || null
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

function clearPurchaseReturnBatchSession() {
  activePurchaseReturnBatchSessionId.value = ''
  purchaseReturnBatchChildWindow.value = null
}

function openFinishedGoodsBatchWindow() {
  const sessionId = buildStockOutFinishedGoodsBatchSessionId()
  activeFinishedGoodsBatchSessionId.value = sessionId
  writeStockOutFinishedGoodsBatchContext(sessionId, {
    sourceOrderNo: form.sourceOrderNo,
    customerCode: form.relatedPartyCode,
    customerName: form.relatedPartyName,
    sourceSystemcodeId: form.sourceSystemcodeId,
    warehouseCode: form.warehouseCode,
    warehouseName: resolveWarehouseName(),
    excludeOutboundNo: editId.value ? form.outboundNo : '',
    inTax: form.inTax,
    currentLineKeys: buildFinishedGoodsBatchCurrentLineKeys(),
    pageSize: 20,
  })
  const url = `/inventory/daily/stock-out-finished-goods-batch-window?sessionId=${encodeURIComponent(sessionId)}&warehouseCode=${encodeURIComponent(form.warehouseCode)}`
  const opened = window.open(url, '_blank')
  finishedGoodsBatchChildWindow.value = opened || null
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

function clearFinishedGoodsBatchSession() {
  activeFinishedGoodsBatchSessionId.value = ''
  finishedGoodsBatchChildWindow.value = null
}

function replyFinishedGoodsBatch(source, payload) {
  const target = source && typeof source.postMessage === 'function'
    ? source
    : (finishedGoodsBatchChildWindow.value && !finishedGoodsBatchChildWindow.value.closed
      ? finishedGoodsBatchChildWindow.value
      : null)
  if (!target || typeof target.postMessage !== 'function') return
  target.postMessage(payload, window.location.origin)
}

function replyPurchaseReturnBatch(source, payload) {
  const target = source && typeof source.postMessage === 'function'
    ? source
    : (purchaseReturnBatchChildWindow.value && !purchaseReturnBatchChildWindow.value.closed
      ? purchaseReturnBatchChildWindow.value
      : null)
  if (!target || typeof target.postMessage !== 'function') return
  target.postMessage(payload, window.location.origin)
}

function replyOtherBatch(source, payload) {
  const target = source && typeof source.postMessage === 'function'
    ? source
    : (otherBatchChildWindow.value && !otherBatchChildWindow.value.closed ? otherBatchChildWindow.value : null)
  if (!target || typeof target.postMessage !== 'function') return
  target.postMessage(payload, window.location.origin)
}

function isEmptyOutboundPrice(value) {
  return value === null || value === undefined || value === ''
}

function makeBatchLine(row) {
  const isFinishedGoods = form.outboundType === '6'
  const tax = isFinishedGoods ? 0 : (form.inTax === '2' ? 0 : Number(row.tax ?? 0))
  const qty = isFinishedGoods
    ? roundOutboundQty(row.shippableQty ?? row.tempx ?? row.kcaq03 ?? 0)
    : roundOutboundQty(row.kcaq03 ?? row.returnableQty ?? row.issueableQty ?? row.actualQty ?? 0)
  const ex = isFinishedGoods
    ? (isEmptyOutboundPrice(row.kcaq04) ? null : Number(row.kcaq04))
    : Number(row.kcaq04 ?? 0)
  const inc = isFinishedGoods
    ? null
    : Number(row.kcaq041 ?? (ex * (1 + tax)))
  const sourceLineCode = String(row.sourceLineCode ?? row.lineKey ?? row.xsak02 ?? row.kcak02 ?? row.wxak02 ?? '').trim()
  const isProductionLike = form.outboundType === '4'
    || (isSupplementProductionIssuePicker.value && isSupplementProductionIssueWithDispatch.value)
  const assistLineKey = form.outboundType === '2'
    ? (row.lineKey || buildAssistIssueLineKey(sourceLineCode, row.kcaa01 || row.materialCode))
    : isProductionLike
      ? (row.lineKey || resolveProductionIssueBatchLineKey(row))
      : row.lineKey
  const stockCap = roundOutboundQty(row.kcaq031 ?? row.warehouseActualQty ?? row.availableQty ?? qty)
  const stillNeedCap = roundOutboundQty(row.stillNeedQty ?? row.sourceAvailableQty ?? qty)
  const sourceDemandQty = roundOutboundQty(row.sourceDemandQty ?? row.dispatchDemandQty ?? 0)
  const piRemainingQty = roundOutboundQty(row.piRemainingQty ?? 0)
  const line = wrapOutboundLine({
    ...row,
    lineKey: assistLineKey,
    kcaa01: row.kcaa01 || row.materialCode,
    // 成品出库 kcaq02 写销售明细键；其它关联类型保留 sourceLineCode 供去重
    kcaq02: isLinkedType.value ? sourceLineCode : '',
    kcaq03: qty,
    kcaq031: isFinishedGoods ? qty : stockCap,
    availableQty: isProductionLike ? stockCap : roundOutboundQty(row.availableQty ?? row.returnableQty ?? row.issueableQty ?? qty),
    sourceAvailableQty: isProductionLike ? stillNeedCap : roundOutboundQty(row.sourceAvailableQty ?? row.availableQty ?? qty),
    sourceDemandQty: sourceDemandQty > 0 ? sourceDemandQty : row.sourceDemandQty,
    stillNeedQty: stillNeedCap > 0 ? stillNeedCap : row.stillNeedQty,
    piRemainingQty: row.piRemainingQty != null ? piRemainingQty : row.piRemainingQty,
    piDemandQty: row.piDemandQty,
    piIssuedQty: row.piIssuedQty,
    dispatchStillNeedQty: row.dispatchStillNeedQty,
    kcaq04: ex,
    kcaq041: inc,
    kcaq05: isFinishedGoods ? null : Number(row.kcaq05 ?? (qty * ex).toFixed(2)),
    kcaq051: isFinishedGoods ? null : Number(row.kcaq051 ?? (qty * inc).toFixed(2)),
    tax,
    reference: isFinishedGoods ? '' : String(row.reference ?? row.Reference ?? '').trim(),
    sourceLineCode,
    Describe: isFinishedGoods
      ? (String(row.Describe ?? '').trim() || deriveFinishedGoodsCustomsModel(row.kcaa01 || row.materialCode))
      : (row.Describe || row.info || row.remark || ''),
  })
  recalcLine(line)
  return line
}

async function refreshLinesTableHScroll() {
  await nextTick()
  linesTableRef.value?.doLayout?.()
  const el = linesTableRef.value?.$el
  if (el) refreshErpTableViewportHScroll(el)
}

watch([formTab, () => form.lines.length], ([tab]) => {
  if (tab !== 'lines') return
  refreshLinesTableHScroll()
})

function applyOtherBatchLines(batchRows) {
  const existing = new Set(buildOtherBatchCurrentLineKeys())
  const newLines = (batchRows ?? []).filter((row) => {
    const key = String(row.kcaa01 ?? row.materialCode ?? '').trim().toLowerCase()
    return key && !existing.has(key)
  }).map((row) => makeBatchLine(row))
  if (!newLines.length) return ElMessage.warning('所选明细已在列表中，或未选择新行')
  form.lines.push(...newLines)
  ElMessage.success(`已批量添加 ${newLines.length} 条出库明细`)
}

function handleOtherBatchPayload(payload, source = null, options = {}) {
  const sessionId = String(payload?.sessionId ?? '').trim()
  const allowStoredSession = !!options.allowStoredSession
  if (!sessionId) return false
  if (sessionId !== activeOtherBatchSessionId.value && !allowStoredSession) return false
  const validation = validateStockOutBatchApply({
    openedWarehouseCode: payload.openedWarehouseCode,
    currentWarehouseCode: form.warehouseCode,
  })
  if (!validation.ok) {
    removeStockOutBatchResult(sessionId)
    if (!allowStoredSession) {
      ElMessage.warning('仓库数据错误，请检查所选仓库')
      replyOtherBatch(source, { type: STOCK_OUT_BATCH_MSG_REJECTED, sessionId, reason: validation.reason })
      clearOtherBatchSession()
    }
    return false
  }
  const batchRows = Array.isArray(payload.lines) ? payload.lines : []
  if (!batchRows.length) {
    removeStockOutBatchResult(sessionId)
    replyOtherBatch(source, { type: STOCK_OUT_BATCH_MSG_REJECTED, sessionId, reason: 'empty-lines' })
    return false
  }
  removeStockOutBatchResult(sessionId)
  applyOtherBatchLines(batchRows)
  replyOtherBatch(source, { type: STOCK_OUT_BATCH_MSG_ACCEPTED, sessionId, lineCount: batchRows.length })
  clearOtherBatchSession()
  return true
}

function handleOtherBatchMessage(event) {
  if (event.origin !== window.location.origin) return
  const data = event.data
  if (!data || data.type !== STOCK_OUT_BATCH_MSG_APPLY) return
  handleOtherBatchPayload(data, event.source)
}

function applyPurchaseReturnBatchLines(batchRows) {
  const existing = new Set(buildPurchaseReturnBatchCurrentLineKeys())
  const newLines = (batchRows ?? [])
    .filter((row) => {
      const key = String(row.sourceLineCode ?? row.lineKey ?? row.kcaq02 ?? '').trim().toLowerCase()
      return key && !existing.has(key)
    })
    .map((row) => makeBatchLine(row))
  if (!newLines.length) return ElMessage.warning('所选明细已在列表中，或未选择新行')
  form.lines.push(...newLines)
  ElMessage.success(`已批量添加 ${newLines.length} 条采购退货明细`)
}

function handlePurchaseReturnBatchPayload(payload, source = null, options = {}) {
  const sessionId = String(payload?.sessionId ?? '').trim()
  const allowStoredSession = !!options.allowStoredSession
  if (!sessionId) return false
  if (sessionId !== activePurchaseReturnBatchSessionId.value && !allowStoredSession) return false
  const validation = validateStockOutPurchaseReturnBatchApply({
    openedWarehouseCode: payload.openedWarehouseCode,
    currentWarehouseCode: form.warehouseCode,
    openedSourceOrderNo: payload.openedSourceOrderNo,
    currentSourceOrderNo: form.sourceOrderNo,
    openedSupplierCode: payload.openedSupplierCode,
    currentSupplierCode: form.relatedPartyCode,
  })
  if (!validation.ok) {
    removeStockOutPurchaseReturnBatchResult(sessionId)
    if (!allowStoredSession) {
      ElMessage.warning('仓库/采购单/供应商数据已变更，请重新打开批量添加')
      replyPurchaseReturnBatch(source, { type: STOCK_OUT_PR_BATCH_MSG_REJECTED, sessionId, reason: validation.reason })
      clearPurchaseReturnBatchSession()
    }
    return false
  }
  const batchRows = Array.isArray(payload.lines) ? payload.lines : []
  if (!batchRows.length) {
    removeStockOutPurchaseReturnBatchResult(sessionId)
    replyPurchaseReturnBatch(source, { type: STOCK_OUT_PR_BATCH_MSG_REJECTED, sessionId, reason: 'empty-lines' })
    return false
  }
  removeStockOutPurchaseReturnBatchResult(sessionId)
  applyPurchaseReturnBatchLines(batchRows)
  replyPurchaseReturnBatch(source, { type: STOCK_OUT_PR_BATCH_MSG_ACCEPTED, sessionId, lineCount: batchRows.length })
  clearPurchaseReturnBatchSession()
  return true
}

function handlePurchaseReturnBatchMessage(event) {
  if (event.origin !== window.location.origin) return
  const data = event.data
  if (!data || data.type !== STOCK_OUT_PR_BATCH_MSG_APPLY) return
  handlePurchaseReturnBatchPayload(data, event.source)
}

function applyFinishedGoodsBatchLines(batchRows) {
  const existing = new Set(buildFinishedGoodsBatchCurrentLineKeys())
  const newLines = (batchRows ?? [])
    .filter((row) => {
      const key = String(row.sourceLineCode ?? row.lineKey ?? row.kcaq02 ?? '').trim().toLowerCase()
      return key && !existing.has(key)
    })
    .map((row) => makeBatchLine(row))
  if (!newLines.length) return ElMessage.warning('所选明细已在列表中，或未选择新行')
  form.lines.push(...newLines)
  ElMessage.success(`已批量添加 ${newLines.length} 条出库明细`)
}

function handleFinishedGoodsBatchPayload(payload, source = null, options = {}) {
  const sessionId = String(payload?.sessionId ?? '').trim()
  const allowStoredSession = !!options.allowStoredSession
  if (!sessionId) return false
  if (sessionId !== activeFinishedGoodsBatchSessionId.value && !allowStoredSession) return false
  const validation = validateStockOutFinishedGoodsBatchApply({
    openedWarehouseCode: payload.openedWarehouseCode,
    currentWarehouseCode: form.warehouseCode,
    openedSourceOrderNo: payload.openedSourceOrderNo,
    currentSourceOrderNo: form.sourceOrderNo,
    openedCustomerCode: payload.openedCustomerCode,
    currentCustomerCode: form.relatedPartyCode,
    openedSourceSystemcodeId: payload.openedSourceSystemcodeId,
    currentSourceSystemcodeId: form.sourceSystemcodeId,
  })
  if (!validation.ok) {
    removeStockOutFinishedGoodsBatchResult(sessionId)
    if (!allowStoredSession) {
      ElMessage.warning('仓库/订单/客户数据已变更，请重新打开批量添加')
      replyFinishedGoodsBatch(source, { type: STOCK_OUT_FG_BATCH_MSG_REJECTED, sessionId, reason: validation.reason })
      clearFinishedGoodsBatchSession()
    }
    return false
  }
  const batchRows = Array.isArray(payload.lines) ? payload.lines : []
  if (!batchRows.length) {
    removeStockOutFinishedGoodsBatchResult(sessionId)
    replyFinishedGoodsBatch(source, { type: STOCK_OUT_FG_BATCH_MSG_REJECTED, sessionId, reason: 'empty-lines' })
    return false
  }
  removeStockOutFinishedGoodsBatchResult(sessionId)
  applyFinishedGoodsBatchLines(batchRows)
  replyFinishedGoodsBatch(source, { type: STOCK_OUT_FG_BATCH_MSG_ACCEPTED, sessionId, lineCount: batchRows.length })
  clearFinishedGoodsBatchSession()
  return true
}

function handleFinishedGoodsBatchMessage(event) {
  if (event.origin !== window.location.origin) return
  const data = event.data
  if (!data || data.type !== STOCK_OUT_FG_BATCH_MSG_APPLY) return
  handleFinishedGoodsBatchPayload(data, event.source)
}

async function openMaterialPicker() {
  if (!form.outboundType) return ElMessage.warning('请先选择出库类型。')
  if (!form.inTax) return ElMessage.warning('请先选择是否含税。')
  if (!form.warehouseCode) return ElMessage.warning('请先选择仓库。')
  if (['0', '9', '10'].includes(form.outboundType)) {
    openOtherBatchWindow()
    return
  }
  if (form.outboundType === '1') {
    if (!form.sourceOrderNo) return ElMessage.warning('请先选择关联采购单号')
    if (!form.relatedPartyCode) return ElMessage.warning('请先选择供应商')
    openPurchaseReturnBatchWindow()
    return
  }
  if (form.outboundType === '2') {
    if (!form.sourceOrderNo) return ElMessage.warning('请先选择关联外协单号')
    if (!form.relatedPartyCode) return ElMessage.warning('请先选择外协商')
    openAssistIssueBatchWindow()
    return
  }
  if (form.outboundType === '4') {
    if (!form.relatedPartyCode) return ElMessage.warning('请先选择生产车间!')
    if (!form.sourceOrderNo) return ElMessage.warning('请先选择关联派工单号')
    if (!form.piNo) return ElMessage.warning('请先带出 PI 号')
    openProductionIssueBatchWindow()
    return
  }
  if (isSupplementProductionIssuePicker.value) {
    if (!form.relatedPartyCode) return ElMessage.warning('请先选择生产车间!')
    if (form.sourceOrderNo) {
      if (!form.piNo) return ElMessage.warning('请先带出 PI 号')
      openProductionIssueBatchWindow()
    } else {
      openOtherBatchWindow()
    }
    return
  }
  if (form.outboundType === '6') {
    if (!form.sourceOrderNo) return ElMessage.warning('请先选择订单单号.')
    if (!form.relatedPartyCode) return ElMessage.warning('请先选择客户')
    if (!form.sourceSystemcodeId) return ElMessage.warning('请先关联销售订单')
    openFinishedGoodsBatchWindow()
    return
  }
  return ElMessage.info('当前出库类型的批量添加功能开发中')
}

function recalcLine(row) {
  if (form.inTax === '2') row.tax = 0
  const qty = Number(row.kcaq03 || 0)
  const tax = Number(row.tax || 0)
  // 成品出库：单价未填时不把 0 写回输入框，金额/报关单价同步留空
  if (form.outboundType === '6' && isEmptyOutboundPrice(row.kcaq04)) {
    row.kcaq041 = null
    row.kcaq05 = null
    row.kcaq051 = null
    row.kcaq08 = null
    return
  }
  const ex = Number(row.kcaq04 || 0)
  row.kcaq041 = Number((ex * (1 + tax)).toFixed(4))
  row.kcaq05 = Number((qty * ex).toFixed(2))
  row.kcaq051 = Number((qty * row.kcaq041).toFixed(2))
  // 成品出库：报关单价跟不含税单价
  if (form.outboundType === '6') row.kcaq08 = ex
}

function reverseLine(row) {
  if (form.inTax === '2') row.tax = 0
  const tax = Number(row.tax || 0)
  const inc = Number(row.kcaq041 || 0)
  row.kcaq04 = Number((tax === 0 ? inc : inc / (1 + tax)).toFixed(4))
  recalcLine(row)
}

onMounted(() => {
  loadList()
  fetchWarehouses('')
  window.addEventListener('message', handleOtherBatchMessage)
  window.addEventListener('message', handlePurchaseReturnBatchMessage)
  window.addEventListener('message', handleAssistIssueBatchMessage)
  window.addEventListener('message', handleProductionIssueBatchMessage)
  window.addEventListener('message', handleFinishedGoodsBatchMessage)
  const storedOtherSession = activeOtherBatchSessionId.value
  if (storedOtherSession) {
    const payload = readStockOutBatchResult(storedOtherSession)
    if (payload) handleOtherBatchPayload(payload, null, { allowStoredSession: true })
  }
  const storedPrSession = activePurchaseReturnBatchSessionId.value
  if (storedPrSession) {
    const payload = readStockOutPurchaseReturnBatchResult(storedPrSession)
    if (payload) handlePurchaseReturnBatchPayload(payload, null, { allowStoredSession: true })
  }
  const storedAiSession = activeAssistIssueBatchSessionId.value
  if (storedAiSession) {
    const payload = readStockOutAssistIssueBatchResult(storedAiSession)
    if (payload) handleAssistIssueBatchPayload(payload, null, { allowStoredSession: true })
  }
  const storedPiSession = activeProductionIssueBatchSessionId.value
  if (storedPiSession) {
    const payload = readStockOutProductionIssueBatchResult(storedPiSession)
    if (payload) handleProductionIssueBatchPayload(payload, null, { allowStoredSession: true })
  }
  const storedFgSession = activeFinishedGoodsBatchSessionId.value
  if (storedFgSession) {
    const payload = readStockOutFinishedGoodsBatchResult(storedFgSession)
    if (payload) handleFinishedGoodsBatchPayload(payload, null, { allowStoredSession: true })
  }
})

onUnmounted(() => {
  window.removeEventListener('message', handleOtherBatchMessage)
  window.removeEventListener('message', handlePurchaseReturnBatchMessage)
  window.removeEventListener('message', handleAssistIssueBatchMessage)
  window.removeEventListener('message', handleProductionIssueBatchMessage)
  window.removeEventListener('message', handleFinishedGoodsBatchMessage)
})
</script>

<style scoped>
.stock-out-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* DIY：第一行供应商/外协商输入框宽度（与入库单一致） */
  --stock-filter-related-width: 240px;
  /* DIY：第一行出库类型下拉宽度 */
  --stock-filter-type-width: 160px;
  /* DIY：第二行关键词搜索框宽度 */
  --stock-filter-keyword-width: 420px;
  /* DIY：筛选开关组之间的间隔 */
  --stock-filter-switch-gap: 20px;
  /* DIY：列表「出库单数据」字号 */
  --stock-out-data-size: 13px;
  /* DIY：出库单数据 - 蓝（关联单位/货仓/总项数） */
  --stock-out-data-color-blue: #1d4ed8;
  /* DIY：出库单数据 - 紫（含税总价） */
  --stock-out-data-color-purple: #7c3aed;
  /* DIY：出库单数据 - 深红（不含税/税点/出库数量） */
  --stock-out-data-color-danger: #dc2626;
}
.stock-out-mode-bar,
.line-toolbar,
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
/* DIY：成品出库编辑明细列宽（stock-out-lines-table--finished-goods） */
.stock-out-lines-table--finished-goods {
  --stock-out-fg-line-qty-width: 100px;
  --stock-out-fg-line-price-width: 100px;
  --stock-out-fg-line-tax-width: 88px;
  --stock-out-fg-line-amount-width: 96px;
  --stock-out-fg-line-customs-ref-min: 140px;
  --stock-out-fg-line-customs-model-min: 160px;
  --stock-out-fg-line-customs-price-width: 110px;
}
.stock-out-lines-table--finished-goods :deep(.stock-out-line-number-input) {
  width: 100%;
}
.stock-out-lines-table--finished-goods :deep(.stock-out-line-number-input .el-input__wrapper) {
  padding-left: 8px;
  padding-right: 8px;
}
/* DIY：出库单明细 - 厂款号/PI号、备注列宽约 30 字（stock-out-line-wide-col min-width 420px） */
.stock-out-line-wide-input {
  width: 100%;
}
.stock-out-lines-table :deep(.stock-out-line-wide-col .cell) {
  padding-left: 8px;
  padding-right: 8px;
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
.erp-section {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  padding: 12px;
}
.switch-label,
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.stock-alert {
  margin: 10px 0;
}
.row-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.status-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.locked-mark {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.pagination {
  margin-top: 12px;
  justify-content: flex-end;
}
.stock-out-data {
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.6;
  font-size: var(--stock-out-data-size, 13px);
}
.stock-out-data__line {
  white-space: normal;
  word-break: break-all;
}
.stock-out-data__blue {
  color: var(--stock-out-data-color-blue);
}
.stock-out-data__purple {
  color: var(--stock-out-data-color-purple);
}
.stock-out-data__danger {
  color: var(--stock-out-data-color-danger);
}
.stock-expand-inner {
  padding: 12px 14px;
  background: #f8fafc;
}
.stock-expand-lines-table {
  width: 100%;
}
.form-head {
  justify-content: space-between;
  margin-bottom: 12px;
}
.stock-form {
  max-width: 980px;
}
.stock-form--base {
  --stock-base-input-width: 320px;
  --stock-inline-input-width: 200px;
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
.stock-inline-input {
  width: var(--stock-inline-input-width);
  flex: 0 0 var(--stock-inline-input-width);
}
.form-inline-pairs--nowrap {
  flex-wrap: nowrap;
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
.stock-remark-input {
  width: min(100%, calc(var(--stock-base-input-width) * 2 + var(--stock-inline-gap)));
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
  flex-wrap: wrap;
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
.detail-lines {
  margin-top: 12px;
}
.assist-party-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.assist-party-row__party {
  flex: 0 0 var(--stock-base-input-width);
  width: var(--stock-base-input-width);
  min-width: var(--stock-base-input-width);
}
.production-dispatch-toolbar {
  margin-bottom: 10px;
}
.production-dispatch-toolbar__label {
  color: #606266;
  margin-right: 4px;
}
.cutting-config-desc {
  margin: 0 0 12px;
  color: #606266;
  font-size: 14px;
}
.cutting-config-alert {
  margin-bottom: 12px;
}
</style>
