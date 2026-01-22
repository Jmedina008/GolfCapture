-- Add reward fields to locations table
ALTER TABLE locations ADD COLUMN IF NOT EXISTS reward_type VARCHAR(100) DEFAULT 'free_beer';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS reward_description VARCHAR(255) DEFAULT 'Free beer after your round';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS reward_emoji VARCHAR(10) DEFAULT '🍺';

-- Update existing locations with specific rewards
UPDATE locations SET
  reward_type = 'free_beer',
  reward_description = 'Free beer after your round',
  reward_emoji = '🍺'
WHERE placement_type = 'cart';

UPDATE locations SET
  reward_type = 'free_appetizer',
  reward_description = 'Free appetizer at the bar',
  reward_emoji = '🍟'
WHERE placement_type = 'coaster';

UPDATE locations SET
  reward_type = 'meal_discount',
  reward_description = '10% off your meal',
  reward_emoji = '🍽️'
WHERE placement_type = 'table_tent';

-- Remove Turn Station (not needed)
DELETE FROM locations WHERE placement_type = 'turn';

-- Add Pro Shop location
INSERT INTO locations (course_id, name, placement_type, description, reward_type, reward_description, reward_emoji)
SELECT
  id,
  'Pro Shop',
  'pro_shop',
  'QR code at the pro shop counter',
  'shop_discount',
  '10% off your purchase',
  '🛒'
FROM courses WHERE slug = 'crescent-pointe';
