-- 005_email_system.sql
-- Email follow-up system with templates, queue, and logging

-- Add opt-out column to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS opted_out_email BOOLEAN DEFAULT false;

-- Email templates
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

-- Email queue
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

-- Email logs (delivery tracking)
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  queue_id UUID NOT NULL REFERENCES email_queue(id),
  sendgrid_message_id VARCHAR(255),
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_queue_status ON email_queue(status, scheduled_for);
CREATE INDEX idx_email_queue_course ON email_queue(course_id);
CREATE INDEX idx_email_templates_course ON email_templates(course_id);

-- Seed default email templates for crescent-pointe
INSERT INTO email_templates (course_id, type, name, subject, body_html, body_text, delay_hours, is_active)
SELECT
  c.id,
  'same_day_thanks',
  'Same-Day Thank You',
  'Thanks for visiting Crescent Pointe, {{first_name}}!',
  '<h2>Thanks for stopping by, {{first_name}}!</h2><p>We hope you enjoyed your time at Crescent Pointe Golf Club today.</p><p>Don''t forget to use your reward code: <strong>{{reward_code}}</strong></p><p>We''d love to see you again soon!</p><p>- The Crescent Pointe Team</p>',
  'Thanks for stopping by, {{first_name}}! We hope you enjoyed your time at Crescent Pointe Golf Club today. Don''t forget to use your reward code: {{reward_code}}. We''d love to see you again soon! - The Crescent Pointe Team',
  0,
  true
FROM courses c WHERE c.slug = 'crescent-pointe'
ON CONFLICT DO NOTHING;

INSERT INTO email_templates (course_id, type, name, subject, body_html, body_text, delay_hours, is_active)
SELECT
  c.id,
  'followup_local',
  'Local Follow-Up (3 days)',
  '{{first_name}}, your next round is waiting!',
  '<h2>Hey {{first_name}},</h2><p>It was great having you at Crescent Pointe! As a local golfer, we wanted to let you know about our membership options that could save you money on every round.</p><p>Visit count: {{visit_count}}</p><p>Interested? Just reply to this email or call the pro shop!</p><p>- The Crescent Pointe Team</p>',
  'Hey {{first_name}}, It was great having you at Crescent Pointe! As a local golfer, we wanted to let you know about our membership options. Visit count: {{visit_count}}. Interested? Just reply to this email or call the pro shop! - The Crescent Pointe Team',
  72,
  true
FROM courses c WHERE c.slug = 'crescent-pointe'
ON CONFLICT DO NOTHING;

INSERT INTO email_templates (course_id, type, name, subject, body_html, body_text, delay_hours, is_active)
SELECT
  c.id,
  'followup_visitor',
  'Visitor Follow-Up (3 days)',
  '{{first_name}}, come back and visit us again!',
  '<h2>Hi {{first_name}},</h2><p>We loved having you visit Crescent Pointe! Planning another trip to the area? We''d love to have you back on the course.</p><p>Book your next round and we''ll make sure it''s a great one!</p><p>- The Crescent Pointe Team</p>',
  'Hi {{first_name}}, We loved having you visit Crescent Pointe! Planning another trip? Book your next round and we''ll make sure it''s a great one! - The Crescent Pointe Team',
  72,
  true
FROM courses c WHERE c.slug = 'crescent-pointe'
ON CONFLICT DO NOTHING;

INSERT INTO email_templates (course_id, type, name, subject, body_html, body_text, delay_hours, is_active)
SELECT
  c.id,
  'repeat_visitor_3',
  'Repeat Visitor (3rd Visit)',
  '{{first_name}}, you''re becoming a regular!',
  '<h2>{{first_name}}, 3 visits and counting!</h2><p>You''ve visited Crescent Pointe {{visit_count}} times now - you''re becoming one of our regulars!</p><p>Have you considered a membership? Our members enjoy priority tee times, discounts at the pro shop, and more.</p><p>Let''s chat about finding the right membership for you.</p><p>- The Crescent Pointe Team</p>',
  '{{first_name}}, 3 visits and counting! You''ve visited {{visit_count}} times. Have you considered a membership? Our members enjoy priority tee times, discounts, and more. Let''s chat! - The Crescent Pointe Team',
  0,
  true
FROM courses c WHERE c.slug = 'crescent-pointe'
ON CONFLICT DO NOTHING;
