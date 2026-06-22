/**
 * 采购单模块读库用安全数值转换（SQL Server 2008 R2）。
 * 旧表部分数量/单价/税点字段物理类型为 nvarchar，裸 ISNULL(col, 0) 会触发 nvarchar→numeric 转换错误。
 */

export const BUY_KCAA_DECIMAL_FIELDS = new Set([
  'kcaa07',
  'kcaa08',
  'kcaa19',
  'kcaa22',
  'kcaa23',
  'kcaa24',
  'kcaa26',
  'kcaa30',
  'kcaa32',
  'kcaa33',
])

export function trimExpr(alias, col, size = 100) {
  return `LTRIM(RTRIM(CONVERT(nvarchar(${size}), ${alias}.[${col}])))`
}

export function likeTextExpr(alias, col, size = 500) {
  return `LTRIM(RTRIM(CONVERT(nvarchar(${size}), ${alias}.[${col}])))`
}

/** 任意物理类型列安全转 nvarchar 文本（先 CONVERT 再 ISNULL，避免 numeric 列 ISNULL(col,N'') 报错） */
export function nvarcharTextExpr(alias, col, size = 500) {
  return `LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(${size}), ${alias}.[${col}]), N'')))`
}

export function decimalLikeExpr(valueExpr) {
  return `${valueExpr} LIKE N'%[0-9]%'
    AND ${valueExpr} NOT LIKE N'%[^0-9.-]%'
    AND LEN(${valueExpr}) - LEN(REPLACE(${valueExpr}, N'.', N'')) <= 1
    AND LEN(${valueExpr}) - LEN(REPLACE(${valueExpr}, N'-', N'')) <= 1
    AND (CHARINDEX(N'-', ${valueExpr}) = 0 OR LEFT(${valueExpr}, 1) = N'-')`
}

/** 安全读取 decimal；非法或空值返回 fallback（默认 0） */
export function safeDecimalExpr(alias, col, fallback = 0) {
  const value = trimExpr(alias, col)
  return `CASE
    WHEN ${alias}.[${col}] IS NULL THEN ${fallback}
    WHEN ${value} = N'' THEN ${fallback}
    WHEN ${decimalLikeExpr(value)}
      THEN CONVERT(decimal(18, 6), ${value})
    ELSE ${fallback}
  END`
}

/** 安全读取 int；非法或空值返回 fallback */
export function safeIntExpr(alias, col, fallback = 2147483647) {
  const value = trimExpr(alias, col)
  return `CASE
    WHEN ${alias}.[${col}] IS NULL THEN ${fallback}
    WHEN ${value} = N'' THEN ${fallback}
    WHEN ${decimalLikeExpr(value)}
      THEN CONVERT(int, CONVERT(decimal(18, 0), ${value}))
    ELSE ${fallback}
  END`
}

export function flagIsOneExpr(alias, col, defaultValue) {
  return `CASE
    WHEN ${alias}.[${col}] IS NULL THEN N'${defaultValue}'
    WHEN LTRIM(RTRIM(CONVERT(nvarchar(20), ${alias}.[${col}]))) = N'' THEN N'${defaultValue}'
    ELSE LTRIM(RTRIM(CONVERT(nvarchar(20), ${alias}.[${col}])))
  END = N'1'`
}
