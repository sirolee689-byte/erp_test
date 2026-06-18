<template>
  <div class="erp-module-page buy-order-page" :class="{ 'buy-order-page--form': isFormPanel }">
    <div class="buy-mode-bar">
      <el-button
        :type="pageMode === 'manage' ? 'primary' : 'default'"
        plain
        @click="switchToManage"
      >
        管理采购订单
      </el-button>
      <el-button
        v-permission="'add'"
        :type="pageMode === 'create' ? 'primary' : 'default'"
        plain
        @click="switchToCreate"
      >
        采购订单添加
      </el-button>
    </div>

    <div v-show="pageMode === 'manage'" class="buy-manage-panel">
      <div class="buy-toolbar">
        <div class="buy-toolbar__actions">
          <el-button :loading="loading" @click="loadList">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
      </div>

      <div class="buy-filter-bar">
        <div class="buy-filter-row buy-filter-row--top">
          <div class="buy-filter-field">
            <span class="buy-filter-label">供应商</span>
            <el-select
              v-model="filters.supplier"
              clearable
              filterable
              remote
              reserve-keyword
              class="buy-filter-supplier"
              :remote-method="fetchFilterSuppliers"
              :loading="filterSupplierLoading"
              placeholder="编码或名称搜索"
              @focus="handleFilterSupplierFocus"
            >
              <el-option
                v-for="item in filterSuppliers"
                :key="item.code"
                :label="`${item.code} ${item.name}`"
                :value="item.code"
              />
            </el-select>
          </div>
          <div class="buy-filter-field">
            <span class="buy-filter-label">采购类型</span>
            <el-select v-model="filters.buyType" clearable class="buy-filter-type" placeholder="全部">
              <el-option v-for="opt in buyTypeFilterOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </div>
        </div>
        <div class="buy-filter-row buy-filter-row--bottom">
          <div class="buy-filter-field buy-filter-field--keyword">
            <span class="buy-filter-label">查询内容</span>
            <el-input
              v-model="filters.keyword"
              clearable
              class="buy-filter-keyword"
              placeholder="单号 / PI / 供应商 / 备注"
              @keyup.enter="onSearch"
            />
          </div>
          <el-button type="primary" size="small" @click="onSearch">查询</el-button>
          <el-button size="small" @click="resetFilters">重置</el-button>
          <div class="buy-filter-divider" aria-hidden="true" />
          <div class="buy-filter-switch">
            <span class="switch-label">回收站</span>
            <el-switch v-model="recycled" @change="onRecycleChange" />
          </div>
          <template v-if="!recycled">
            <div class="buy-filter-divider" aria-hidden="true" />
            <div class="buy-filter-switch">
              <span class="switch-label">显示未审核</span>
              <el-switch v-model="showUnaudited" @change="onUnauditedChange" />
            </div>
          </template>
        </div>
      </div>

      <el-alert v-if="recycled" type="info" show-icon title="当前是回收站：只处理已软删除的采购单，可恢复或彻底删除。" class="buy-alert" />
      <el-alert v-else-if="showUnaudited" type="warning" show-icon title="当前显示待审核采购单，可编辑、审核或删除。" class="buy-alert" />

      <div class="pagination-row pagination-row--top">
        <el-pagination
          v-model:current-page="page.page"
          v-model:page-size="page.pageSize"
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="page.total"
          :page-sizes="[10, 20, 50, 100]"
          @size-change="loadList"
          @current-change="loadList"
        />
      </div>

      <ErpTableViewportHScroll>
        <el-table
          ref="listTableRef"
          v-loading="loading"
          :data="rows"
          border
          stripe
          class="erp-list-table buy-table"
          style="width: 100%"
          empty-text="暂无采购单"
        >
        <el-table-column
          label="操作"
          :width="buyOrderActionsColWidth"
          fixed="left"
          align="left"
          header-align="center"
          class-name="erp-col-actions"
        >
          <template #default="{ row }">
            <div class="action-bar buy-order-actions">
              <template v-if="recycled">
                <el-button type="primary" plain size="small" @click.stop="lifecycle(row, 'restore')">恢复</el-button>
                <el-button type="danger" plain size="small" @click.stop="lifecycle(row, 'hard')">彻底删除</el-button>
              </template>
              <template v-else>
                <el-button plain size="small" @click.stop="openDetail(row)">查看</el-button>
                <template v-if="showUnaudited">
                  <el-button
                    v-permission="'edit'"
                    type="primary"
                    plain
                    size="small"
                    :disabled="row.pass === '1'"
                    @click.stop="openEdit(row)"
                  >
                    编辑
                  </el-button>
                  <el-button
                    v-if="row.pass !== '1'"
                    v-permission="'audit'"
                    plain
                    size="small"
                    @click.stop="lifecycle(row, 'audit')"
                  >
                    审核
                  </el-button>
                  <el-button
                    v-permission="'delete'"
                    type="danger"
                    plain
                    size="small"
                    :disabled="row.pass === '1'"
                    @click.stop="lifecycle(row, 'delete')"
                  >
                    删除
                  </el-button>
                </template>
                <template v-else>
                  <el-button
                    v-if="row.pass === '1'"
                    v-permission="'audit'"
                    plain
                    size="small"
                    @click.stop="askUnaudit(row)"
                  >
                    反审
                  </el-button>
                </template>
                <el-button plain size="small" @click.stop="openPrint(row)">打印</el-button>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="150" class-name="buy-status-col">
          <template #default="{ row }">
            <div class="buy-status-cell">
              <el-tag :type="row.pass === '1' ? 'success' : 'warning'" size="small">{{ row.pass === '1' ? '已审核' : '未审核' }}</el-tag>
              <el-tag :type="row.closed === '1' ? 'info' : ''" size="small">{{ row.closed === '1' ? '已结案' : '未结案' }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="采购类型" width="105">
          <template #default="{ row }">{{ buyTypeText(row.buyType) }}</template>
        </el-table-column>
        <el-table-column prop="buyOrderNo" label="采购订单号" min-width="130" fixed="left" />
        <el-table-column prop="buyDate" label="采购订单日期" width="120">
          <template #default="{ row }">{{ fmtDate(row.buyDate) }}</template>
        </el-table-column>
        <el-table-column label="采购订单数据" width="380" class-name="buy-order-data-col">
          <template #default="{ row }">
            <div class="buy-order-data">
              <div class="buy-order-data__line">供应商：{{ row.supplierName || row.supplierCode || '-' }}　小数点配置：{{ decimalPlaces(row) }} 位</div>
              <div class="buy-order-data__line">
                总项数：{{ formatNumber(row.itemCount, 0) }}　总数量：{{ formatNumber(row.totalQty, decimalPlaces(row)) }}
                <span :class="pendingInboundClass(row)">（未审数：{{ formatNumber(row.pendingInboundQty, decimalPlaces(row)) }}）</span>
              </div>
              <div v-if="hasPrice" class="buy-order-data__line">
                含税总价：<span class="buy-order-data__inc">{{ formatMoneyWithPrecision(row.taxIncludedTotal, 2) }}</span> {{ row.currencyName || '' }}，
                不含税总价：<span class="buy-order-data__ex">{{ formatMoneyWithPrecision(row.taxExcludedTotal, 2) }}</span> {{ row.currencyName || '' }}，
                税点总价：{{ formatMoneyWithPrecision(taxDiffTotal(row), 2) }} {{ row.currencyName || '' }}
              </div>
              <div class="buy-order-data__line">额外费用：{{ formatMoneyWithPrecision(row.extraFeeTotal, 2) }} 元</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="referenceNo" label="关联单号" min-width="180" show-overflow-tooltip />
        <el-table-column prop="currencyName" label="币别" width="90" />
        <el-table-column prop="supplierName" label="供应商/外协商" min-width="180" show-overflow-tooltip />
        <el-table-column label="是否含税" width="96">
          <template #default="{ row }">{{ String(row.taxIncluded) === '2' ? '不含税' : '含税' }}</template>
        </el-table-column>
        <el-table-column prop="loadingPort" label="装货港" min-width="120" show-overflow-tooltip />
        <el-table-column prop="dischargePort" label="卸货港" min-width="120" show-overflow-tooltip />
        <el-table-column prop="paymentTerms" label="付款条件" min-width="120" show-overflow-tooltip />
        <el-table-column prop="remark" label="备注" min-width="180" show-overflow-tooltip />
        <el-table-column label="录入人" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.utruename || row.uname || '' }}</template>
        </el-table-column>
        </el-table>
      </ErpTableViewportHScroll>

      <div class="pagination-row pagination-row--bottom">
        <el-pagination
          v-model:current-page="page.page"
          v-model:page-size="page.pageSize"
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="page.total"
          :page-sizes="[10, 20, 50, 100]"
          @size-change="loadList"
          @current-change="loadList"
        />
      </div>
    </div>

    <div
      v-show="isFormPanel"
      ref="createPanelRef"
      v-loading="pageMode === 'edit' && detailLoading"
      class="buy-create-panel"
    >
      <div class="buy-form-head">
        <strong>{{ pageMode === 'edit' ? '编辑采购订单' : '新增采购订单' }}</strong>
        <div class="buy-form-head__actions">
          <el-button @click="switchToManage">返回列表</el-button>
          <el-button type="primary" :loading="saving" @click="saveOrder">保存</el-button>
        </div>
      </div>
      <el-form ref="formRef" :model="form.header" :rules="rules" label-width="110px" class="buy-edit-form">
        <el-tabs v-model="activeTab" class="buy-edit-tabs">
          <el-tab-pane label="订单基础资料" name="header">
            <div class="buy-basic-layout">
              <div class="buy-basic-row">
                <div class="buy-basic-field">
                  <span class="buy-basic-label buy-basic-label--required">采购单号</span>
                  <el-form-item prop="buyOrderNo">
                    <el-input v-model="form.header.buyOrderNo" class="buy-basic-input buy-basic-input--doc" :readonly="pageMode === 'edit'" />
                  </el-form-item>
                </div>
                <div class="buy-basic-field">
                  <span class="buy-basic-label">单号类型</span>
                  <div class="buy-basic-buttons">
                    <el-button :type="form.header.numberType === 'ZY' ? 'primary' : ''" @click="chooseNumberType('ZY')">ZY</el-button>
                    <el-button :type="form.header.numberType === 'PO' ? 'primary' : ''" @click="chooseNumberType('PO')">PO</el-button>
                    <el-button :type="form.header.numberType === currentYear ? 'primary' : ''" @click="chooseNumberType(currentYear)">{{ currentYear }}</el-button>
                  </div>
                </div>
              </div>

              <div class="buy-basic-row">
                <div class="buy-basic-field">
                  <span class="buy-basic-label buy-basic-label--required">采购日期</span>
                  <el-form-item prop="buyDate">
                    <el-date-picker v-model="form.header.buyDate" type="date" value-format="YYYY-MM-DD" class="buy-basic-input buy-basic-input--doc" />
                  </el-form-item>
                </div>
                <div class="buy-basic-field">
                  <span class="buy-basic-label buy-basic-label--required">采购类型</span>
                  <el-form-item prop="buyType">
                    <div class="buy-basic-buttons">
                      <el-button
                        v-for="opt in buyTypeButtonOptions"
                        :key="opt.value"
                        :type="form.header.buyType === opt.value ? 'primary' : ''"
                        :disabled="opt.disabled"
                        @click="chooseBuyType(opt.value)"
                      >
                        {{ opt.label }}
                      </el-button>
                    </div>
                  </el-form-item>
                </div>
              </div>

              <div class="buy-basic-row buy-basic-row--reference">
                <div class="buy-basic-field buy-basic-field--wide">
                  <span class="buy-basic-label buy-basic-label--required">关联单号</span>
                  <el-form-item prop="referenceNo">
                    <div class="buy-reference-picker">
                      <el-input v-model="form.header.referenceNo" class="buy-basic-input buy-basic-input--reference" placeholder="可手动填写，也可选择多个 PI" @input="syncSelectedPisFromReference" />
                      <el-button type="primary" plain @click="openPiDialog">选择</el-button>
                      <el-button plain :disabled="!form.header.referenceNo" @click="clearReferenceNo">清空</el-button>
                    </div>
                  </el-form-item>
                </div>
              </div>

              <div class="buy-basic-row">
                <div class="buy-basic-field buy-basic-field--supplier">
                  <span class="buy-basic-label buy-basic-label--required">供应商</span>
                  <el-form-item prop="supplierCode">
                    <el-select v-model="form.header.supplierCode" filterable remote reserve-keyword :remote-method="loadSuppliers" class="buy-basic-input buy-basic-input--supplier">
                      <el-option v-for="s in suppliers" :key="s.code" :label="`${s.code} / ${s.name}`" :value="s.code" />
                    </el-select>
                  </el-form-item>
                </div>
              </div>

              <div class="buy-basic-row">
                <div class="buy-basic-field">
                  <span class="buy-basic-label">装货港</span>
                  <el-form-item>
                    <el-input v-model="form.header.loadingPort" class="buy-basic-input buy-basic-input--port" />
                  </el-form-item>
                </div>
                <div class="buy-basic-field">
                  <span class="buy-basic-label">卸货港</span>
                  <el-form-item>
                    <el-input v-model="form.header.dischargePort" class="buy-basic-input buy-basic-input--port" />
                  </el-form-item>
                </div>
              </div>

              <div class="buy-basic-row">
                <div class="buy-basic-field">
                  <span class="buy-basic-label buy-basic-label--required">是否含税</span>
                  <el-form-item prop="taxIncluded">
                    <div class="buy-basic-buttons">
                      <el-button :type="form.header.taxIncluded === '1' ? 'primary' : ''" @click="chooseTaxIncluded('1')">是</el-button>
                      <el-button :type="form.header.taxIncluded === '2' ? 'primary' : ''" @click="chooseTaxIncluded('2')">否</el-button>
                    </div>
                  </el-form-item>
                </div>
                <div class="buy-basic-field">
                  <span class="buy-basic-label buy-basic-label--required">币别</span>
                  <el-form-item prop="currencyCode">
                    <el-select v-model="form.header.currencyCode" class="buy-basic-input buy-basic-input--currency">
                      <el-option v-for="c in currencies" :key="c.code" :label="`${c.code} / ${c.name}`" :value="c.code" />
                    </el-select>
                  </el-form-item>
                </div>
                <div class="buy-basic-field buy-basic-field--decimal">
                  <span class="buy-basic-label">小数点配置</span>
                  <el-form-item>
                    <div class="buy-decimal-field">
                      <el-input-number v-model="form.header.decimalPlaces" :min="0" :max="8" :controls="false" class="buy-basic-input buy-basic-input--decimal" />
                      <span>位</span>
                    </div>
                  </el-form-item>
                </div>
              </div>

              <div class="buy-basic-row buy-basic-row--full">
                <div class="buy-basic-field buy-basic-field--full">
                  <span class="buy-basic-label">付款条件</span>
                  <el-form-item>
                    <el-input v-model="form.header.paymentTerms" class="buy-basic-input buy-basic-input--full" />
                  </el-form-item>
                </div>
              </div>

              <div class="buy-basic-row buy-basic-row--full">
                <div class="buy-basic-field buy-basic-field--full">
                  <span class="buy-basic-label">备注</span>
                  <el-form-item>
                    <el-input v-model="form.header.remark" type="textarea" :rows="2" class="buy-basic-input buy-basic-input--full" />
                  </el-form-item>
                </div>
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="采购订单明细" name="lines">
            <div class="line-toolbar">
              <el-button type="danger" plain @click="deleteSelectedBuyLines">删除选定明细</el-button>
              <el-button type="danger" plain @click="deleteAllBuyLines">删除全部明细</el-button>
              <el-button type="primary" @click="openBuyBatchAdd">批量添加</el-button>
            </div>
            <el-table :data="form.lines" border class="buy-lines-table" :row-class-name="buyLineRowClassName">
              <el-table-column label="选择" width="88" align="center" fixed="left">
                <template #default="{ row }">
                  <el-button
                    size="small"
                    class="buy-line-mark-btn"
                    :class="{ 'buy-line-mark-btn--on': row._lineMarked }"
                    @click="toggleLineMark(row)"
                  >
                    {{ row._lineMarked ? '已选择' : '删除' }}
                  </el-button>
                </template>
              </el-table-column>
              <el-table-column label="序号" width="64" align="center" fixed="left">
                <template #default="{ row }">{{ row.seq }}</template>
              </el-table-column>
              <el-table-column label="操作" width="108" align="center" fixed="left">
                <template #default="{ row }">
                  <el-button size="small" type="primary" plain @click="openLinePiBom(row)">查看原资料</el-button>
                </template>
              </el-table-column>
              <el-table-column label="材料编码" prop="kcaa01" min-width="130" fixed="left" show-overflow-tooltip />
              <el-table-column label="材料名称/送货名" min-width="180">
                <template #default="{ row }">
                  <div class="buy-line-name-cell">
                    <div class="buy-line-name-cell__primary">{{ row.kcaa02 || '-' }}</div>
                    <div class="buy-line-name-cell__divider" />
                    <div class="buy-line-name-cell__secondary">{{ row.gkcaa02 || '-' }}</div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="材料规格" prop="kcaa03" min-width="130" show-overflow-tooltip />
              <el-table-column label="颜色" prop="kcaa11" width="100" show-overflow-tooltip />
              <el-table-column label="采购单位" prop="kcaa25" width="96" show-overflow-tooltip />
              <el-table-column label="数量" width="120">
                <template #default="{ row }">
                  <el-input-number v-model="row.quantity" :min="0" :precision="4" :controls="false" class="buy-line-input-num" @change="recalcLine(row)" />
                </template>
              </el-table-column>
              <el-table-column v-if="hasPrice" label="单价" width="110" align="right">
                <template #default="{ row }">{{ money(row.taxExcludedPrice) }}</template>
              </el-table-column>
              <el-table-column v-if="hasPrice" label="单价(含税)" width="120">
                <template #default="{ row }">
                  <el-input-number v-model="row.taxIncludedPrice" :min="0" :precision="form.header.decimalPlaces" :controls="false" class="buy-line-input-num" @change="recalcLine(row)" />
                </template>
              </el-table-column>
              <el-table-column v-if="hasPrice" label="金额" width="110" align="right">
                <template #default="{ row }">{{ money(row.taxExcludedAmount) }}</template>
              </el-table-column>
              <el-table-column v-if="hasPrice" label="金额(含税)" width="110" align="right">
                <template #default="{ row }">{{ money(row.taxIncludedAmount) }}</template>
              </el-table-column>
              <el-table-column v-if="hasPrice" label="税点" width="110">
                <template #default="{ row }">
                  <el-input-number v-model="row.tax" :min="0" :max="0.99" :precision="4" :controls="false" class="buy-line-input-num" @change="recalcLine(row)" />
                </template>
              </el-table-column>
              <el-table-column label="PO/PI" min-width="150" show-overflow-tooltip>
                <template #default="{ row }">{{ linePoPiText(row) }}</template>
              </el-table-column>
              <el-table-column label="交货日期" width="160">
                <template #default="{ row }">
                  <el-date-picker v-model="row.deliveryDate" type="date" value-format="YYYY-MM-DD" />
                </template>
              </el-table-column>
              <el-table-column label="备注" min-width="150">
                <template #default="{ row }">
                  <el-input v-model="row.info" />
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="额外费用清单" name="fees">
            <div class="line-toolbar">
              <el-select v-model="feePicked" filterable remote reserve-keyword placeholder="选择FEE费用" :remote-method="loadFees">
                <el-option v-for="f in feeOptions" :key="f.feeCode" :label="`${f.feeCode} / ${f.feeName}`" :value="f.feeCode" />
              </el-select>
              <el-button @click="addFee">添加</el-button>
            </div>
            <el-table :data="form.fees" border>
              <el-table-column prop="feeCode" label="费用编码" width="130" />
              <el-table-column prop="feeName" label="费用名称" min-width="160" />
              <el-table-column prop="spec" label="规格" min-width="120" />
              <el-table-column v-if="hasPrice" label="金额" width="130"><template #default="{ row }"><el-input-number v-model="row.money" :precision="2" /></template></el-table-column>
              <el-table-column v-if="hasPrice" label="税点" width="120"><template #default="{ row }"><el-input-number v-model="row.tax" :min="0" :max="0.99" :precision="4" /></template></el-table-column>
              <el-table-column label="备注" min-width="150"><template #default="{ row }"><el-input v-model="row.remark" /></template></el-table-column>
              <el-table-column label="操作" width="75"><template #default="{ $index }"><el-button link type="danger" @click="form.fees.splice($index, 1)">删除</el-button></template></el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </el-form>
    </div>

    <el-dialog v-model="detailVisible" title="采购单详情" width="1100px" top="4vh">
      <detail-block :detail="detail" :has-price="hasPrice" />
    </el-dialog>

    <el-dialog v-model="printVisible" title="采购单打印预览" width="1100px" top="3vh" class="print-dialog">
      <div class="print-page">
        <h2>采购单</h2>
        <detail-block :detail="printData" :has-price="hasPrice" />
      </div>
      <template #footer><el-button @click="windowPrint">打印</el-button></template>
    </el-dialog>

    <el-dialog v-model="piDialog.visible" title="选择 PI" width="920px" class="buy-pi-dialog">
      <div class="buy-pi-toolbar">
        <el-input v-model="piDialog.keyword" clearable placeholder="PI号 / PO号 / 客户" @keyup.enter="searchPiDialog" />
        <el-button type="primary" @click="searchPiDialog">查询</el-button>
        <el-button v-if="isMultiPiMode" type="primary" plain :disabled="!piDialog.selected.length" @click="applyPiSelection">保存已选数据</el-button>
      </div>
      <el-table
        v-loading="piDialog.loading"
        :data="piDialog.list"
        border
        stripe
        row-key="piNo"
      >
        <el-table-column label="操作" width="110" align="center" fixed="left">
          <template #default="{ row }">
            <el-button
              size="small"
              :type="isPiSelected(row) ? 'success' : 'primary'"
              :plain="!isPiSelected(row)"
              class="buy-pi-select-button"
              @click="choosePiRow(row)"
            >
              {{ isPiSelected(row) ? '已选择' : '选择' }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="PI号" prop="piNo" min-width="160" show-overflow-tooltip />
        <el-table-column label="PO号" prop="poNo" min-width="160" show-overflow-tooltip />
        <el-table-column label="客户" prop="customer" min-width="220" show-overflow-tooltip />
      </el-table>
      <el-pagination
        v-model:current-page="piDialog.page"
        v-model:page-size="piDialog.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="piDialog.total"
        class="buy-pi-pagination"
        @size-change="onPiPageSizeChange"
        @current-change="onPiPageChange"
      />
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import axios from 'axios'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ErpTableViewportHScroll from '@/components/erp/ErpTableViewportHScroll.vue'
import { getErpTableActionsColMinWidth } from '@/utils/erpTableActionsLayout'
import { refreshErpTableViewportHScroll } from '@/utils/erpTableViewportHScroll'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import {
  BUY_BATCH_MSG_ACCEPTED,
  BUY_BATCH_MSG_APPLY,
  BUY_BATCH_MSG_REJECTED,
  BUY_BATCH_REJECT_PI_MISMATCH,
  BUY_BATCH_REJECT_SUPPLIER_MISMATCH,
  BUY_BATCH_RESULT_PREFIX,
  buildBuyBatchSessionId,
  parseBuyBatchResultPayload,
  validateBuyBatchApply,
  writeBuyBatchContext,
} from '@/utils/buyOrderBatchAdd'

defineOptions({ name: 'supply-chain-daily-purchase-order' })

const menuPath = 'supply-chain/daily/purchase-order'
const model = getPermissionModelFromStorage()
const hasPrice = computed(() => hasPageAction(model, menuPath, 'price'))
const currentYear = String(new Date().getFullYear())
const pageMode = ref('manage')
const createPanelInitialized = ref(false)
const listTableRef = ref(null)
const createPanelRef = ref(null)
const activeTab = ref('header')
const loading = ref(false)
const detailLoading = ref(false)
const saving = ref(false)
const recycled = ref(false)
const showUnaudited = ref(false)
const rows = ref([])
const page = reactive({ page: 1, pageSize: 10, total: 0 })
const filters = reactive({ keyword: '', buyType: '', supplier: '' })
const formRef = ref()
const suppliers = ref([])
const filterSuppliers = ref([])
const filterSupplierLoading = ref(false)
const buyTypeFilterOptions = [
  { label: '其他采购', value: '0' },
  { label: '订单采购', value: '1' },
  { label: '请购采购', value: '2' },
]
const currencies = ref([])
const materials = ref([])
const feeOptions = ref([])
const materialPicked = ref('')
const feePicked = ref('')
const selectedPis = ref([])
const piDialog = reactive({ visible: false, loading: false, keyword: '', list: [], selected: [], page: 1, pageSize: 10, total: 0 })
const detailVisible = ref(false)
const printVisible = ref(false)
const detail = ref({ header: {}, lines: [], fees: [] })
const printData = ref({ header: {}, lines: [], fees: [] })
const editId = ref(null)
const activeBatchSessionId = ref('')

const isFormPanel = computed(() => pageMode.value === 'create' || pageMode.value === 'edit')
const isMultiPiMode = computed(() => form.header.buyType === '2')

const buyOrderActionsColWidth = computed(() => {
  if (recycled.value) return getErpTableActionsColMinWidth(2)
  if (showUnaudited.value) return getErpTableActionsColMinWidth(5)
  return getErpTableActionsColMinWidth(3)
})

watch([rows, loading, recycled, showUnaudited], async () => {
  if (loading.value) return
  await nextTick()
  listTableRef.value?.doLayout?.()
  const el = listTableRef.value?.$el
  if (el) refreshErpTableViewportHScroll(el)
})

const blankHeader = () => ({
  numberType: 'ZY',
  buyOrderNo: '',
  buyDate: new Date().toISOString().slice(0, 10),
  buyType: '1',
  referenceNo: '',
  referencePoNo: '',
  referenceOrderId: null,
  supplierCode: '',
  taxIncluded: '1',
  currencyCode: '',
  loadingPort: '',
  dischargePort: '',
  paymentTerms: '',
  remark: '',
  decimalPlaces: 4,
})
const form = reactive({ header: blankHeader(), lines: [], fees: [] })
const rules = {
  buyOrderNo: [{ required: true, message: '请输入采购单号', trigger: 'blur' }],
  buyDate: [{ required: true, message: '请选择采购日期', trigger: 'change' }],
  buyType: [{ required: true, message: '请选择采购类型', trigger: 'change' }],
  referenceNo: [{ validator: (_r, _v, cb) => (['1', '2'].includes(form.header.buyType) && !form.header.referenceNo ? cb(new Error('请选择或填写关联单号')) : cb()), trigger: 'blur' }],
  supplierCode: [{ required: true, message: '请选择供应商', trigger: 'change' }],
  currencyCode: [{ required: true, message: '请选择币别', trigger: 'change' }],
}

const buyTypeOptions = computed(() => {
  if (form.header.numberType === 'PO') return [{ label: '请购采购', value: '2' }]
  if (form.header.numberType === 'ZY') return [{ label: '订单采购', value: '1' }, { label: '请购采购', value: '2' }]
  return [{ label: '其他采购', value: '0' }, { label: '订单采购', value: '1' }, { label: '请购采购', value: '2' }]
})

const buyTypeButtonOptions = computed(() => {
  const allowed = new Set(buyTypeOptions.value.map((opt) => opt.value))
  return [
    { label: '订单采购', value: '1', disabled: !allowed.has('1') },
    { label: '请购采购', value: '2', disabled: !allowed.has('2') },
    { label: '其他采购', value: '0', disabled: !allowed.has('0') },
  ]
})

const DetailBlock = defineComponent({
  props: { detail: Object, hasPrice: Boolean },
  setup(props) {
    return () => h('div', { class: 'detail-block' }, [
      h('div', { class: 'detail-title' }, `单号：${props.detail?.header?.kcaj01 || props.detail?.header?.buyOrderNo || ''}`),
      h('div', { class: 'detail-grid' }, [
        `日期：${fmtDate(props.detail?.header?.kcaj02 || props.detail?.header?.buyDate)}`,
        `类型：${buyTypeText(props.detail?.header?.kcaj03 || props.detail?.header?.buyType)}`,
        `关联单号：${props.detail?.header?.kcaj04 || props.detail?.header?.referenceNo || ''}`,
        `供应商：${props.detail?.header?.kehu || props.detail?.header?.supplierName || ''}`,
        `币别：${props.detail?.header?.rmb || props.detail?.header?.currencyName || ''}`,
        `状态：${props.detail?.header?.pass === '1' ? '已审核' : '未审核'} / ${props.detail?.header?.closed === '1' ? '已结案' : '未结案'}`,
      ].map((t) => h('span', t))),
      h('h3', '采购明细'),
      h('table', { class: 'plain-table' }, [
        h('thead', h('tr', ['编码', '名称', '规格', '数量', ...(props.hasPrice ? ['含税单价', '税点', '含税金额'] : []), '备注'].map((x) => h('th', x)))),
        h('tbody', (props.detail?.lines ?? []).map((line) => h('tr', [
          h('td', line.kcaa01 || ''),
          h('td', line.kcaa02 || ''),
          h('td', line.kcaa03 || ''),
          h('td', line.kcak03 ?? line.quantity ?? ''),
          ...(props.hasPrice ? [h('td', line.kcak041 ?? ''), h('td', line.tax ?? ''), h('td', line.kcak051 ?? '')] : []),
          h('td', line.info || ''),
        ]))),
      ]),
      h('h3', '额外费用'),
      h('table', { class: 'plain-table' }, [
        h('thead', h('tr', ['编码', '名称', ...(props.hasPrice ? ['金额', '税点'] : []), '备注'].map((x) => h('th', x)))),
        h('tbody', (props.detail?.fees ?? []).map((fee) => h('tr', [
          h('td', fee.kcaa01 || fee.feeCode || ''),
          h('td', fee.kcaa02 || fee.feeName || ''),
          ...(props.hasPrice ? [h('td', fee.money ?? ''), h('td', fee.tax ?? '')] : []),
          h('td', fee.remark || ''),
        ]))),
      ]),
    ])
  },
})

function fmtDate(v) {
  return v ? String(v).slice(0, 10) : ''
}
function money(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}
function numberVal(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function decimalPlaces(row) {
  const n = Number(row?.decimalPlaces)
  return Number.isInteger(n) && n >= 0 ? n : 4
}
function formatNumber(v, precision = 2) {
  return numberVal(v).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: Math.max(0, precision) })
}
function formatMoneyWithPrecision(v, precision = 2) {
  return numberVal(v).toLocaleString('zh-CN', { minimumFractionDigits: precision, maximumFractionDigits: precision })
}
function pendingInboundClass(row) {
  return numberVal(row?.pendingInboundQty) > 0 ? 'buy-order-data__pending--warn' : 'buy-order-data__pending--ok'
}
function taxDiffTotal(row) {
  return numberVal(row?.taxIncludedTotal) - numberVal(row?.taxExcludedTotal)
}
function buyTypeText(v) {
  if (String(v) === '1') return '订单采购'
  if (String(v) === '2') return '请购采购'
  return '其他采购'
}
function piLabel(pi) {
  return [pi.piNo, pi.poNo, pi.customer].filter(Boolean).join(' / ')
}
function materialLabel(m) {
  return [m.kcaa01, m.kcaa02, m.kcaa03].filter(Boolean).join(' / ')
}

function onSearch() {
  page.page = 1
  loadList()
}

async function loadList() {
  loading.value = true
  try {
    const params = {
      page: page.page,
      pageSize: page.pageSize,
      recycled: recycled.value ? 1 : 0,
      keyword: filters.keyword,
      buyType: filters.buyType,
      supplier: filters.supplier,
    }
    // 业务规则：正常列表默认只看已审核；开关打开后只看未审核
    if (!recycled.value) {
      params.pass = showUnaudited.value ? '0' : '1'
    }
    const { data } = await axios.get('/api/buy-order/list', { params })
    if (data.code !== 200) throw new Error(data.msg)
    rows.value = data.data.list || []
    page.total = data.data.total || 0
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '读取采购单列表失败')
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  Object.assign(filters, { keyword: '', buyType: '', supplier: '' })
  filterSuppliers.value = []
  showUnaudited.value = false
  recycled.value = false
  page.page = 1
  loadList()
}

function onRecycleChange() {
  if (recycled.value) showUnaudited.value = false
  page.page = 1
  loadList()
}

function onUnauditedChange() {
  if (showUnaudited.value) recycled.value = false
  onSearch()
}

async function fetchFilterSuppliers(keyword = '') {
  filterSupplierLoading.value = true
  try {
    const { data } = await axios.get('/api/buy-order/supplier-options', { params: { keyword } })
    filterSuppliers.value = data.data?.list || []
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '读取供应商候选失败')
  } finally {
    filterSupplierLoading.value = false
  }
}

function handleFilterSupplierFocus() {
  if (!filterSuppliers.value.length) fetchFilterSuppliers('')
}

async function loadSuppliers(keyword = '') {
  const { data } = await axios.get('/api/buy-order/supplier-options', { params: { keyword } })
  suppliers.value = data.data?.list || []
}
async function loadCurrencies() {
  const { data } = await axios.get('/api/buy-order/currency-options')
  currencies.value = data.data?.list || []
}
async function loadMaterials(keyword = '') {
  const { data } = await axios.get('/api/buy-order/material-options', { params: { keyword } })
  materials.value = data.data?.list || []
}
async function loadFees(keyword = '') {
  const { data } = await axios.get('/api/buy-order/fee-options', { params: { keyword } })
  feeOptions.value = data.data?.list || []
}
function syncPis() {
  form.header.referenceNo = selectedPis.value.join(',')
}
function splitReferenceNos(value) {
  return String(value ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}
function syncSelectedPisFromReference() {
  selectedPis.value = splitReferenceNos(form.header.referenceNo)
}
function chooseBuyType(type) {
  if (!buyTypeOptions.value.some((opt) => opt.value === type)) return
  form.header.buyType = type
}
function chooseTaxIncluded(value) {
  form.header.taxIncluded = value
  recalcAll()
}
async function chooseNumberType(type) {
  form.header.numberType = type
  if (type === 'ZY') form.header.buyType = '1'
  else form.header.buyType = '2'
  const { data } = await axios.get('/api/buy-order/suggest-doc-no', { params: { numberType: type, saveDate: form.header.buyDate } })
  form.header.buyOrderNo = data.data?.suggested || ''
}
async function openPiDialog() {
  syncSelectedPisFromReference()
  piDialog.visible = true
  piDialog.keyword = ''
  piDialog.page = 1
  piDialog.selected = [...selectedPis.value]
  await searchPiDialog()
}
async function searchPiDialog() {
  piDialog.loading = true
  try {
    const { data } = await axios.get('/api/buy-order/pi-options', { params: { keyword: piDialog.keyword, page: piDialog.page, pageSize: piDialog.pageSize } })
    piDialog.list = data.data?.list || []
    piDialog.total = Number(data.data?.total ?? piDialog.list.length)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '读取 PI 候选失败')
    piDialog.list = []
    piDialog.total = 0
  } finally {
    piDialog.loading = false
  }
}
function onPiPageSizeChange() {
  piDialog.page = 1
  searchPiDialog()
}
function onPiPageChange() {
  searchPiDialog()
}
function isPiSelected(row) {
  return piDialog.selected.includes(row?.piNo)
}
function choosePiRow(row) {
  const piNo = String(row?.piNo ?? '').trim()
  if (!piNo) return
  if (!isMultiPiMode.value) {
    selectedPis.value = [piNo]
    form.header.referencePoNo = String(row?.poNo ?? '').trim()
    syncPis()
    piDialog.visible = false
    return
  }
  const existingIndex = piDialog.selected.indexOf(piNo)
  if (existingIndex >= 0) {
    piDialog.selected.splice(existingIndex, 1)
  } else {
    piDialog.selected.push(piNo)
  }
}
function applyPiSelection() {
  selectedPis.value = Array.from(new Set(piDialog.selected.map((piNo) => String(piNo ?? '').trim()).filter(Boolean)))
  syncPis()
  piDialog.visible = false
}
function clearReferenceNo() {
  form.header.referenceNo = ''
  form.header.referencePoNo = ''
  form.header.referenceOrderId = null
  selectedPis.value = []
  piDialog.selected = []
}

function resetFormData() {
  Object.assign(form.header, blankHeader())
  form.lines = []
  form.fees = []
  selectedPis.value = []
  editId.value = null
  formRef.value?.clearValidate?.()
}

function switchToManage() {
  if (pageMode.value === 'manage') return
  pageMode.value = 'manage'
  loadList()
}

async function switchToCreate() {
  if (pageMode.value === 'create') return
  const preserveDraft =
    createPanelInitialized.value &&
    pageMode.value !== 'edit'

  pageMode.value = 'create'
  editId.value = null
  activeTab.value = 'header'

  if (!preserveDraft) {
    resetFormData()
    await Promise.all([loadSuppliers(), loadCurrencies(), loadMaterials(), loadFees()])
    await chooseNumberType('ZY')
  } else if (!createPanelInitialized.value) {
    await Promise.all([loadSuppliers(), loadCurrencies(), loadMaterials(), loadFees()])
  }
  createPanelInitialized.value = true
}

async function onFormReset() {
  if (pageMode.value === 'create') {
    resetFormData()
    activeTab.value = 'header'
    await Promise.all([loadSuppliers(), loadCurrencies(), loadMaterials(), loadFees(), chooseNumberType('ZY')])
    return
  }
  if (pageMode.value === 'edit' && editId.value) {
    detailLoading.value = true
    try {
      const data = await fetchDetail(editId.value)
      hydrateForm(data)
      activeTab.value = 'header'
    } catch (err) {
      ElMessage.error(err?.response?.data?.msg || err.message || '重置失败')
    } finally {
      detailLoading.value = false
    }
  }
}

async function openEdit(row) {
  if (row.pass === '1') return
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.warning('采购单参数无效')
    return
  }
  editId.value = id
  activeTab.value = 'header'
  pageMode.value = 'edit'
  createPanelInitialized.value = true
  detailLoading.value = true
  try {
    await loadLookups()
    const data = await fetchDetail(id)
    hydrateForm(data)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '读取采购单详情失败')
    pageMode.value = 'manage'
    editId.value = null
  } finally {
    detailLoading.value = false
  }
}
async function loadLookups() {
  await Promise.all([loadSuppliers(), loadCurrencies(), loadMaterials(), loadFees()])
}
async function fetchDetail(id) {
  const { data } = await axios.get(`/api/buy-order/${id}`)
  if (data.code !== 200) throw new Error(data.msg)
  return data.data
}
function hydrateForm(data) {
  const h1 = data.header || {}
  Object.assign(form.header, {
    numberType: String(h1.kcaj01 || '').startsWith('PO-') ? 'PO' : String(h1.kcaj01 || '').startsWith('ZY-') ? 'ZY' : currentYear,
    buyOrderNo: h1.kcaj01,
    buyDate: fmtDate(h1.kcaj02),
    buyType: String(h1.kcaj03 ?? '1'),
    referenceNo: h1.kcaj04 || '',
    supplierCode: h1.kcaj05 || '',
    taxIncluded: String(h1.kcaj06 || '1'),
    currencyCode: h1.kcaj07 || '',
    loadingPort: h1.kcaj08 || '',
    dischargePort: h1.kcaj09 || '',
    paymentTerms: h1.kcaj10 || '',
    remark: h1.remark || '',
    decimalPlaces: Number(h1.decimal ?? 4),
  })
  selectedPis.value = String(form.header.referenceNo || '').split(',').filter(Boolean)
  const refPi = String(form.header.referenceNo || '').split(',')[0].trim()
  if (refPi) {
    resolveOrderIdByPi(refPi).then((id) => {
      if (id) form.header.referenceOrderId = id
    })
  }
  form.lines = (data.lines || []).map((l, i) => ({
    ...Object.fromEntries(Array.from({ length: 35 }, (_, idx) => {
      const col = `kcaa${String(idx + 1).padStart(2, '0')}`
      return [col, l[col]]
    })),
    seq: l.seq || i + 1,
    bomSystemCode: l.kcak02 || l.systemcode,
    kcaa01: l.kcaa01,
    kcaa02: l.kcaa02,
    kcaa03: l.kcaa03,
    kcaa04: l.kcaa04,
    quantity: Number(l.kcak03 || 0),
    taxExcludedPrice: Number(l.kcak04 || 0),
    taxIncludedPrice: Number(l.kcak041 || 0),
    taxExcludedAmount: Number(l.kcak05 || 0),
    taxIncludedAmount: Number(l.kcak051 || 0),
    tax: Number(l.tax || 0),
    deliveryDate: fmtDate(l.delivery_date),
    info: l.info || '',
    referenceNo: l.Reference || l.referenceNo || refPi,
    topKcaa01: l.kcak06 || '',
    gkcaa02: l.gkcaa02 || '',
    _lineMarked: false,
    kcaa02_en: l.kcaa02_en || '',
    kcaa02En: l.kcaa02_en || '',
    location: l.location || '',
    sale_price: l.sale_price,
    salePrice: l.sale_price,
    cost_price: l.cost_price,
    costPrice: l.cost_price,
    Customer_Name: l.Customer_Name,
    Customer_supply: l.Customer_supply,
    remark: l.remark,
    kpname: l.kpname,
    content: l.content,
  }))
  form.fees = (data.fees || []).map((f, i) => ({ seq: f.kid || i + 1, feeCode: f.kcaa01, feeName: f.kcaa02, spec: f.kcaa03, money: Number(f.money || 0), tax: Number(f.tax || 0), remark: f.remark || '' }))
}
function addMaterial() {
  const m = materials.value.find((x) => String(x.systemcode || x.GUID || x.kcaa01) === String(materialPicked.value))
  if (!m) return
  const refPi = String(form.header.referenceNo || '').split(',')[0].trim()
  form.lines.push({
    seq: form.lines.length + 1,
    bomSystemCode: m.systemcode || m.GUID,
    systemcode: m.systemcode || m.GUID,
    kcaa01: m.kcaa01,
    kcaa02: m.kcaa02,
    kcaa03: m.kcaa03,
    kcaa04: m.kcaa04,
    kcaa11: m.kcaa11 || '',
    kcaa25: m.kcaa25 || '',
    gkcaa02: m.gkcaa02 || '',
    topKcaa01: m.topKcaa01 || '',
    referenceNo: refPi,
    quantity: 1,
    taxIncludedPrice: 0,
    taxExcludedPrice: 0,
    taxIncludedAmount: 0,
    taxExcludedAmount: 0,
    tax: form.header.taxIncluded === '2' ? 0 : 0.13,
    deliveryDate: '',
    info: '',
    _lineMarked: false,
  })
  materialPicked.value = ''
}
function renumberBuyLines() {
  form.lines.forEach((line, index) => {
    line.seq = index + 1
  })
}
function toggleLineMark(row) {
  row._lineMarked = !row._lineMarked
}
function buyLineRowClassName({ row }) {
  return row?._lineMarked ? 'buy-line-row--marked' : ''
}
function linePoPiText(row) {
  const pi = String(row?.referenceNo || form.header.referenceNo || '').split(',')[0].trim()
  const po = String(form.header.referencePoNo || '').trim()
  if (po && pi) return `${po} / ${pi}`
  return pi || po || '-'
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
async function openLinePiBom(row) {
  const product = String(row?.topKcaa01 || row?.kcaa01 || '').trim()
  if (!product) {
    ElMessage.warning('当前明细缺少款号/编码，无法查看原资料')
    return
  }
  const refNo = String(row?.referenceNo || form.header.referenceNo || '').split(',')[0].trim()
  if (!refNo && String(form.header.buyType ?? '') === '1') {
    ElMessage.warning('请先填写关联 PI 号')
    return
  }
  let orderId = Number(form.header.referenceOrderId ?? 0)
  if (!Number.isFinite(orderId) || orderId <= 0) {
    orderId = await resolveOrderIdByPi(refNo)
    if (orderId) form.header.referenceOrderId = orderId
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
async function deleteSelectedBuyLines() {
  const marked = form.lines.filter((line) => line._lineMarked)
  if (!marked.length) {
    ElMessage.warning('请先在「选择」列点击删除标记要移除的行')
    return
  }
  try {
    await ElMessageBox.confirm(`确认删除已标记的 ${marked.length} 条明细吗？此操作只影响当前页面，点击保存后才会落库。`, '删除选定明细', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  const removeSet = new Set(marked)
  form.lines = form.lines.filter((line) => !removeSet.has(line))
  renumberBuyLines()
  ElMessage.success('已删除选定明细')
}
async function deleteAllBuyLines() {
  if (!form.lines.length) {
    ElMessage.warning('当前没有采购明细')
    return
  }
  try {
    await ElMessageBox.confirm('确认删除全部采购明细吗？此操作只影响当前页面，点击保存后才会落库。', '删除全部明细', {
      type: 'warning',
      confirmButtonText: '删除全部',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  form.lines = []
  ElMessage.success('已清空全部明细')
}
function buildBatchCurrentLines() {
  return form.lines.map((line) => ({
    piNo: form.header.referenceNo,
    kcaa01: line.kcaa01,
    quantity: line.quantity,
  }))
}
function applyBatchAddLines(lines) {
  const list = Array.isArray(lines) ? lines : []
  if (!list.length) return
  const refPi = String(form.header.referenceNo || '').split(',')[0].trim()
  const newLines = list.map((row, index) => {
    const qty = Number(row.quantity ?? row.availableQty ?? 0)
    const line = {
      ...row,
      seq: form.lines.length + index + 1,
      bomSystemCode: row.bomSystemCode || row.systemcode || row.GUID,
      systemcode: row.systemcode || row.bomSystemCode || row.GUID,
      gkcaa02: row.gkcaa02 || '',
      kcaa11: row.kcaa11 || '',
      kcaa25: row.kcaa25 || row.purchaseUnit || '',
      topKcaa01: row.topKcaa01 || '',
      referenceNo: row.referenceNo || refPi,
      quantity: qty,
      taxIncludedPrice: hasPrice.value ? Number(row.taxIncludedPrice ?? row.kcak041 ?? 0) : 0,
      taxExcludedPrice: hasPrice.value ? Number(row.taxExcludedPrice ?? row.kcak04 ?? 0) : 0,
      taxIncludedAmount: hasPrice.value ? Number(row.taxIncludedAmount ?? row.kcak051 ?? 0) : 0,
      taxExcludedAmount: hasPrice.value ? Number(row.taxExcludedAmount ?? row.kcak05 ?? 0) : 0,
      tax: form.header.taxIncluded === '2' ? 0 : Number(row.tax ?? 0),
      deliveryDate: row.deliveryDate || '',
      info: row.info || '',
      _lineMarked: false,
    }
    recalcLine(line)
    return line
  })
  form.lines.push(...newLines)
  renumberBuyLines()
  ElMessage.success(`已批量添加 ${newLines.length} 条采购明细`)
}
function openBuyBatchAdd() {
  if (String(form.header.buyType ?? '') !== '1') {
    ElMessage.warning('当前只有订单采购支持按 PI 批量添加明细')
    return
  }
  const piNo = String(form.header.referenceNo ?? '').trim()
  if (!piNo) {
    ElMessage.warning('订单采购须先填写或选择 PI 号')
    return
  }
  if (piNo.includes(',')) {
    ElMessage.warning('订单采购批量添加一次只能使用一个 PI 号')
    return
  }
  const supplierCode = String(form.header.supplierCode ?? '').trim()
  if (!supplierCode) {
    ElMessage.warning('请先选择供应商，才能批量添加并自动带出单价')
    return
  }
  const sessionId = buildBuyBatchSessionId()
  activeBatchSessionId.value = sessionId
  writeBuyBatchContext(sessionId, {
    piNo,
    supplierCode,
    hasPrice: hasPrice.value,
    decimalPlaces: form.header.decimalPlaces,
    currentLines: buildBatchCurrentLines(),
  })
  const url = `/supply-chain/daily/purchase-order-batch-window?sessionId=${encodeURIComponent(sessionId)}&piNo=${encodeURIComponent(piNo)}`
  const opened = window.open(url, '_blank')
  if (!opened) {
    ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
  }
}
function replyBuyBatch(source, payload) {
  if (!source || typeof source.postMessage !== 'function') return
  source.postMessage(payload, window.location.origin)
}
function handleBuyBatchPayload(payload, source = null) {
  const sessionId = String(payload?.sessionId ?? '').trim()
  if (!sessionId || sessionId !== activeBatchSessionId.value) return
  const validation = validateBuyBatchApply({
    openedPiNo: payload.openedPiNo,
    currentPiNo: form.header.referenceNo,
    openedSupplierCode: payload.openedSupplierCode,
    currentSupplierCode: form.header.supplierCode,
  })
  if (!validation.ok) {
    if (validation.reason === BUY_BATCH_REJECT_PI_MISMATCH) ElMessage.warning('关联 PI 已变更，批量添加已取消')
    else if (validation.reason === BUY_BATCH_REJECT_SUPPLIER_MISMATCH) ElMessage.warning('供应商已变更，请重新打开批量添加')
    replyBuyBatch(source, { type: BUY_BATCH_MSG_REJECTED, sessionId, reason: validation.reason })
    activeBatchSessionId.value = ''
    return
  }
  const lines = Array.isArray(payload.lines) ? payload.lines : []
  if (!lines.length) {
    replyBuyBatch(source, { type: BUY_BATCH_MSG_REJECTED, sessionId, reason: 'empty-lines' })
    return
  }
  applyBatchAddLines(lines)
  replyBuyBatch(source, { type: BUY_BATCH_MSG_ACCEPTED, sessionId, lineCount: lines.length })
  activeBatchSessionId.value = ''
}
function handleBuyBatchMessage(event) {
  if (event.origin !== window.location.origin) return
  const data = event.data
  if (!data || data.type !== BUY_BATCH_MSG_APPLY) return
  handleBuyBatchPayload(data, event.source)
}
function handleBuyBatchStorageEvent(event) {
  const key = String(event?.key ?? '')
  if (!key.startsWith(BUY_BATCH_RESULT_PREFIX)) return
  const sessionId = key.slice(BUY_BATCH_RESULT_PREFIX.length)
  if (sessionId !== activeBatchSessionId.value) return
  const payload = parseBuyBatchResultPayload(event?.newValue)
  if (!payload?.lines?.length) return
  handleBuyBatchPayload(payload, null)
}
function addFee() {
  const f = feeOptions.value.find((x) => x.feeCode === feePicked.value)
  if (!f) return
  form.fees.push({ seq: form.fees.length + 1, feeCode: f.feeCode, feeName: f.feeName, spec: f.spec, money: 0, tax: 0, remark: '' })
  feePicked.value = ''
}
function recalcLine(row) {
  const qty = Number(row.quantity || 0)
  const price = Number(row.taxIncludedPrice || 0)
  const tax = form.header.taxIncluded === '2' ? 0 : Number(row.tax || 0)
  row.tax = tax
  row.taxExcludedPrice = Number((price / (1 + tax)).toFixed(form.header.decimalPlaces || 4))
  if (form.header.taxIncluded === '2') row.taxExcludedPrice = price
  row.taxExcludedAmount = Number((qty * row.taxExcludedPrice).toFixed(2))
  row.taxIncludedAmount = Number((qty * price).toFixed(2))
}
function recalcAll() {
  form.lines.forEach(recalcLine)
}
async function saveOrder() {
  await formRef.value?.validate()
  if (!form.lines.length) return ElMessage.warning('请至少添加一条采购明细')
  if (form.lines.some((x) => !(Number(x.quantity) > 0))) return ElMessage.warning('采购明细数量必须大于0')
  saving.value = true
  try {
    recalcAll()
    const body = {
      header: form.header,
      lines: form.lines.map(({ _lineMarked, ...line }) => line),
      fees: form.fees,
    }
    const res = pageMode.value === 'create' ? await axios.post('/api/buy-order', body) : await axios.put(`/api/buy-order/${editId.value}`, body)
    if (res.data.code !== 200) throw new Error(res.data.msg)
    ElMessage.success(res.data.msg || '保存成功')
    pageMode.value = 'manage'
    loadList()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '保存失败')
  } finally {
    saving.value = false
  }
}
async function openDetail(row) {
  detail.value = await fetchDetail(row.id)
  detailVisible.value = true
}
async function openPrint(row) {
  const { data } = await axios.get('/api/buy-order/print-data', { params: { ids: row.id } })
  printData.value = data.data
  printVisible.value = true
}
function windowPrint() {
  window.print()
}
async function askUnaudit(row) {
  const { value } = await ElMessageBox.prompt(`请输入采购单【${row.buyOrderNo}】反审原因`, '反审原因', { inputType: 'textarea', inputValidator: (v) => !!String(v || '').trim(), inputErrorMessage: '反审原因必填' })
  await lifecycle(row, 'unaudit', value)
}
async function lifecycle(row, action, reason = '') {
  const map = { audit: 'audit', unaudit: 'unaudit', restore: 'restore', hard: 'hard' }
  try {
    if (action === 'delete') await axios.delete(`/api/buy-order/${row.id}`)
    else if (action === 'hard') await axios.delete(`/api/buy-order/${row.id}/hard`)
    else await axios.post(`/api/buy-order/${row.id}/${map[action]}`, { reason })
    ElMessage.success('操作成功')
    loadList()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '操作失败')
  }
}

onMounted(async () => {
  window.addEventListener('message', handleBuyBatchMessage)
  window.addEventListener('storage', handleBuyBatchStorageEvent)
  await loadList()
})

onUnmounted(() => {
  window.removeEventListener('message', handleBuyBatchMessage)
  window.removeEventListener('storage', handleBuyBatchStorageEvent)
})
</script>

<style scoped>
.buy-order-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* DIY：第一行供应商下拉宽度（与入库单「供应商/外协商」一致，固定不随点击撑开） */
  --buy-filter-supplier-width: 240px;
  /* DIY：第一行采购类型下拉宽度（与入库单「入库类型」一致） */
  --buy-filter-type-width: 160px;
  /* DIY：第二行查询内容输入框宽度（与入库单关键词框一致） */
  --buy-filter-keyword-width: 420px;
  /* DIY：筛选标签与控件间距 */
  --buy-filter-label-gap: 8px;
  /* DIY：开关组竖线左右间隔 */
  --buy-filter-switch-gap: 20px;
}

/* DIY：表单模式预留 ERP 顶栏高度，改 --buy-page-chrome */
.buy-order-page--form {
  --buy-page-chrome: 200px;
  height: calc(100vh - var(--buy-page-chrome));
  overflow: hidden;
  gap: 8px;
}

.buy-order-page--form .buy-mode-bar {
  flex-shrink: 0;
  margin-bottom: 0;
}

.buy-mode-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.buy-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
}

.buy-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.buy-create-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.buy-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  min-height: 42px;
  padding: 0 2px;
}

.buy-form-head strong {
  font-size: 16px;
  color: var(--el-text-color-primary);
}

.buy-form-head__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.buy-create-panel :deep(.buy-edit-form) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.buy-create-panel :deep(.buy-edit-tabs) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.buy-create-panel :deep(.buy-edit-tabs > .el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.buy-table {
  width: 100%;
}

.line-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.line-toolbar .el-select { width: 420px; }
.buy-basic-layout {
  --buy-basic-button-width: 106px;
  --buy-basic-label-width: 86px;
  --buy-basic-input-height: 40px;
  --buy-basic-control-font-size: 16px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1260px;
  padding: 10px 0 18px;
}
.buy-basic-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 24px 40px;
  width: 100%;
}
.buy-basic-row--full,
.buy-basic-row--reference {
  flex-wrap: nowrap;
}
.buy-basic-field {
  display: inline-flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.buy-basic-field--decimal {
  margin-left: 24px;
}
.buy-basic-field--wide,
.buy-basic-field--full,
.buy-basic-field--supplier {
  width: 100%;
}
.buy-basic-label {
  flex: 0 0 var(--buy-basic-label-width);
  min-height: var(--buy-basic-input-height);
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 14px;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}
.buy-basic-label--required {
  color: #e60000;
}
.buy-basic-field :deep(.el-form-item) {
  margin-bottom: 0;
}
.buy-basic-field :deep(.el-form-item__content) {
  margin-left: 0 !important;
  line-height: var(--buy-basic-input-height);
}
.buy-basic-field :deep(.el-input__wrapper),
.buy-basic-field :deep(.el-select__wrapper),
.buy-basic-field :deep(.el-input-number .el-input__wrapper) {
  min-height: var(--buy-basic-input-height);
}
.buy-basic-field :deep(.el-input__inner),
.buy-basic-field :deep(.el-select__placeholder),
.buy-basic-field :deep(.el-input-number .el-input__inner) {
  font-size: var(--buy-basic-control-font-size);
}
.buy-basic-input {
  width: 220px;
}
.buy-basic-input--doc {
  width: 208px;
}
.buy-basic-input--reference {
  width: 440px;
}
.buy-basic-input--supplier {
  width: 528px;
}
.buy-basic-input--port {
  width: 208px;
}
.buy-basic-input--currency {
  width: 220px;
}
.buy-basic-input--decimal {
  width: 72px;
}
.buy-basic-input--full {
  width: min(1000px, calc(100vw - 360px));
}
.buy-basic-buttons,
.buy-reference-picker,
.buy-decimal-field {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.buy-basic-buttons :deep(.el-button),
.buy-reference-picker :deep(.el-button) {
  width: var(--buy-basic-button-width);
  min-width: var(--buy-basic-button-width);
  height: var(--buy-basic-input-height);
  margin-left: 0;
  padding-left: 0;
  padding-right: 0;
  font-size: var(--buy-basic-control-font-size);
}
.buy-reference-picker {
  gap: 10px;
}
.buy-pi-toolbar {
  --buy-pi-control-height: 38px;
  --buy-pi-control-font-size: 15px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.buy-pi-toolbar :deep(.el-input) {
  width: 360px;
}
.buy-pi-toolbar :deep(.el-input__wrapper) {
  min-height: var(--buy-pi-control-height);
}
.buy-pi-toolbar :deep(.el-input__inner) {
  font-size: var(--buy-pi-control-font-size);
}
.buy-pi-toolbar :deep(.el-button) {
  height: var(--buy-pi-control-height);
  padding-left: 18px;
  padding-right: 18px;
  font-size: var(--buy-pi-control-font-size);
}
.buy-pi-select-button {
  min-width: 74px;
}
.buy-pi-pagination {
  margin-top: 12px;
  justify-content: flex-start;
}
.buy-filter-bar {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  margin-bottom: 12px;
}
.buy-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
}
.buy-filter-field {
  display: inline-flex;
  align-items: center;
  gap: var(--buy-filter-label-gap, 8px);
  flex-shrink: 0;
}
.buy-filter-label {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
/* 固定宽度：对齐入库单筛选区，聚焦/下拉时不撑开 */
.buy-filter-supplier {
  flex: 0 0 var(--buy-filter-supplier-width, 240px);
  width: var(--buy-filter-supplier-width, 240px);
  min-width: var(--buy-filter-supplier-width, 240px);
  max-width: var(--buy-filter-supplier-width, 240px);
}
.buy-filter-type {
  flex: 0 0 var(--buy-filter-type-width, 160px);
  width: var(--buy-filter-type-width, 160px);
  min-width: var(--buy-filter-type-width, 160px);
  max-width: var(--buy-filter-type-width, 160px);
}
.buy-filter-keyword {
  flex: 0 0 var(--buy-filter-keyword-width, 420px);
  width: var(--buy-filter-keyword-width, 420px);
  min-width: var(--buy-filter-keyword-width, 420px);
  max-width: var(--buy-filter-keyword-width, 420px);
}
.buy-filter-supplier :deep(.el-select__wrapper),
.buy-filter-type :deep(.el-select__wrapper) {
  width: 100%;
}
.buy-filter-divider {
  width: 1px;
  height: 22px;
  margin: 0 var(--buy-filter-switch-gap, 20px);
  background: var(--el-border-color);
  flex-shrink: 0;
}
.buy-filter-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.buy-alert {
  margin-bottom: 12px;
}
.buy-status-cell {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.buy-order-data {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.5;
  font-size: 13px;
}
.buy-order-data__line {
  white-space: normal;
  word-break: break-all;
}
.buy-order-data__inc {
  color: #7e57c2;
}
.buy-order-data__ex {
  color: #f56c6c;
}
.buy-order-data__pending--warn {
  color: #f56c6c;
}
.buy-order-data__pending--ok {
  color: #409eff;
}

/* DIY：采购明细表标记/分层列/无加减输入框 purchase-order/index.vue */
.buy-line-mark-btn {
  background-color: #ff7800;
  border-color: #ff7800;
  color: #fff;
}
.buy-line-mark-btn:hover {
  background-color: #e56e00;
  border-color: #e56e00;
  color: #fff;
}
.buy-line-mark-btn--on {
  background-color: #ccc !important;
  border-color: #ccc !important;
  color: #333 !important;
}
.buy-line-mark-btn--on:hover {
  background-color: #bbb !important;
  border-color: #bbb !important;
  color: #333 !important;
}
:deep(.buy-line-row--marked) {
  --el-table-tr-bg-color: #f5f5f5;
}
.buy-line-name-cell__primary {
  line-height: 1.35;
  color: #303133;
}
.buy-line-name-cell__divider {
  height: 1px;
  margin: 4px 0;
  background: #dcdfe6;
}
.buy-line-name-cell__secondary {
  line-height: 1.35;
  color: #909399;
  font-size: 12px;
}
.buy-line-input-num {
  width: 100%;
}
.buy-line-input-num :deep(.el-input__inner) {
  text-align: left;
}

.detail-title { font-weight: 700; margin-bottom: 10px; }
.detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
.plain-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
.plain-table th, .plain-table td { border: 1px solid #dcdfe6; padding: 6px 8px; text-align: left; }
.print-page h2 { text-align: center; margin: 0 0 16px; }
@media (max-width: 1200px) {
  .buy-filter-field {
    width: 100%;
    flex-shrink: 1;
  }
  .buy-filter-supplier,
  .buy-filter-type,
  .buy-filter-keyword {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    max-width: none;
  }
  .buy-filter-divider {
    display: none;
  }
  .buy-basic-row,
  .buy-basic-row--full,
  .buy-basic-row--reference {
    flex-direction: column;
    flex-wrap: nowrap;
    gap: 14px;
  }
  .buy-basic-field,
  .buy-basic-field--wide,
  .buy-basic-field--full,
  .buy-basic-field--supplier,
  .buy-basic-field--decimal {
    width: 100%;
    margin-left: 0;
  }
  .buy-basic-label {
    justify-content: flex-start;
  }
  .buy-basic-input,
  .buy-basic-input--doc,
  .buy-basic-input--reference,
  .buy-basic-input--supplier,
  .buy-basic-input--port,
  .buy-basic-input--currency,
  .buy-basic-input--full {
    width: min(100%, 520px);
  }
  .buy-reference-picker {
    flex-wrap: wrap;
  }
}
@media print {
  :global(body *) { visibility: hidden; }
  :global(.print-dialog), :global(.print-dialog *) { visibility: visible; }
  :global(.print-dialog) { position: absolute; inset: 0; }
}
</style>
