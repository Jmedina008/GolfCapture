-- 008_revenue_events.sql
-- Revenue tracking and attribution

DO $$ BEGIN
  CREATE TYPE revenue_event_type AS ENUM ('membership', 'green_fee', 'pro_shop', 'food_bev');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS revenue_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES courses(id),
  customer_id UUID REFERENCES customers(id),
  event_type revenue_event_type NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  source VARCHAR(100),
  attributed_location_id UUID REFERENCES locations(id),
  notes TEXT,
  recorded_by UUID REFERENCES admin_users(id),
  event_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_revenue_events_course ON revenue_events(course_id);
CREATE INDEX idx_revenue_events_customer ON revenue_events(customer_id);
CREATE INDEX idx_revenue_events_date ON revenue_events(event_date);
CREATE INDEX idx_revenue_events_type ON revenue_events(event_type);
