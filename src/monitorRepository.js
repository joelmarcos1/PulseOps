function mapMonitor(row) {
  const latestCheck = row.check_status === null
    ? null
    : {
        status: row.check_status,
        httpStatus: row.http_status,
        latencyMs: row.latency_ms,
        errorType: row.error_type,
        errorMessage: row.error_message,
        checkedAt: row.checked_at.toISOString(),
      };

  return {
    id: Number(row.id),
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
    latestCheck,
  };
}

function createMonitorRepository(pool) {
  return {
    async create({ name, url }) {
      const result = await pool.query(
        `INSERT INTO monitors (name, url)
         VALUES ($1, $2)
         RETURNING id, name, url, enabled, created_at`,
        [name, url],
      );

      return mapMonitor({ ...result.rows[0], check_status: null });
    },

    async list() {
      const result = await pool.query(
        `SELECT
           m.id,
           m.name,
           m.url,
           m.enabled,
           m.created_at,
           latest.status AS check_status,
           latest.http_status,
           latest.latency_ms,
           latest.error_type,
           latest.error_message,
           latest.checked_at
         FROM monitors AS m
         LEFT JOIN LATERAL (
           SELECT
             status,
             http_status,
             latency_ms,
             error_type,
             error_message,
             checked_at
           FROM check_results
           WHERE monitor_id = m.id
           ORDER BY checked_at DESC, id DESC
           LIMIT 1
         ) AS latest ON TRUE
         ORDER BY m.id`,
      );

      return result.rows.map(mapMonitor);
    },

    async listEnabled() {
      const result = await pool.query(
        `SELECT id, name, url
         FROM monitors
         WHERE enabled = TRUE
         ORDER BY id`,
      );

      return result.rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        url: row.url,
      }));
    },

    async saveCheckResult(monitorId, check) {
      await pool.query(
        `INSERT INTO check_results (
           monitor_id,
           status,
           http_status,
           latency_ms,
           error_type,
           error_message
         )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          monitorId,
          check.status,
          check.httpStatus,
          check.latencyMs,
          check.errorType,
          check.errorMessage,
        ],
      );
    },
  };
}

module.exports = createMonitorRepository;

