CREATE TABLE sync_workspace_transfer (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_identifier uuid NOT NULL,
  binding jsonb NOT NULL CHECK (octet_length(binding::text) <= 4096),
  phase varchar(20) NOT NULL CHECK (phase IN ('fenced', 'imported', 'active')),
  manifest_digest varchar(64) CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (binding->>'transferIdentifier' = id::text),
  CHECK (binding->'source'->>'workspaceIdentifier' = workspace_identifier::text),
  CHECK (binding->'target'->>'workspaceIdentifier' = workspace_identifier::text),
  CHECK ((phase = 'fenced' AND manifest_digest IS NULL) OR (phase IN ('imported', 'active') AND manifest_digest IS NOT NULL))
);

CREATE TRIGGER trg_sync_workspace_transfer_updated_at
BEFORE UPDATE ON sync_workspace_transfer
FOR EACH ROW EXECUTE FUNCTION set_sync_authority_updated_at();

ALTER TABLE sync_workspace_transfer REPLICA IDENTITY FULL;

CREATE INDEX idx_sync_workspace_transfer_workspace_identifier_created_at_id
ON sync_workspace_transfer (workspace_identifier, created_at DESC, id DESC);

COMMENT ON TABLE sync_workspace_transfer IS 'Forward-only workspace handoff and destination reservation [domain:collaboration],[team:cueloop],[project:cueloop],[service:sync]';
COMMENT ON COLUMN sync_workspace_transfer.id IS 'Immutable UUID v7 identity shared by the source and destination journals';
COMMENT ON COLUMN sync_workspace_transfer.workspace_identifier IS 'Workspace reserved by this transfer for one bound destination';
COMMENT ON COLUMN sync_workspace_transfer.binding IS 'Immutable versioned source, target, and application adapter identities';
COMMENT ON COLUMN sync_workspace_transfer.phase IS 'Source fence or destination import and activation state';
COMMENT ON COLUMN sync_workspace_transfer.manifest_digest IS 'SHA-256 of the exact imported manifest, null before import';
COMMENT ON COLUMN sync_workspace_transfer.created_at IS 'UTC time when this deployment reserved the transfer';
COMMENT ON COLUMN sync_workspace_transfer.updated_at IS 'UTC time maintained by the journal trigger';
COMMENT ON COLUMN sync_workspace_transfer.deleted_at IS 'UTC retirement time while retaining the workspace reservation';
