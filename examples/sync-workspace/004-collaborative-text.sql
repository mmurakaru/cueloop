ALTER TABLE shared_record
  ADD COLUMN text_state text CHECK (octet_length(text_state) <= 5592408),
  ADD COLUMN text_revision integer NOT NULL DEFAULT 0 CHECK (text_revision >= 0);

COMMENT ON COLUMN shared_record.text_state IS 'Accepted collaborative text state as bounded base64, or null before explicit initialization';
COMMENT ON COLUMN shared_record.text_revision IS 'Number of accepted collaborative edits after initialization';

CREATE TABLE shared_text_revision (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_identifier uuid NOT NULL,
  record_identifier uuid NOT NULL,
  actor_identifier varchar(200) NOT NULL,
  parent_identifier varchar(200),
  revision integer NOT NULL CHECK (revision >= 0),
  content text NOT NULL CHECK (length(content) <= 100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT shared_text_revision_record_revision UNIQUE (record_identifier, revision)
);

CREATE TRIGGER trg_set_shared_text_revision_updated_at
BEFORE UPDATE ON shared_text_revision
FOR EACH ROW EXECUTE FUNCTION set_shared_record_updated_at();

ALTER TABLE shared_text_revision REPLICA IDENTITY FULL;

CREATE INDEX idx_shared_text_revision_workspace_identifier_record_identifier
ON shared_text_revision (workspace_identifier, record_identifier, revision DESC)
WHERE deleted_at IS NULL;

COMMENT ON TABLE shared_text_revision IS 'Accepted text revisions for shared records [domain:collaboration],[team:cueloop],[project:cueloop],[service:sync-example]';
COMMENT ON COLUMN shared_text_revision.id IS 'Immutable UUID v7 identity of the accepted initialization or edit operation';
COMMENT ON COLUMN shared_text_revision.workspace_identifier IS 'Workspace whose permissions control the revision';
COMMENT ON COLUMN shared_text_revision.record_identifier IS 'Shared record changed by this accepted operation';
COMMENT ON COLUMN shared_text_revision.parent_identifier IS 'Previous accepted revision identity, or null for initialization';
COMMENT ON COLUMN shared_text_revision.actor_identifier IS 'Verified application identity that submitted the accepted operation';
COMMENT ON COLUMN shared_text_revision.revision IS 'Accepted text revision, starting at zero for initialization';
COMMENT ON COLUMN shared_text_revision.content IS 'Queryable text after this accepted operation';
COMMENT ON COLUMN shared_text_revision.created_at IS 'Time when the authority accepted the text revision';
COMMENT ON COLUMN shared_text_revision.updated_at IS 'Time when the stored revision row was last updated';
COMMENT ON COLUMN shared_text_revision.deleted_at IS 'Time of administrative soft deletion, or null for a retained revision';
