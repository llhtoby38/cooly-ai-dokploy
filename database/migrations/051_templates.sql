-- Templates table for tool presets applied from cards
-- Creates a generic table with per-tool JSONB settings

CREATE TABLE IF NOT EXISTS templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool TEXT NOT NULL,                             -- e.g. 'seedream4', 'seedance'
    slug TEXT NOT NULL,                             -- stable slug used in URLs
    title TEXT,
    description TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',          -- active | deprecated | draft
    public BOOLEAN NOT NULL DEFAULT TRUE,
    settings JSONB NOT NULL,                        -- tool-specific payload
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure uniqueness per tool+slug
CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_tool_slug ON templates(tool, slug);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_templates_public ON templates(public);
CREATE INDEX IF NOT EXISTS idx_templates_status ON templates(status);
CREATE INDEX IF NOT EXISTS idx_templates_updated_at ON templates(updated_at DESC);

-- Updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_templates_set_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION set_updated_at_templates()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at := NOW();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_templates_set_updated_at
    BEFORE UPDATE ON templates
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_templates();
  END IF;
END$$;


