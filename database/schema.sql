-- Golf Capture Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Courses (for future multi-course support)
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    address VARCHAR(500),
    city VARCHAR(100),
    state VARCHAR(50),
    zip VARCHAR(10),
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Locations (QR code placements)
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    placement_type VARCHAR(50), -- 'cart', 'coaster', 'table_tent', 'check_in', 'turn', 'other'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Customers (the core table)
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    
    -- Contact info
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(255),
    email_verified BOOLEAN DEFAULT false,
    phone VARCHAR(20),
    phone_verified BOOLEAN DEFAULT false,
    zip VARCHAR(10),
    
    -- Profile data
    booking_source VARCHAR(50), -- 'golfnow', 'website', 'phone', 'walkin'
    is_local BOOLEAN,
    play_frequency VARCHAR(50), -- 'rarely', 'monthly', 'weekly'
    member_elsewhere BOOLEAN,
    first_time_visitor BOOLEAN,
    
    -- Computed/enriched fields
    distance_miles DECIMAL(6,2), -- calculated from zip
    visit_count INTEGER DEFAULT 0,
    last_visit_at TIMESTAMP WITH TIME ZONE,
    
    -- Membership scoring
    membership_score INTEGER DEFAULT 0, -- 0-100
    is_membership_prospect BOOLEAN DEFAULT false,
    
    -- Source tracking
    source VARCHAR(50) NOT NULL, -- 'capture', 'golfnow_import', 'clubessential_import', 'manual'
    source_id VARCHAR(255), -- external ID from import source
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_email_per_course UNIQUE (course_id, email),
    CONSTRAINT unique_phone_per_course UNIQUE (course_id, phone)
);

-- Captures (individual form submissions)
CREATE TABLE captures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    
    -- Raw form data (before merging into customer)
    form_data JSONB NOT NULL,
    
    -- Reward
    reward_code VARCHAR(20) NOT NULL,
    reward_type VARCHAR(50) DEFAULT 'free_beer',
    reward_redeemed BOOLEAN DEFAULT false,
    reward_redeemed_at TIMESTAMP WITH TIME ZONE,
    reward_redeemed_by VARCHAR(100), -- staff member name
    
    -- Metadata
    ip_address VARCHAR(45),
    user_agent TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Imports (track CSV uploads)
CREATE TABLE imports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    
    source VARCHAR(50) NOT NULL, -- 'golfnow', 'clubessential', 'generic'
    filename VARCHAR(255),
    file_size INTEGER,
    
    -- Stats
    total_rows INTEGER DEFAULT 0,
    processed_rows INTEGER DEFAULT 0,
    new_customers INTEGER DEFAULT 0,
    matched_customers INTEGER DEFAULT 0,
    skipped_rows INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]',
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Import rows (individual rows from imports for audit trail)
CREATE TABLE import_rows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    import_id UUID REFERENCES imports(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    
    row_number INTEGER,
    raw_data JSONB NOT NULL,
    
    action VARCHAR(50), -- 'created', 'matched', 'skipped', 'error'
    match_type VARCHAR(50), -- 'email', 'phone', 'name_zip', null
    error_message TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tags (for manual categorization)
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) DEFAULT '#6B7280', -- hex color
    description VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_tag_name_per_course UNIQUE (course_id, name)
);

-- Customer tags (many-to-many)
CREATE TABLE customer_tags (
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(100),
    
    PRIMARY KEY (customer_id, tag_id)
);

-- Analytics events (for tracking dashboard usage, optional)
CREATE TABLE analytics_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_customers_course ON customers(course_id);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_membership_score ON customers(course_id, membership_score DESC);
CREATE INDEX idx_customers_is_prospect ON customers(course_id, is_membership_prospect) WHERE is_membership_prospect = true;
CREATE INDEX idx_customers_source ON customers(course_id, source);
CREATE INDEX idx_customers_created ON customers(course_id, created_at DESC);

CREATE INDEX idx_captures_course ON captures(course_id);
CREATE INDEX idx_captures_customer ON captures(customer_id);
CREATE INDEX idx_captures_location ON captures(location_id);
CREATE INDEX idx_captures_reward_code ON captures(reward_code);
CREATE INDEX idx_captures_created ON captures(course_id, created_at DESC);

CREATE INDEX idx_locations_course ON locations(course_id);
CREATE INDEX idx_imports_course ON imports(course_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default course for Ron
INSERT INTO courses (name, slug, city, state, zip) 
VALUES ('Crescent Pointe', 'crescent-pointe', 'Myrtle Beach', 'SC', '29579');

-- Insert default locations
INSERT INTO locations (course_id, name, placement_type, description) 
SELECT id, 'Cart', 'cart', 'QR code mounted on golf cart steering wheel or dash'
FROM courses WHERE slug = 'crescent-pointe';

INSERT INTO locations (course_id, name, placement_type, description) 
SELECT id, 'Bar Coaster', 'coaster', 'QR code printed on drink coasters at the bar'
FROM courses WHERE slug = 'crescent-pointe';

INSERT INTO locations (course_id, name, placement_type, description) 
SELECT id, 'Turn Station', 'turn', 'QR code at the turn station between holes 9 and 10'
FROM courses WHERE slug = 'crescent-pointe';

INSERT INTO locations (course_id, name, placement_type, description) 
SELECT id, 'Restaurant Table', 'table_tent', 'Table tent in the restaurant'
FROM courses WHERE slug = 'crescent-pointe';

-- Insert default tags
INSERT INTO tags (course_id, name, color, description)
SELECT id, 'Membership Prospect', '#10B981', 'High potential membership candidate'
FROM courses WHERE slug = 'crescent-pointe';

INSERT INTO tags (course_id, name, color, description)
SELECT id, 'VIP', '#F59E0B', 'High-value customer'
FROM courses WHERE slug = 'crescent-pointe';

INSERT INTO tags (course_id, name, color, description)
SELECT id, 'Do Not Contact', '#EF4444', 'Customer requested no marketing'
FROM courses WHERE slug = 'crescent-pointe';
