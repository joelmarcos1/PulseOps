const { Pool } = require('pg');

function createDatabasePool(databaseUrl) {
  return new Pool({ connectionString: databaseUrl });
}

module.exports = createDatabasePool;

