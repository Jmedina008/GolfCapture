-- 007_ab_testing.sql
-- A/B testing for capture rewards

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

CREATE INDEX idx_ab_tests_location ON ab_tests(location_id, is_active);
CREATE INDEX idx_ab_test_results_test ON ab_test_results(ab_test_id);
CREATE INDEX idx_ab_test_results_capture ON ab_test_results(capture_id);
