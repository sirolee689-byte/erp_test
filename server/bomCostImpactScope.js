import { sql } from './db.js'
import { BOM_COST_FROM, INV_BOM_MASTER_FROM } from './bomTables.js'

/**
 * Saving BOM parts only makes the current BOM uncomputed.
 * It does not unaudit the BOM and does not recursively touch parent BOMs.
 *
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} executor
 * @param {string} systemcode Current BOM systemcode.
 * @returns {Promise<{ affected: number, unaudited: number, deleted: number }>}
 */
export async function markCurrentBomCostStale(executor, systemcode) {
  const sc = String(systemcode ?? '').trim()
  if (!sc) return { affected: 0, unaudited: 0, deleted: 0 }

  const rs = await new sql.Request(executor)
    .input('sc', sql.NVarChar(100), sc)
    .query(`
      DECLARE @affected TABLE (
        systemcode nvarchar(100) NOT NULL PRIMARY KEY,
        kcaa01 nvarchar(300) NULL
      );

      INSERT INTO @affected (systemcode, kcaa01)
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) = @sc
        AND (
          b.del IS NULL
          OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) IN (N'', N'0')
        );

      DECLARE @affectedCount int;
      DECLARE @deletedCount int;

      SELECT @affectedCount = COUNT(1) FROM @affected;

      DELETE c
      FROM ${BOM_COST_FROM} AS c
      INNER JOIN @affected AS a
        ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.sid, N'')))) = a.systemcode
       AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.pq, N'')))) = a.kcaa01;

      SET @deletedCount = @@ROWCOUNT;

      SELECT
        @affectedCount AS affected,
        0 AS unaudited,
        @deletedCount AS deleted;
    `)

  const row = rs.recordset?.[0] ?? {}
  return {
    affected: Number(row.affected ?? 0),
    unaudited: Number(row.unaudited ?? 0),
    deleted: Number(row.deleted ?? 0),
  }
}
