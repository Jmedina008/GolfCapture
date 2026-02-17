-- ============================================
-- GOLF CAPTURE - Combined Migrations (004-008)
-- Run this in Supabase SQL Editor (single paste)
-- Prerequisites: schema.sql, admin_users.sql, and location_rewards.sql must already be applied
-- ============================================

-- ============================================
-- 004: Customer Segments
-- ============================================
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

CREATE INDEX IF NOT EXISTS idx_customer_segments_course ON customer_segments(course_id);

-- ============================================
-- 005: Email System
-- ============================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS opted_out_email BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES courses(id),
  type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  delay_hours INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES courses(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  template_id UUID REFERENCES email_templates(id),
  to_email VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body_html TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  queue_id UUID NOT NULL REFERENCES email_queue(id),
  sendgrid_message_id VARCHAR(255),
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_email_queue_course ON email_queue(course_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_course ON email_templates(course_id);

-- Seed default email templates
INSERT INTO email_templates (course_id, type, name, subject, body_html, body_text, delay_hours, is_active)
SELECT
  c.id,
  'same_day_thanks',
  'Same-Day Thank You',
  'Thanks for visiting Crescent Pointe, {{first_name}}!',
  '<h2>Thanks for stopping by, {{first_name}}!</h2><p>We hope you enjoyed your time at Crescent Pointe Golf Club today.</p><p>Don''t forget to use your reward code: <strong>{{reward_code}}</strong></p><p>We''d love to see you again soon!</p><p>- The Crescent Pointe Team</p>',
  'Thanks for stopping by, {{first_name}}! Don''t forget your reward code: {{reward_code}}. See you again soon! - The Crescent Pointe Team',
  0, true
FROM courses c WHERE c.slug = 'crescent-pointe'
AND NOT EXISTS (SELECT 1 FROM email_templates WHERE type = 'same_day_thanks' AND course_id = c.id);

INSERT INTO email_templates (course_id, type, name, subject, body_html, body_text, delay_hours, is_active)
SELECT
  c.id,
  'followup_local',
  'Local Follow-Up (3 days)',
  '{{first_name}}, your next round is waiting!',
  '<h2>Hey {{first_name}},</h2><p>It was great having you at Crescent Pointe! As a local golfer, we wanted to let you know about our membership options that could save you money on every round.</p><p>Interested? Just reply to this email or call the pro shop!</p><p>- The Crescent Pointe Team</p>',
  'Hey {{first_name}}, Great having you at Crescent Pointe! Check out our membership options. Reply or call the pro shop! - The Crescent Pointe Team',
  72, true
FROM courses c WHERE c.slug = 'crescent-pointe'
AND NOT EXISTS (SELECT 1 FROM email_templates WHERE type = 'followup_local' AND course_id = c.id);

INSERT INTO email_templates (course_id, type, name, subject, body_html, body_text, delay_hours, is_active)
SELECT
  c.id,
  'followup_visitor',
  'Visitor Follow-Up (3 days)',
  '{{first_name}}, come back and visit us again!',
  '<h2>Hi {{first_name}},</h2><p>We loved having you visit Crescent Pointe! Planning another trip to the area? We''d love to have you back on the course.</p><p>- The Crescent Pointe Team</p>',
  'Hi {{first_name}}, We loved having you visit! Planning another trip? We''d love to have you back! - The Crescent Pointe Team',
  72, true
FROM courses c WHERE c.slug = 'crescent-pointe'
AND NOT EXISTS (SELECT 1 FROM email_templates WHERE type = 'followup_visitor' AND course_id = c.id);

INSERT INTO email_templates (course_id, type, name, subject, body_html, body_text, delay_hours, is_active)
SELECT
  c.id,
  'repeat_visitor_3',
  'Repeat Visitor (3rd Visit)',
  '{{first_name}}, you''re becoming a regular!',
  '<h2>{{first_name}}, 3 visits and counting!</h2><p>You''ve visited Crescent Pointe {{visit_count}} times now - you''re becoming one of our regulars!</p><p>Have you considered a membership? Our members enjoy priority tee times, discounts at the pro shop, and more.</p><p>- The Crescent Pointe Team</p>',
  '{{first_name}}, 3 visits! Have you considered a membership? Priority tee times, discounts, and more. Let''s chat! - The Crescent Pointe Team',
  0, true
FROM courses c WHERE c.slug = 'crescent-pointe'
AND NOT EXISTS (SELECT 1 FROM email_templates WHERE type = 'repeat_visitor_3' AND course_id = c.id);

-- ============================================
-- 006: Prospect Pipeline
-- ============================================
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

CREATE INDEX IF NOT EXISTS idx_prospect_pipeline_course ON prospect_pipeline(course_id);
CREATE INDEX IF NOT EXISTS idx_prospect_pipeline_status ON prospect_pipeline(status);

-- ============================================
-- 007: A/B Testing
-- ============================================
CREATE TABLE IF NOT EXISTS ab_tests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES courses(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  name VARCHAR(255) NOT NULL,
  variant_a_reward_type VARCHAR(100) NOT NULL,
  variant_a_description TEXT NOT NULL,
  variant_a_emoji VARCHAR(10) DEFAULT '🎁',
  variant_b_reward_type VARCHAR(100) NOT NULL,
  variant_b_description TEXT NOT NULL,
  variant_b_emoji VARCHAR(10) DEFAULT '🎁',
  is_active BOOLEAN DEFAULT true,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ab_test_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ab_test_id UUID NOT NULL REFERENCES ab_tests(id),
  variant CHAR(1) NOT NULL CHECK (variant IN ('A', 'B')),
  capture_id UUID NOT NULL REFERENCES captures(id),
  redeemed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ab_tests_location ON ab_tests(location_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ab_test_results_test ON ab_test_results(ab_test_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_results_capture ON ab_test_results(capture_id);

-- ============================================
-- 008: Revenue Events
-- ============================================
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

CREATE INDEX IF NOT EXISTS idx_revenue_events_course ON revenue_events(course_id);
CREATE INDEX IF NOT EXISTS idx_revenue_events_customer ON revenue_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_revenue_events_date ON revenue_events(event_date);
CREATE INDEX IF NOT EXISTS idx_revenue_events_type ON revenue_events(event_type);

-- ============================================
-- DONE! All migrations applied successfully.
-- ============================================
