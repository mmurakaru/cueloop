CREATE TABLE sync_authority (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  singleton boolean NOT NULL DEFAULT true CHECK (singleton),
  generation uuid NOT NULL DEFAULT uuidv7(),
  phase varchar(20) NOT NULL DEFAULT 'recovering' CHECK (phase IN ('active', 'recovering', 'fenced')),
  recovered_source_generation uuid,
  recovery_target_generation uuid,
  restored_snapshot_at timestamptz,
  schema_revision integer NOT NULL DEFAULT 1 CHECK (schema_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (singleton)
);

CREATE TABLE sync_workspace_authority (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_identifier uuid NOT NULL UNIQUE,
  generation uuid NOT NULL DEFAULT uuidv7(),
  phase varchar(20) NOT NULL DEFAULT 'active' CHECK (phase IN ('active', 'fenced')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE sync_schema_migration (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  identity varchar(200) NOT NULL UNIQUE CHECK (length(identity) > 0),
  digest varchar(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE FUNCTION set_sync_authority_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_authority_updated_at BEFORE UPDATE ON sync_authority
FOR EACH ROW EXECUTE FUNCTION set_sync_authority_updated_at();
CREATE TRIGGER trg_sync_workspace_authority_updated_at BEFORE UPDATE ON sync_workspace_authority
FOR EACH ROW EXECUTE FUNCTION set_sync_authority_updated_at();
CREATE TRIGGER trg_sync_schema_migration_updated_at BEFORE UPDATE ON sync_schema_migration
FOR EACH ROW EXECUTE FUNCTION set_sync_authority_updated_at();

ALTER TABLE sync_authority REPLICA IDENTITY FULL;
ALTER TABLE sync_workspace_authority REPLICA IDENTITY FULL;
ALTER TABLE sync_schema_migration REPLICA IDENTITY FULL;

ALTER TABLE sync_execution ADD COLUMN recovery_held boolean NOT NULL DEFAULT false;
ALTER TABLE sync_execution ADD COLUMN lease_generation uuid;

DROP INDEX idx_sync_execution_workspace_identifier_next_check_at_id;
CREATE INDEX idx_sync_execution_workspace_identifier_next_check_at_id
ON sync_execution (workspace_identifier, next_check_at, id)
WHERE NOT recovery_held AND deleted_at IS NULL
  AND status IN ('waiting-owner', 'executing', 'recovery-required');

COMMENT ON TABLE sync_authority IS 'Deployment identity and transactional activation fence for synchronized application writes [domain:collaboration],[team:cueloop],[project:cueloop],[service:sync]';
COMMENT ON COLUMN sync_authority.id IS 'Immutable logical authority identity retained across recovery generations';
COMMENT ON COLUMN sync_authority.singleton IS 'Singleton constraint allowing one deployment authority record';
COMMENT ON COLUMN sync_authority.generation IS 'Fresh UUID v7 invalidating old replica positions and request issuance after restore';
COMMENT ON COLUMN sync_authority.phase IS 'Active write eligibility, offline recovery, or a durable source write fence';
COMMENT ON COLUMN sync_authority.recovered_source_generation IS 'Source generation retained from the backup for verified activation fencing';
COMMENT ON COLUMN sync_authority.recovery_target_generation IS 'One destination generation allowed to activate from this durable source fence';
COMMENT ON COLUMN sync_authority.restored_snapshot_at IS 'UTC beginning of the restored consistent snapshot, or null for a new deployment';
COMMENT ON COLUMN sync_authority.schema_revision IS 'Supported authority protocol schema revision';
COMMENT ON COLUMN sync_authority.created_at IS 'UTC time when the logical authority was initialized';
COMMENT ON COLUMN sync_authority.updated_at IS 'UTC update time maintained by its trigger';
COMMENT ON COLUMN sync_authority.deleted_at IS 'UTC retirement time, or null while the authority identity is retained';

COMMENT ON TABLE sync_workspace_authority IS 'Per-workspace generation and write fence independent of other workspaces [domain:collaboration],[team:cueloop],[project:cueloop],[service:sync]';
COMMENT ON COLUMN sync_workspace_authority.id IS 'Immutable synthetic UUID v7 authority binding identity';
COMMENT ON COLUMN sync_workspace_authority.workspace_identifier IS 'Application workspace whose mutation and execution transactions share this fence';
COMMENT ON COLUMN sync_workspace_authority.generation IS 'Fresh UUID v7 binding newly issued workspace operations';
COMMENT ON COLUMN sync_workspace_authority.phase IS 'Active writes or an explicit workspace fence';
COMMENT ON COLUMN sync_workspace_authority.created_at IS 'UTC time when the workspace authority was registered';
COMMENT ON COLUMN sync_workspace_authority.updated_at IS 'UTC update time maintained by its trigger';
COMMENT ON COLUMN sync_workspace_authority.deleted_at IS 'UTC workspace retirement time, or null while active';

COMMENT ON TABLE sync_schema_migration IS 'Applied application and SDK migration identities and immutable source digests [domain:collaboration],[team:cueloop],[project:cueloop],[service:sync]';
COMMENT ON COLUMN sync_schema_migration.id IS 'Immutable synthetic UUID v7 migration record identity';
COMMENT ON COLUMN sync_schema_migration.identity IS 'Application-qualified migration identity reserved after successful commit';
COMMENT ON COLUMN sync_schema_migration.digest IS 'SHA-256 digest of the exact applied migration bytes';
COMMENT ON COLUMN sync_schema_migration.created_at IS 'UTC time when the migration committed';
COMMENT ON COLUMN sync_schema_migration.updated_at IS 'UTC update time maintained by its trigger';
COMMENT ON COLUMN sync_schema_migration.deleted_at IS 'UTC retirement time while retaining the migration identity';
COMMENT ON COLUMN sync_execution.recovery_held IS 'Restored intent requires verified provider recovery before claim eligibility';
COMMENT ON COLUMN sync_execution.lease_generation IS 'Authority generation that issued the current lease and can accept its reports';
