CREATE SCHEMA cueloop_sync_recovery;

CREATE TABLE cueloop_sync_recovery.restore_attempt (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  singleton boolean NOT NULL DEFAULT true CHECK (singleton),
  source_authority_identifier uuid NOT NULL,
  source_generation uuid NOT NULL,
  target_generation uuid NOT NULL DEFAULT uuidv7(),
  archive_digest varchar(64) NOT NULL CHECK (archive_digest ~ '^[0-9a-f]{64}$'),
  manifest_digest varchar(64) NOT NULL CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  phase varchar(20) NOT NULL DEFAULT 'prepared' CHECK (phase IN ('prepared', 'finalized')),
  schema_revision integer NOT NULL DEFAULT 1 CHECK (schema_revision = 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (singleton)
);

CREATE FUNCTION cueloop_sync_recovery.set_restore_attempt_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restore_attempt_updated_at
BEFORE UPDATE ON cueloop_sync_recovery.restore_attempt
FOR EACH ROW EXECUTE FUNCTION cueloop_sync_recovery.set_restore_attempt_updated_at();

ALTER TABLE cueloop_sync_recovery.restore_attempt REPLICA IDENTITY FULL;

COMMENT ON TABLE cueloop_sync_recovery.restore_attempt IS 'Destination-bound recovery journal outside canonical application snapshots [domain:collaboration],[team:cueloop],[project:cueloop],[service:sync]';
COMMENT ON COLUMN cueloop_sync_recovery.restore_attempt.id IS 'Immutable UUID v7 identity for this destination restore attempt';
COMMENT ON COLUMN cueloop_sync_recovery.restore_attempt.singleton IS 'Singleton reservation preventing a second archive from replacing this database';
COMMENT ON COLUMN cueloop_sync_recovery.restore_attempt.source_authority_identifier IS 'Logical authority identity retained from the verified snapshot manifest';
COMMENT ON COLUMN cueloop_sync_recovery.restore_attempt.source_generation IS 'Source generation whose accepted receipts define the snapshot recovery boundary';
COMMENT ON COLUMN cueloop_sync_recovery.restore_attempt.target_generation IS 'Fresh generation reserved once and retained across finalization retries';
COMMENT ON COLUMN cueloop_sync_recovery.restore_attempt.archive_digest IS 'SHA-256 of the exact archive admitted to this destination';
COMMENT ON COLUMN cueloop_sync_recovery.restore_attempt.manifest_digest IS 'SHA-256 of the canonical manifest binding identity, schema, snapshot, and archive';
COMMENT ON COLUMN cueloop_sync_recovery.restore_attempt.phase IS 'Prepared reservation or atomically finalized authority and execution holds';
COMMENT ON COLUMN cueloop_sync_recovery.restore_attempt.schema_revision IS 'Supported restore-journal protocol revision';
COMMENT ON COLUMN cueloop_sync_recovery.restore_attempt.created_at IS 'UTC time when the destination reserved this restore attempt';
COMMENT ON COLUMN cueloop_sync_recovery.restore_attempt.updated_at IS 'UTC update time maintained by its trigger';
COMMENT ON COLUMN cueloop_sync_recovery.restore_attempt.deleted_at IS 'UTC retirement time while retaining the unique destination reservation';
