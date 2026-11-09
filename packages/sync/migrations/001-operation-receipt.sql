CREATE TABLE sync_operation_receipt (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  operation_identifier uuid NOT NULL,
  workspace_identifier uuid NOT NULL,
  actor_identifier varchar(200) NOT NULL,
  operation_name varchar(100) NOT NULL,
  operation_version integer NOT NULL CHECK (operation_version > 0),
  fingerprint varchar(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  request_created_at timestamptz NOT NULL,
  request_expires_at timestamptz NOT NULL,
  status varchar(8) NOT NULL CHECK (status IN ('accepted', 'rejected')),
  accepted_at timestamptz,
  rejected_at timestamptz,
  result_retained_until timestamptz NOT NULL,
  result jsonb,
  rejection_code varchar(100),
  rejection_message text CHECK (length(rejection_message) <= 1000),
  compacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT sync_operation_receipt_operation_identifier_key UNIQUE (operation_identifier),
  CHECK (request_expires_at > request_created_at),
  CHECK (result_retained_until > coalesce(accepted_at, rejected_at)),
  CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL AND rejected_at IS NULL
      AND rejection_code IS NULL AND rejection_message IS NULL
      AND (compacted_at IS NOT NULL OR result IS NOT NULL))
    OR
    (status = 'rejected' AND accepted_at IS NULL AND rejected_at IS NOT NULL
      AND result IS NULL AND (compacted_at IS NOT NULL OR
        (rejection_code IS NOT NULL AND rejection_message IS NOT NULL)))
  ),
  CHECK (compacted_at IS NULL OR result IS NULL),
  CHECK (result IS NULL OR octet_length(result::text) <= 1048576)
);

CREATE FUNCTION set_sync_operation_receipt_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_operation_receipt_updated_at
BEFORE UPDATE ON sync_operation_receipt
FOR EACH ROW EXECUTE FUNCTION set_sync_operation_receipt_updated_at();

ALTER TABLE sync_operation_receipt REPLICA IDENTITY FULL;

CREATE INDEX idx_sync_operation_receipt_workspace_identifier_result_retained_until_id
ON sync_operation_receipt (workspace_identifier, result_retained_until, id)
WHERE compacted_at IS NULL;

COMMENT ON TABLE sync_operation_receipt IS 'Immutable application request identity and atomic acceptance evidence with compactable results [domain:collaboration],[team:cueloop],[project:cueloop],[service:sync]';
COMMENT ON COLUMN sync_operation_receipt.id IS 'Immutable synthetic UUID v7 receipt identifier';
COMMENT ON COLUMN sync_operation_receipt.operation_identifier IS 'Client-generated UUID v7 request identity retained across retries and compaction';
COMMENT ON COLUMN sync_operation_receipt.workspace_identifier IS 'Workspace authorized by the application before accepting or reading a receipt';
COMMENT ON COLUMN sync_operation_receipt.actor_identifier IS 'Verified application principal bound to the accepted request';
COMMENT ON COLUMN sync_operation_receipt.operation_name IS 'Registered application operation name';
COMMENT ON COLUMN sync_operation_receipt.operation_version IS 'Version of the registered operation contract';
COMMENT ON COLUMN sync_operation_receipt.fingerprint IS 'Server-derived SHA-256 fingerprint of canonical request data and verified principal';
COMMENT ON COLUMN sync_operation_receipt.request_created_at IS 'Fixed client request creation time';
COMMENT ON COLUMN sync_operation_receipt.request_expires_at IS 'Fixed deadline for first acceptance; accepted retries retain their identity';
COMMENT ON COLUMN sync_operation_receipt.status IS 'Immutable authoritative acceptance or rejection outcome';
COMMENT ON COLUMN sync_operation_receipt.rejected_at IS 'Authority rejection time, or null for an accepted request';
COMMENT ON COLUMN sync_operation_receipt.rejection_code IS 'Application rejection code retained until compaction';
COMMENT ON COLUMN sync_operation_receipt.rejection_message IS 'Application rejection explanation bounded to 1000 characters and retained until compaction';
COMMENT ON COLUMN sync_operation_receipt.accepted_at IS 'Authority acceptance time, committed atomically with application changes';
COMMENT ON COLUMN sync_operation_receipt.result_retained_until IS 'Deadline after which original result bytes may be compacted';
COMMENT ON COLUMN sync_operation_receipt.result IS 'Original application JSON result, or SQL null after compaction';
COMMENT ON COLUMN sync_operation_receipt.compacted_at IS 'Time when result bytes were removed while preserving request identity';
COMMENT ON COLUMN sync_operation_receipt.created_at IS 'Time when the receipt row was created';
COMMENT ON COLUMN sync_operation_receipt.updated_at IS 'Time when receipt storage metadata was last changed';
COMMENT ON COLUMN sync_operation_receipt.deleted_at IS 'Optional soft-deletion metadata; identity remains reserved';
