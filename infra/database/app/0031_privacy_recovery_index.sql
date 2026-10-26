-- Keep already-applied 0030 history intact. Recovery health requires a complete leading FK index.
DROP INDEX privacy.request_work_recovery_idx;
CREATE INDEX request_work_recovery_idx ON privacy.request_work(recovery_run_id,request_id);
