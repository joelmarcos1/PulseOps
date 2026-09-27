CREATE TABLE IF NOT EXISTS monitors (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    url VARCHAR(2048) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS check_results (
    id BIGSERIAL PRIMARY KEY,
    monitor_id BIGINT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    status VARCHAR(4) NOT NULL CHECK (status IN ('UP', 'DOWN')),
    http_status SMALLINT,
    latency_ms INTEGER,
    error_type VARCHAR(50),
    error_message TEXT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS check_results_monitor_checked_idx
    ON check_results (monitor_id, checked_at DESC);

