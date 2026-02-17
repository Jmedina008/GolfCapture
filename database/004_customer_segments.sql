-- 004_customer_segments.sql
-- Customer segmentation for targeted marketing

CREATE TABLE IF NOT EXISTS customer_segments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES courses(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  filters JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Filters JSONB structure:
-- {
--   "booking_source": ["golfnow", "website"],
--   "is_local": true,
--   "play_frequency": ["weekly", "monthly"],
--   "min_score": 50,
--   "max_days_since_visit": 30,
--   "member_elsewhere": false,
--   "min_visits": 2
-- }

CREATE INDEX idx_customer_segments_course ON customer_segments(course_id);
