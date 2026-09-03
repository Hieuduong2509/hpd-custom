-- +goose Up

-- 1. Alter rollup tables to add hdx_api_key column if they already exist
ALTER TABLE ${DATABASE}.otel_logs_kv_rollup_15m ADD COLUMN IF NOT EXISTS hdx_api_key String CODEC(ZSTD(1));
ALTER TABLE ${DATABASE}.otel_traces_kv_rollup_15m ADD COLUMN IF NOT EXISTS hdx_api_key String CODEC(ZSTD(1));

-- 2. Drop and recreate materialized views to populate hdx_api_key
DROP TABLE IF EXISTS ${DATABASE}.otel_logs_attr_kv_rollup_15m_mv;
CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.otel_logs_attr_kv_rollup_15m_mv TO ${DATABASE}.otel_logs_kv_rollup_15m
AS WITH elements AS (
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'SeverityText' as Key,
        CAST(SeverityText AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ServiceName' as Key,
        CAST(ServiceName AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ScopeName' as Key,
        CAST(ScopeName AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ScopeVersion' as Key,
        CAST(ScopeVersion AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ResourceSchemaUrl' as Key,
        CAST(ResourceSchemaUrl AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ScopeSchemaUrl' as Key,
        CAST(ScopeSchemaUrl AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.cluster.name' as Key,
        CAST(`__hdx_materialized_k8s.cluster.name` AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.container.name' as Key,
        CAST(`__hdx_materialized_k8s.container.name` AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.deployment.name' as Key,
        CAST(`__hdx_materialized_k8s.deployment.name` AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.namespace.name' as Key,
        CAST(`__hdx_materialized_k8s.namespace.name` AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.node.name' as Key,
        CAST(`__hdx_materialized_k8s.node.name` AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.pod.name' as Key,
        CAST(`__hdx_materialized_k8s.pod.name` AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.pod.uid' as Key,
        CAST(`__hdx_materialized_k8s.pod.uid` AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_deployment.environment.name' as Key,
        CAST(`__hdx_materialized_deployment.environment.name` AS String) as Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_logs
)
SELECT Timestamp, ColumnIdentifier, Key, Value, hdx_api_key, count() AS count FROM elements
GROUP BY Timestamp, ColumnIdentifier, Key, Value, hdx_api_key;

DROP TABLE IF EXISTS ${DATABASE}.otel_traces_kv_rollup_15m_mv;
CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.otel_traces_kv_rollup_15m_mv TO ${DATABASE}.otel_traces_kv_rollup_15m
AS WITH elements AS (
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ServiceName' AS Key,
        CAST(ServiceName AS String) AS Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'SpanName' AS Key,
        CAST(SpanName AS String) AS Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'SpanKind' AS Key,
        CAST(SpanKind AS String) AS Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'StatusCode' AS Key,
        CAST(StatusCode AS String) AS Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ScopeName' AS Key,
        CAST(ScopeName AS String) AS Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ScopeVersion' AS Key,
        CAST(ScopeVersion AS String) AS Value,
        ResourceAttributes['hdx.api_key'] as hdx_api_key
    FROM ${DATABASE}.otel_traces
)
SELECT Timestamp, ColumnIdentifier, Key, Value, hdx_api_key, count() AS count FROM elements
GROUP BY Timestamp, ColumnIdentifier, Key, Value, hdx_api_key;

-- 3. Row Policies for main tables

DROP ROW POLICY IF EXISTS otel_logs_tenant_policy ON ${DATABASE}.otel_logs;
CREATE ROW POLICY otel_logs_tenant_policy ON ${DATABASE}.otel_logs
    FOR SELECT
    USING (
        (getSettingOrDefault('custom_hdx_api_key', '') = '') OR 
        (has(splitByChar(',', getSettingOrDefault('custom_hdx_api_key', '')), ResourceAttributes['hdx.api_key']))
    ) AND (
        (getSettingOrDefault('custom_user_role', 'admin') = 'admin') OR 
        has(splitByChar(',', getSettingOrDefault('custom_allowed_services', '')), ServiceName)
    )
    TO ALL;

DROP ROW POLICY IF EXISTS otel_traces_tenant_policy ON ${DATABASE}.otel_traces;
CREATE ROW POLICY otel_traces_tenant_policy ON ${DATABASE}.otel_traces
    FOR SELECT
    USING (
        (getSettingOrDefault('custom_hdx_api_key', '') = '') OR 
        (has(splitByChar(',', getSettingOrDefault('custom_hdx_api_key', '')), ResourceAttributes['hdx.api_key']))
    ) AND (
        (getSettingOrDefault('custom_user_role', 'admin') = 'admin') OR 
        has(splitByChar(',', getSettingOrDefault('custom_allowed_services', '')), ServiceName)
    )
    TO ALL;

DROP ROW POLICY IF EXISTS hyperdx_sessions_tenant_policy ON ${DATABASE}.hyperdx_sessions;
CREATE ROW POLICY hyperdx_sessions_tenant_policy ON ${DATABASE}.hyperdx_sessions
    FOR SELECT
    USING (
        (getSettingOrDefault('custom_hdx_api_key', '') = '') OR 
        (has(splitByChar(',', getSettingOrDefault('custom_hdx_api_key', '')), ResourceAttributes['hdx.api_key']))
    ) AND (
        (getSettingOrDefault('custom_user_role', 'admin') = 'admin') OR 
        has(splitByChar(',', getSettingOrDefault('custom_allowed_services', '')), ServiceName)
    )
    TO ALL;

DROP ROW POLICY IF EXISTS otel_metrics_gauge_tenant_policy ON ${DATABASE}.otel_metrics_gauge;
CREATE ROW POLICY otel_metrics_gauge_tenant_policy ON ${DATABASE}.otel_metrics_gauge
    FOR SELECT
    USING (
        (getSettingOrDefault('custom_hdx_api_key', '') = '') OR 
        (has(splitByChar(',', getSettingOrDefault('custom_hdx_api_key', '')), ResourceAttributes['hdx.api_key']))
    ) AND (
        (getSettingOrDefault('custom_user_role', 'admin') = 'admin') OR 
        has(splitByChar(',', getSettingOrDefault('custom_allowed_services', '')), ServiceName)
    )
    TO ALL;

DROP ROW POLICY IF EXISTS otel_metrics_sum_tenant_policy ON ${DATABASE}.otel_metrics_sum;
CREATE ROW POLICY otel_metrics_sum_tenant_policy ON ${DATABASE}.otel_metrics_sum
    FOR SELECT
    USING (
        (getSettingOrDefault('custom_hdx_api_key', '') = '') OR 
        (has(splitByChar(',', getSettingOrDefault('custom_hdx_api_key', '')), ResourceAttributes['hdx.api_key']))
    ) AND (
        (getSettingOrDefault('custom_user_role', 'admin') = 'admin') OR 
        has(splitByChar(',', getSettingOrDefault('custom_allowed_services', '')), ServiceName)
    )
    TO ALL;

DROP ROW POLICY IF EXISTS otel_metrics_histogram_tenant_policy ON ${DATABASE}.otel_metrics_histogram;
CREATE ROW POLICY otel_metrics_histogram_tenant_policy ON ${DATABASE}.otel_metrics_histogram
    FOR SELECT
    USING (
        (getSettingOrDefault('custom_hdx_api_key', '') = '') OR 
        (has(splitByChar(',', getSettingOrDefault('custom_hdx_api_key', '')), ResourceAttributes['hdx.api_key']))
    ) AND (
        (getSettingOrDefault('custom_user_role', 'admin') = 'admin') OR 
        has(splitByChar(',', getSettingOrDefault('custom_allowed_services', '')), ServiceName)
    )
    TO ALL;

DROP ROW POLICY IF EXISTS otel_metrics_exponential_histogram_tenant_policy ON ${DATABASE}.otel_metrics_exponential_histogram;
CREATE ROW POLICY otel_metrics_exponential_histogram_tenant_policy ON ${DATABASE}.otel_metrics_exponential_histogram
    FOR SELECT
    USING (
        (getSettingOrDefault('custom_hdx_api_key', '') = '') OR 
        (has(splitByChar(',', getSettingOrDefault('custom_hdx_api_key', '')), ResourceAttributes['hdx.api_key']))
    ) AND (
        (getSettingOrDefault('custom_user_role', 'admin') = 'admin') OR 
        has(splitByChar(',', getSettingOrDefault('custom_allowed_services', '')), ServiceName)
    )
    TO ALL;

DROP ROW POLICY IF EXISTS otel_metrics_summary_tenant_policy ON ${DATABASE}.otel_metrics_summary;
CREATE ROW POLICY otel_metrics_summary_tenant_policy ON ${DATABASE}.otel_metrics_summary
    FOR SELECT
    USING (
        (getSettingOrDefault('custom_hdx_api_key', '') = '') OR 
        (has(splitByChar(',', getSettingOrDefault('custom_hdx_api_key', '')), ResourceAttributes['hdx.api_key']))
    ) AND (
        (getSettingOrDefault('custom_user_role', 'admin') = 'admin') OR 
        has(splitByChar(',', getSettingOrDefault('custom_allowed_services', '')), ServiceName)
    )
    TO ALL;

-- 4. Row Policies for rollup tables (only need API key filter)

DROP ROW POLICY IF EXISTS otel_logs_kv_rollup_tenant_policy ON ${DATABASE}.otel_logs_kv_rollup_15m;
CREATE ROW POLICY otel_logs_kv_rollup_tenant_policy ON ${DATABASE}.otel_logs_kv_rollup_15m
    FOR SELECT
    USING (
        (getSettingOrDefault('custom_hdx_api_key', '') = '') OR 
        (has(splitByChar(',', getSettingOrDefault('custom_hdx_api_key', '')), hdx_api_key))
    )
    TO ALL;

DROP ROW POLICY IF EXISTS otel_traces_kv_rollup_tenant_policy ON ${DATABASE}.otel_traces_kv_rollup_15m;
CREATE ROW POLICY otel_traces_kv_rollup_tenant_policy ON ${DATABASE}.otel_traces_kv_rollup_15m
    FOR SELECT
    USING (
        (getSettingOrDefault('custom_hdx_api_key', '') = '') OR 
        (has(splitByChar(',', getSettingOrDefault('custom_hdx_api_key', '')), hdx_api_key))
    )
    TO ALL;
