CREATE FUNCTION set_workspace_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE sync_workspace (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  title varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE sync_workspace_member (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_identifier uuid NOT NULL,
  user_identifier varchar(200) NOT NULL,
  role varchar(10) NOT NULL CHECK (role IN ('viewer', 'editor', 'owner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (workspace_identifier, user_identifier)
);

CREATE TRIGGER trg_sync_workspace_updated_at
BEFORE UPDATE ON sync_workspace
FOR EACH ROW EXECUTE FUNCTION set_workspace_updated_at();

CREATE TRIGGER trg_sync_workspace_member_updated_at
BEFORE UPDATE ON sync_workspace_member
FOR EACH ROW EXECUTE FUNCTION set_workspace_updated_at();

ALTER TABLE sync_workspace REPLICA IDENTITY FULL;
ALTER TABLE sync_workspace_member REPLICA IDENTITY FULL;

CREATE INDEX idx_sync_workspace_title_id ON sync_workspace (title, id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_sync_workspace_member_user_identifier_workspace_identifier
ON sync_workspace_member (user_identifier, workspace_identifier)
WHERE deleted_at IS NULL;

INSERT INTO sync_workspace (title) VALUES ('Shared workspace');

ALTER TABLE shared_record ADD COLUMN workspace_identifier uuid;
UPDATE shared_record SET workspace_identifier = (SELECT id FROM sync_workspace LIMIT 1);
ALTER TABLE shared_record ALTER COLUMN workspace_identifier SET NOT NULL;

CREATE INDEX idx_shared_record_workspace_identifier_created_at_id
ON shared_record (workspace_identifier, created_at DESC, id)
WHERE deleted_at IS NULL;

COMMENT ON TABLE sync_workspace IS 'Application collaboration scope [domain:collaboration],[team:cueloop],[project:cueloop],[service:sync-example]';
COMMENT ON COLUMN sync_workspace.id IS 'Immutable UUID v7 workspace identifier';
COMMENT ON COLUMN sync_workspace.title IS 'Display title of the workspace, limited to 200 characters';
COMMENT ON COLUMN sync_workspace.created_at IS 'Time when the authority created the workspace';
COMMENT ON COLUMN sync_workspace.updated_at IS 'Time when the authority last changed the workspace';
COMMENT ON COLUMN sync_workspace.deleted_at IS 'Time of soft deletion, or null for an active workspace';

COMMENT ON TABLE sync_workspace_member IS 'Current application membership and role within a workspace [domain:collaboration],[team:cueloop],[project:cueloop],[service:sync-example]';
COMMENT ON COLUMN sync_workspace_member.id IS 'Immutable UUID v7 membership identifier';
COMMENT ON COLUMN sync_workspace_member.workspace_identifier IS 'Workspace governed by this membership, verified by the application';
COMMENT ON COLUMN sync_workspace_member.user_identifier IS 'Verified application identity granted access to the workspace';
COMMENT ON COLUMN sync_workspace_member.role IS 'Read or write authority granted to the member';
COMMENT ON COLUMN sync_workspace_member.created_at IS 'Time when the authority created the membership';
COMMENT ON COLUMN sync_workspace_member.updated_at IS 'Time when the authority last changed the membership';
COMMENT ON COLUMN sync_workspace_member.deleted_at IS 'Time of access revocation, or null for an active membership';
COMMENT ON COLUMN shared_record.workspace_identifier IS 'Workspace that governs visibility and editing of the record';
