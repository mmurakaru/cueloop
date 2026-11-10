CREATE FUNCTION set_cueloop_sync_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE cueloop_sync_workspace (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE cueloop_sync_workspace_member (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_identifier uuid NOT NULL,
  actor_identifier varchar(200) NOT NULL CHECK (length(actor_identifier) > 0),
  role varchar(10) NOT NULL CHECK (role IN ('viewer', 'editor', 'owner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (workspace_identifier, actor_identifier)
);

CREATE TABLE cueloop_sync_thread (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_identifier uuid NOT NULL,
  thread_identifier varchar(1000) NOT NULL CHECK (length(thread_identifier) > 0),
  title_preview text NOT NULL CHECK (length(title_preview) <= 2000),
  status varchar(10) NOT NULL CHECK (status IN ('pending', 'resolved')),
  version bigint NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  thread_created_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (workspace_identifier, thread_identifier)
);

CREATE TABLE cueloop_sync_thread_state (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_identifier uuid NOT NULL,
  document jsonb NOT NULL CHECK (octet_length(document::text) <= 33554432),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE cueloop_sync_thread_document (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_identifier uuid NOT NULL,
  document jsonb NOT NULL CHECK (octet_length(document::text) <= 33554432),
  text_state text CHECK (octet_length(text_state) <= 5592408),
  text_document_identifier uuid,
  text_revision bigint NOT NULL DEFAULT 0 CHECK (text_revision BETWEEN 0 AND 9007199254740991),
  CHECK ((text_state IS NULL AND text_document_identifier IS NULL AND text_revision = 0)
    OR (text_state IS NOT NULL AND text_document_identifier IS NOT NULL)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE cueloop_sync_thread_payload (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_identifier uuid NOT NULL,
  actor_identifier varchar(200) NOT NULL CHECK (length(actor_identifier) > 0),
  record_identifier uuid NOT NULL,
  operation jsonb NOT NULL CHECK (octet_length(operation::text) <= 1048576),
  digest varchar(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 33554432),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TRIGGER trg_cueloop_sync_workspace_updated_at BEFORE UPDATE ON cueloop_sync_workspace
FOR EACH ROW EXECUTE FUNCTION set_cueloop_sync_updated_at();
CREATE TRIGGER trg_cueloop_sync_workspace_member_updated_at BEFORE UPDATE ON cueloop_sync_workspace_member
FOR EACH ROW EXECUTE FUNCTION set_cueloop_sync_updated_at();
CREATE TRIGGER trg_cueloop_sync_thread_updated_at BEFORE UPDATE ON cueloop_sync_thread
FOR EACH ROW EXECUTE FUNCTION set_cueloop_sync_updated_at();
CREATE TRIGGER trg_cueloop_sync_thread_state_updated_at BEFORE UPDATE ON cueloop_sync_thread_state
FOR EACH ROW EXECUTE FUNCTION set_cueloop_sync_updated_at();
CREATE TRIGGER trg_cueloop_sync_thread_document_updated_at BEFORE UPDATE ON cueloop_sync_thread_document
FOR EACH ROW EXECUTE FUNCTION set_cueloop_sync_updated_at();
CREATE TRIGGER trg_cueloop_sync_thread_payload_updated_at BEFORE UPDATE ON cueloop_sync_thread_payload
FOR EACH ROW EXECUTE FUNCTION set_cueloop_sync_updated_at();

ALTER TABLE cueloop_sync_workspace REPLICA IDENTITY FULL;
ALTER TABLE cueloop_sync_workspace_member REPLICA IDENTITY FULL;
ALTER TABLE cueloop_sync_thread REPLICA IDENTITY FULL;
ALTER TABLE cueloop_sync_thread_state REPLICA IDENTITY FULL;
ALTER TABLE cueloop_sync_thread_document REPLICA IDENTITY FULL;
ALTER TABLE cueloop_sync_thread_payload REPLICA IDENTITY FULL;

CREATE INDEX idx_cueloop_sync_workspace_created_at_id
ON cueloop_sync_workspace (created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_cueloop_sync_workspace_member_actor_identifier_workspace_identifier
ON cueloop_sync_workspace_member (actor_identifier, workspace_identifier) WHERE deleted_at IS NULL;
CREATE INDEX idx_cueloop_sync_thread_workspace_identifier_thread_created_at_id
ON cueloop_sync_thread (workspace_identifier, thread_created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_cueloop_sync_thread_payload_expires_at_id
ON cueloop_sync_thread_payload (expires_at, id) WHERE deleted_at IS NULL;

COMMENT ON TABLE cueloop_sync_workspace IS 'Explicitly configured authoritative collaboration workspace [domain:review],[team:cueloop],[project:cueloop],[service:daemon]';
COMMENT ON COLUMN cueloop_sync_workspace.id IS 'Immutable UUID v7 workspace identity';
COMMENT ON COLUMN cueloop_sync_workspace.title IS 'Workspace display title limited to 2000 characters';
COMMENT ON COLUMN cueloop_sync_workspace.created_at IS 'UTC time when the authority created the workspace';
COMMENT ON COLUMN cueloop_sync_workspace.updated_at IS 'UTC workspace update time maintained by its trigger';
COMMENT ON COLUMN cueloop_sync_workspace.deleted_at IS 'UTC soft-deletion time, or null for an active workspace';

COMMENT ON TABLE cueloop_sync_workspace_member IS 'Verified actor membership and current workspace permissions [domain:review],[team:cueloop],[project:cueloop],[service:daemon]';
COMMENT ON COLUMN cueloop_sync_workspace_member.id IS 'Immutable UUID v7 membership identity retained when access changes';
COMMENT ON COLUMN cueloop_sync_workspace_member.workspace_identifier IS 'Application workspace identity checked before reads and changes';
COMMENT ON COLUMN cueloop_sync_workspace_member.actor_identifier IS 'Stable verified authentication subject, separate from its display name';
COMMENT ON COLUMN cueloop_sync_workspace_member.role IS 'Current viewer, editor, or owner permission';
COMMENT ON COLUMN cueloop_sync_workspace_member.created_at IS 'UTC time when membership was created';
COMMENT ON COLUMN cueloop_sync_workspace_member.updated_at IS 'UTC membership update time maintained by its trigger';
COMMENT ON COLUMN cueloop_sync_workspace_member.deleted_at IS 'UTC access-revocation time, or null for an active membership';

COMMENT ON TABLE cueloop_sync_thread IS 'Thread identity and metadata for bounded workspace queries [domain:review],[team:cueloop],[project:cueloop],[service:daemon]';
COMMENT ON COLUMN cueloop_sync_thread.id IS 'Immutable UUID v7 record identity used by application operations';
COMMENT ON COLUMN cueloop_sync_thread.workspace_identifier IS 'Workspace that owns this authoritative Thread';
COMMENT ON COLUMN cueloop_sync_thread.thread_identifier IS 'Preserved native Thread identity, including imported session identifiers';
COMMENT ON COLUMN cueloop_sync_thread.title_preview IS 'Bounded list preview derived from the full canonical Thread title';
COMMENT ON COLUMN cueloop_sync_thread.status IS 'Pending or resolved state projected from the canonical Thread';
COMMENT ON COLUMN cueloop_sync_thread.version IS 'Increasing accepted document version within the current authority';
COMMENT ON COLUMN cueloop_sync_thread.thread_created_at IS 'Preserved UTC source creation time used for Thread ordering';
COMMENT ON COLUMN cueloop_sync_thread.created_at IS 'UTC time when this authority accepted the Thread';
COMMENT ON COLUMN cueloop_sync_thread.updated_at IS 'UTC metadata update time maintained by its trigger';
COMMENT ON COLUMN cueloop_sync_thread.deleted_at IS 'UTC soft-deletion time, or null for an active Thread';

COMMENT ON TABLE cueloop_sync_thread_state IS 'Canonical owner state including native receipts and private share metadata [domain:review],[team:cueloop],[project:cueloop],[service:daemon]';
COMMENT ON COLUMN cueloop_sync_thread_state.id IS 'Synthetic identity shared with the authoritative Thread record';
COMMENT ON COLUMN cueloop_sync_thread_state.workspace_identifier IS 'Workspace whose current owners can read this full Thread state';
COMMENT ON COLUMN cueloop_sync_thread_state.document IS 'Validated complete Thread retained by the sole authoritative mutation path';
COMMENT ON COLUMN cueloop_sync_thread_state.created_at IS 'UTC time when full Thread state became authoritative';
COMMENT ON COLUMN cueloop_sync_thread_state.updated_at IS 'UTC state update time maintained by its trigger';
COMMENT ON COLUMN cueloop_sync_thread_state.deleted_at IS 'UTC soft-deletion time kept consistent with Thread metadata';

COMMENT ON TABLE cueloop_sync_thread_document IS 'Read-only collaborator projection derived from canonical Thread state [domain:review],[team:cueloop],[project:cueloop],[service:daemon]';
COMMENT ON COLUMN cueloop_sync_thread_document.id IS 'Synthetic record identity shared with its Thread metadata';
COMMENT ON COLUMN cueloop_sync_thread_document.workspace_identifier IS 'Workspace scope checked before document delivery or mutation';
COMMENT ON COLUMN cueloop_sync_thread_document.document IS 'Shared history and annotations excluding private native receipts and share administration';
COMMENT ON COLUMN cueloop_sync_thread_document.text_state IS 'Accepted bounded collaborative plain-text state, or null when this artifact has no collaborative text';
COMMENT ON COLUMN cueloop_sync_thread_document.text_document_identifier IS 'Current collaborative document generation replaced when an agent revision or history navigation changes its base';
COMMENT ON COLUMN cueloop_sync_thread_document.text_revision IS 'Number of accepted text edits within the current document generation';
COMMENT ON COLUMN cueloop_sync_thread_document.created_at IS 'UTC time when the authority accepted the document';
COMMENT ON COLUMN cueloop_sync_thread_document.updated_at IS 'UTC document update time maintained by its trigger';
COMMENT ON COLUMN cueloop_sync_thread_document.deleted_at IS 'UTC soft-deletion time kept consistent with Thread metadata';

COMMENT ON TABLE cueloop_sync_thread_payload IS 'Private staged Thread payloads awaiting durable application acceptance [domain:review],[team:cueloop],[project:cueloop],[service:daemon]';
COMMENT ON COLUMN cueloop_sync_thread_payload.id IS 'Immutable UUID v7 application operation identity';
COMMENT ON COLUMN cueloop_sync_thread_payload.workspace_identifier IS 'Workspace authorized when staging and accepting the import';
COMMENT ON COLUMN cueloop_sync_thread_payload.actor_identifier IS 'Verified actor subject bound to this staged payload';
COMMENT ON COLUMN cueloop_sync_thread_payload.record_identifier IS 'Immutable Thread record identity bound to the staged request';
COMMENT ON COLUMN cueloop_sync_thread_payload.operation IS 'Exact validated request envelope bound to payload staging and its acceptance receipt';
COMMENT ON COLUMN cueloop_sync_thread_payload.digest IS 'SHA-256 digest binding the stable import identity to its exact source snapshot';
COMMENT ON COLUMN cueloop_sync_thread_payload.payload IS 'Bounded validated import snapshot or command arguments excluded from client query schemas';
COMMENT ON COLUMN cueloop_sync_thread_payload.expires_at IS 'UTC deadline after which unaccepted staging cannot become authoritative';
COMMENT ON COLUMN cueloop_sync_thread_payload.created_at IS 'UTC time when staging was created';
COMMENT ON COLUMN cueloop_sync_thread_payload.updated_at IS 'UTC staging update time maintained by its trigger';
COMMENT ON COLUMN cueloop_sync_thread_payload.deleted_at IS 'UTC staging retirement time, or null while staging is available';
