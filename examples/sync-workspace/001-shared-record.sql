CREATE FUNCTION set_shared_record_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE shared_record (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  content text NOT NULL CHECK (length(content) <= 100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TRIGGER trg_set_shared_record_updated_at
BEFORE UPDATE ON shared_record
FOR EACH ROW EXECUTE FUNCTION set_shared_record_updated_at();

ALTER TABLE shared_record REPLICA IDENTITY FULL;

CREATE INDEX idx_shared_record_created_at_id ON shared_record (created_at DESC, id)
WHERE deleted_at IS NULL;

COMMENT ON TABLE shared_record IS 'Shared text records for the standalone sync example [domain:collaboration],[team:cueloop],[project:cueloop],[service:sync-example]';
COMMENT ON COLUMN shared_record.id IS 'Immutable UUID v7 identifier for the shared record';
COMMENT ON COLUMN shared_record.content IS 'Accepted text content, limited to 100000 characters';
COMMENT ON COLUMN shared_record.created_at IS 'Time when the authority created the record';
COMMENT ON COLUMN shared_record.updated_at IS 'Time when the authority last updated the record';
COMMENT ON COLUMN shared_record.deleted_at IS 'Time of soft deletion, or null for a live record';

INSERT INTO shared_record (content) VALUES ('Shared workspace');
