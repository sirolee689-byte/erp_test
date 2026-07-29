import { getSystemDataRelationCatalog } from './systemDataRelationCatalog.js'

export function registerSystemDataRelationRoutes(app) {
  app.get('/api/system/kernel/data-relations', (_req, res) => {
    res.json({
      code: 200,
      msg: 'success',
      data: getSystemDataRelationCatalog(),
    })
  })
}

