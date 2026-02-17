-- 006_prospect_pipeline.sql
-- Sales pipeline for tracking membership prospects

DO $$ BEGIN
  CREATE TYPE pipeline_status AS ENUM ('new', 'contacted', 'tour_scheduled', 'joined', 'passed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS prospect_pipeline (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES courses(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  status pipeline_status DEFAULT 'new',
  assigned_to VARCHAR(255),
  notes TEXT,
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id)
);

CREATE INDEX idx_prospect_pipeline_course ON prospect_pipeline(course_id);
CREATE INDEX idx_prospect_pipeline_status ON prospect_pipeline(status);
