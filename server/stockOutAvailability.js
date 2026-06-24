function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function calcAvailableQty({ approvedInQty, approvedOutQty, pendingOutQty }) {
  return Math.max(0, num(approvedInQty) - num(approvedOutQty) - num(pendingOutQty))
}

export function stockDimensionExpr(alias = 'l') {
  return {
    materialCode: `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${alias}.[kcaa01], N''))))`,
    warehouseCode: `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N''))))`,
    color: `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${alias}.[kcaa11], N''))))`,
    version: `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${alias}.[version], N''))))`,
    location: `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${alias}.[location], N''))))`,
  }
}

export function buildStockOutAvailabilitySql({ excludeOutboundNo = '' } = {}) {
  const excludeSql = excludeOutboundNo
    ? `AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N'')))) <> @excludeOutboundNo`
    : ''
  return `
    SELECT
      base.[materialCode],
      base.[warehouseCode],
      base.[color],
      base.[version],
      base.[location],
      ISNULL(inAgg.[approvedInQty], 0) AS approvedInQty,
      ISNULL(outAgg.[approvedOutQty], 0) AS approvedOutQty,
      ISNULL(outAgg.[pendingOutQty], 0) AS pendingOutQty,
      CASE
        WHEN ISNULL(inAgg.[approvedInQty], 0) - ISNULL(outAgg.[approvedOutQty], 0) - ISNULL(outAgg.[pendingOutQty], 0) > 0
          THEN ISNULL(inAgg.[approvedInQty], 0) - ISNULL(outAgg.[approvedOutQty], 0) - ISNULL(outAgg.[pendingOutQty], 0)
        ELSE 0
      END AS availableQty
    FROM (
      SELECT DISTINCT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa11], N'')))) AS color,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[version], N'')))) AS version,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[location], N'')))) AS location
      FROM dbo.[UB_ERP_Stocks_Storage] AS h
      INNER JOIN dbo.[UB_ERP_Stocks_Storage_list] AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
    ) AS base
    LEFT JOIN (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa11], N'')))) AS color,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[version], N'')))) AS version,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[location], N'')))) AS location,
        SUM(ISNULL(l.[kcao03], 0)) AS approvedInQty
      FROM dbo.[UB_ERP_Stocks_Storage] AS h
      INNER JOIN dbo.[UB_ERP_Stocks_Storage_list] AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      GROUP BY
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa11], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[version], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[location], N''))))
    ) AS inAgg
      ON inAgg.[materialCode] = base.[materialCode]
      AND inAgg.[warehouseCode] = base.[warehouseCode]
      AND inAgg.[color] = base.[color]
      AND inAgg.[version] = base.[version]
      AND inAgg.[location] = base.[location]
    LEFT JOIN (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa11], N'')))) AS color,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[version], N'')))) AS version,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[location], N'')))) AS location,
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1' THEN ISNULL(l.[kcaq03], 0) ELSE 0 END) AS approvedOutQty,
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'0' THEN ISNULL(l.[kcaq03], 0) ELSE 0 END) AS pendingOutQty
      FROM dbo.[UB_ERP_Stocks_out] AS h
      INNER JOIN dbo.[UB_ERP_Stocks_out_list] AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N''))))
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        ${excludeSql}
      GROUP BY
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa11], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[version], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[location], N''))))
    ) AS outAgg
      ON outAgg.[materialCode] = base.[materialCode]
      AND outAgg.[warehouseCode] = base.[warehouseCode]
      AND outAgg.[color] = base.[color]
      AND outAgg.[version] = base.[version]
      AND outAgg.[location] = base.[location]
  `
}

