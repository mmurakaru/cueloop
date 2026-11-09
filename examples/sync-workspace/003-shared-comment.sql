CREATE TABLE shared_comment (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_identifier uuid NOT NULL,
  record_identifier uuid NOT NULL,
  author_identifier varchar(200) NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 100000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TRIGGER trg_shared_comment_updated_at
BEFORE UPDATE ON shared_comment
FOR EACH ROW EXECUTE FUNCTION set_shared_record_updated_at();

ALTER TABLE shared_comment REPLICA IDENTITY FULL;

CREATE INDEX idx_shared_comment_workspace_identifier_record_identifier_created_at_id
ON shared_comment (workspace_identifier, record_identifier, created_at, id)
WHERE deleted_at IS NULL;

COMMENT ON TABLE shared_comment IS 'Authorized collaborator comments with revision-checked edits and removals [domain:collaboration],[team:cueloop],[project:cueloop],[service:sync-example]';
COMMENT ON COLUMN shared_comment.id IS 'Immutable UUID v7 comment identifier derived from its creation request identity';
COMMENT ON COLUMN shared_comment.workspace_identifier IS 'Workspace that governs visibility and permissions';
COMMENT ON COLUMN shared_comment.record_identifier IS 'Shared record discussed by the comment, verified by the application';
COMMENT ON COLUMN shared_comment.author_identifier IS 'Verified principal that authored the accepted comment';
COMMENT ON COLUMN shared_comment.body IS 'Accepted comment text, limited to 100000 characters';
COMMENT ON COLUMN shared_comment.revision IS 'Positive revision checked by edits and removals to reject stale changes';
COMMENT ON COLUMN shared_comment.created_at IS 'Authority time when the comment was created';
COMMENT ON COLUMN shared_comment.updated_at IS 'Authority time when the comment was last changed';
COMMENT ON COLUMN shared_comment.deleted_at IS 'Authority removal time, or null for a visible comment';
