CREATE TABLE sync_execution (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_identifier uuid NOT NULL,
  target_identifier uuid NOT NULL,
  requester_identifier varchar(200) NOT NULL,
  action varchar(100) NOT NULL,
  input jsonb NOT NULL CHECK (octet_length(input::text) <= 1048576),
  status varchar(20) NOT NULL DEFAULT 'waiting-owner'
    CHECK (status IN ('waiting-owner', 'executing', 'completed', 'failed', 'recovery-required')),
  executor_identifier uuid,
  lease_identifier uuid,
  fencing_token integer NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  lease_expires_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  observation_reference varchar(200),
  error_message text CHECK (length(error_message) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((executor_identifier IS NULL AND lease_identifier IS NULL AND fencing_token = 0)
    OR (executor_identifier IS NOT NULL AND lease_identifier IS NOT NULL AND fencing_token > 0)),
  CHECK (lease_expires_at IS NULL OR lease_identifier IS NOT NULL),
  CHECK ((status IN ('failed', 'recovery-required') AND error_message IS NOT NULL)
    OR (status NOT IN ('failed', 'recovery-required') AND error_message IS NULL)),
  CHECK (status NOT IN ('completed', 'failed') OR lease_expires_at IS NULL)
);

CREATE FUNCTION set_sync_execution_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_execution_updated_at
BEFORE UPDATE ON sync_execution
FOR EACH ROW EXECUTE FUNCTION set_sync_execution_updated_at();

ALTER TABLE sync_execution REPLICA IDENTITY FULL;

CREATE INDEX idx_sync_execution_workspace_identifier_next_check_at_id
ON sync_execution (workspace_identifier, next_check_at, id)
WHERE deleted_at IS NULL AND status IN ('waiting-owner', 'executing', 'recovery-required');

CREATE INDEX idx_sync_execution_workspace_identifier_created_at_id
ON sync_execution (workspace_identifier, created_at DESC, id DESC)
WHERE deleted_at IS NULL;

COMMENT ON TABLE sync_execution IS 'Accepted application intent and fenced owner execution observations [domain:collaboration],[team:cueloop],[project:cueloop],[service:sync]';
COMMENT ON COLUMN sync_execution.id IS 'Immutable UUID v7 operation identity shared with its acceptance receipt';
COMMENT ON COLUMN sync_execution.workspace_identifier IS 'Application workspace authorized at request acceptance and owner recovery';
COMMENT ON COLUMN sync_execution.target_identifier IS 'Immutable application target identity resolved by the owner integration';
COMMENT ON COLUMN sync_execution.requester_identifier IS 'Verified application actor that submitted the accepted intent';
COMMENT ON COLUMN sync_execution.action IS 'Registered application action interpreted by the execution integration';
COMMENT ON COLUMN sync_execution.input IS 'Immutable bounded application input committed with the acceptance receipt';
COMMENT ON COLUMN sync_execution.status IS 'Execution observation kept separate from immutable request acceptance';
COMMENT ON COLUMN sync_execution.executor_identifier IS 'Stable provider recovery domain pinned by the first owner claim';
COMMENT ON COLUMN sync_execution.lease_identifier IS 'Most recent claim identity retained for idempotent report retries';
COMMENT ON COLUMN sync_execution.fencing_token IS 'Monotonically increasing claim generation used to reject stale reports';
COMMENT ON COLUMN sync_execution.lease_expires_at IS 'Authority-clock expiry of the active claim, null after a report';
COMMENT ON COLUMN sync_execution.next_check_at IS 'Earliest authority time when an unfinished intent can be inspected again';
COMMENT ON COLUMN sync_execution.observation_reference IS 'Bounded provider request or conversation reference reported by its owner';
COMMENT ON COLUMN sync_execution.error_message IS 'Explicit bounded execution failure or recovery diagnostic';
COMMENT ON COLUMN sync_execution.created_at IS 'UTC time when application intent was accepted';
COMMENT ON COLUMN sync_execution.updated_at IS 'UTC time maintained by the execution metadata trigger';
COMMENT ON COLUMN sync_execution.deleted_at IS 'Nullable UTC soft-deletion time';
