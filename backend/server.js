const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const csv = require('csv-parse');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Helper: Generate reward code
function generateRewardCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'CP';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Helper: Normalize phone number
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits[0] === '1') return digits.slice(1);
  return null;
}

// Helper: Calculate membership score
function calculateMembershipScore(customer) {
  let score = 0;
  
  // Is local (most important per Ron)
  if (customer.is_local === true) score += 30;
  
  // Play frequency
  if (customer.play_frequency === 'weekly') score += 25;
  else if (customer.play_frequency === 'monthly') score += 15;
  else if (customer.play_frequency === 'rarely') score += 5;
  
  // Visit count (repeat visitors)
  if (customer.visit_count >= 5) score += 20;
  else if (customer.visit_count >= 3) score += 15;
  else if (customer.visit_count >= 2) score += 10;
  
  // Not a member elsewhere (opportunity)
  if (customer.member_elsewhere === false) score += 15;
  
  // Has complete contact info
  if (customer.email && customer.phone) score += 5;
  
  // Has zip (can verify proximity)
  if (customer.zip) score += 5;
  
  return Math.min(score, 100);
}

// ============================================
// CAPTURE ROUTES
// ============================================

// POST /api/capture - Submit capture form
app.post('/api/capture', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      courseSlug,
      locationId,
      firstName,
      lastName,
      email,
      phone,
      zip,
      bookingSource,
      isLocal,
      playFrequency,
      memberElsewhere,
      firstTime
    } = req.body;
    
    // Get course
    const courseResult = await client.query(
      'SELECT id FROM courses WHERE slug = $1',
      [courseSlug || 'crescent-pointe']
    );
    
    if (courseResult.rows.length === 0) {
      throw new Error('Course not found');
    }
    
    const courseId = courseResult.rows[0].id;
    const normalizedPhone = normalizePhone(phone);
    const normalizedEmail = email?.toLowerCase().trim();
    
    // Check for existing customer by email or phone
    let customerId = null;
    let isNewCustomer = true;
    
    if (normalizedEmail) {
      const existingByEmail = await client.query(
        'SELECT id, visit_count FROM customers WHERE course_id = $1 AND email = $2',
        [courseId, normalizedEmail]
      );
      if (existingByEmail.rows.length > 0) {
        customerId = existingByEmail.rows[0].id;
        isNewCustomer = false;
      }
    }
    
    if (!customerId && normalizedPhone) {
      const existingByPhone = await client.query(
        'SELECT id, visit_count FROM customers WHERE course_id = $1 AND phone = $2',
        [courseId, normalizedPhone]
      );
      if (existingByPhone.rows.length > 0) {
        customerId = existingByPhone.rows[0].id;
        isNewCustomer = false;
      }
    }
    
    if (isNewCustomer) {
      // Create new customer
      const customerResult = await client.query(`
        INSERT INTO customers (
          course_id, first_name, last_name, email, phone, zip,
          booking_source, is_local, play_frequency, member_elsewhere, first_time_visitor,
          source, visit_count, last_visit_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, NOW())
        RETURNING id
      `, [
        courseId, firstName, lastName, normalizedEmail, normalizedPhone, zip,
        bookingSource, isLocal, playFrequency, memberElsewhere, firstTime,
        'capture'
      ]);
      customerId = customerResult.rows[0].id;
    } else {
      // Update existing customer with new info and increment visit count
      await client.query(`
        UPDATE customers SET
          first_name = COALESCE($2, first_name),
          last_name = COALESCE($3, last_name),
          email = COALESCE($4, email),
          phone = COALESCE($5, phone),
          zip = COALESCE($6, zip),
          booking_source = COALESCE($7, booking_source),
          is_local = COALESCE($8, is_local),
          play_frequency = COALESCE($9, play_frequency),
          member_elsewhere = COALESCE($10, member_elsewhere),
          visit_count = visit_count + 1,
          last_visit_at = NOW()
        WHERE id = $1
      `, [
        customerId, firstName, lastName, normalizedEmail, normalizedPhone, zip,
        bookingSource, isLocal, playFrequency, memberElsewhere
      ]);
    }
    
    // Calculate and update membership score
    const customerData = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
    const score = calculateMembershipScore(customerData.rows[0]);
    const isProspect = score >= 60 && customerData.rows[0].is_local === true;
    
    await client.query(`
      UPDATE customers SET membership_score = $1, is_membership_prospect = $2 WHERE id = $3
    `, [score, isProspect, customerId]);
    
    // Generate reward code
    const rewardCode = generateRewardCode();
    
    // Create capture record
    await client.query(`
      INSERT INTO captures (
        course_id, customer_id, location_id, form_data, reward_code, reward_type,
        ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      courseId,
      customerId,
      locationId || null,
      JSON.stringify(req.body),
      rewardCode,
      'free_beer',
      req.ip,
      req.get('User-Agent')
    ]);
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      rewardCode,
      isNewCustomer,
      customerId
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Capture error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ============================================
// CUSTOMER ROUTES
// ============================================

// GET /api/customers - List customers with filters
app.get('/api/customers', async (req, res) => {
  try {
    const {
      courseSlug = 'crescent-pointe',
      search,
      source,
      bookingSource,
      isLocal,
      isProspect,
      minScore,
      limit = 50,
      offset = 0
    } = req.query;
    
    let query = `
      SELECT c.*, 
        (SELECT COUNT(*) FROM captures WHERE customer_id = c.id) as capture_count,
        (SELECT MAX(created_at) FROM captures WHERE customer_id = c.id) as last_capture_at
      FROM customers c
      JOIN courses co ON c.course_id = co.id
      WHERE co.slug = $1
    `;
    const params = [courseSlug];
    let paramIndex = 2;
    
    if (search) {
      query += ` AND (
        c.first_name ILIKE $${paramIndex} OR 
        c.last_name ILIKE $${paramIndex} OR 
        c.email ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (source) {
      query += ` AND c.source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }
    
    if (bookingSource) {
      query += ` AND c.booking_source = $${paramIndex}`;
      params.push(bookingSource);
      paramIndex++;
    }
    
    if (isLocal !== undefined) {
      query += ` AND c.is_local = $${paramIndex}`;
      params.push(isLocal === 'true');
      paramIndex++;
    }
    
    if (isProspect !== undefined) {
      query += ` AND c.is_membership_prospect = $${paramIndex}`;
      params.push(isProspect === 'true');
      paramIndex++;
    }
    
    if (minScore) {
      query += ` AND c.membership_score >= $${paramIndex}`;
      params.push(parseInt(minScore));
      paramIndex++;
    }
    
    query += ` ORDER BY c.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await pool.query(query, params);
    
    // Get total count
    let countQuery = `
      SELECT COUNT(*) FROM customers c
      JOIN courses co ON c.course_id = co.id
      WHERE co.slug = $1
    `;
    const countResult = await pool.query(countQuery, [courseSlug]);
    
    res.json({
      customers: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    console.error('List customers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/customers/:id - Get single customer
app.get('/api/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const customerResult = await pool.query(`
      SELECT c.*, co.name as course_name
      FROM customers c
      JOIN courses co ON c.course_id = co.id
      WHERE c.id = $1
    `, [id]);
    
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    // Get captures for this customer
    const capturesResult = await pool.query(`
      SELECT cap.*, l.name as location_name
      FROM captures cap
      LEFT JOIN locations l ON cap.location_id = l.id
      WHERE cap.customer_id = $1
      ORDER BY cap.created_at DESC
    `, [id]);
    
    // Get tags
    const tagsResult = await pool.query(`
      SELECT t.* FROM tags t
      JOIN customer_tags ct ON t.id = ct.tag_id
      WHERE ct.customer_id = $1
    `, [id]);
    
    res.json({
      ...customerResult.rows[0],
      captures: capturesResult.rows,
      tags: tagsResult.rows
    });
    
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/customers/:id/tags - Add tag to customer
app.post('/api/customers/:id/tags', async (req, res) => {
  try {
    const { id } = req.params;
    const { tagId } = req.body;
    
    await pool.query(`
      INSERT INTO customer_tags (customer_id, tag_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [id, tagId]);
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Add tag error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/customers/:id/tags/:tagId - Remove tag from customer
app.delete('/api/customers/:id/tags/:tagId', async (req, res) => {
  try {
    const { id, tagId } = req.params;
    
    await pool.query(`
      DELETE FROM customer_tags WHERE customer_id = $1 AND tag_id = $2
    `, [id, tagId]);
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Remove tag error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PROSPECTS ROUTE
// ============================================

// GET /api/prospects - Get membership prospects
app.get('/api/prospects', async (req, res) => {
  try {
    const { courseSlug = 'crescent-pointe', limit = 20 } = req.query;
    
    const result = await pool.query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM captures WHERE customer_id = c.id) as capture_count
      FROM customers c
      JOIN courses co ON c.course_id = co.id
      WHERE co.slug = $1
        AND c.is_local = true
        AND c.membership_score >= 50
      ORDER BY c.membership_score DESC, c.visit_count DESC
      LIMIT $2
    `, [courseSlug, parseInt(limit)]);
    
    res.json({ prospects: result.rows });
    
  } catch (error) {
    console.error('Get prospects error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// LOCATION ROUTES
// ============================================

// GET /api/locations - List locations
app.get('/api/locations', async (req, res) => {
  try {
    const { courseSlug = 'crescent-pointe' } = req.query;
    
    const result = await pool.query(`
      SELECT l.*,
        (SELECT COUNT(*) FROM captures WHERE location_id = l.id) as capture_count,
        (SELECT COUNT(*) FROM captures WHERE location_id = l.id AND created_at > NOW() - INTERVAL '7 days') as captures_this_week
      FROM locations l
      JOIN courses co ON l.course_id = co.id
      WHERE co.slug = $1
      ORDER BY l.name
    `, [courseSlug]);
    
    res.json({ locations: result.rows });
    
  } catch (error) {
    console.error('List locations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/locations - Create location
app.post('/api/locations', async (req, res) => {
  try {
    const { courseSlug = 'crescent-pointe', name, placementType, description } = req.body;
    
    const courseResult = await pool.query('SELECT id FROM courses WHERE slug = $1', [courseSlug]);
    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const result = await pool.query(`
      INSERT INTO locations (course_id, name, placement_type, description)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [courseResult.rows[0].id, name, placementType, description]);
    
    res.json({ location: result.rows[0] });
    
  } catch (error) {
    console.error('Create location error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/locations/:id/qr - Get QR code URL for location
app.get('/api/locations/:id/qr', async (req, res) => {
  try {
    const { id } = req.params;
    const baseUrl = process.env.FRONTEND_URL || 'https://your-app.vercel.app';
    
    const qrUrl = `${baseUrl}/capture?location=${id}`;
    
    // Using QR code API service
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrUrl)}`;
    
    res.json({ 
      qrUrl,
      qrImageUrl,
      locationId: id
    });
    
  } catch (error) {
    console.error('Get QR error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// REWARD ROUTES
// ============================================

// POST /api/rewards/:code/redeem - Redeem a reward
app.post('/api/rewards/:code/redeem', async (req, res) => {
  try {
    const { code } = req.params;
    const { redeemedBy } = req.body;
    
    const result = await pool.query(`
      UPDATE captures 
      SET reward_redeemed = true, reward_redeemed_at = NOW(), reward_redeemed_by = $2
      WHERE reward_code = $1 AND reward_redeemed = false
      RETURNING *
    `, [code.toUpperCase(), redeemedBy]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Code not found or already redeemed' });
    }
    
    res.json({ success: true, capture: result.rows[0] });
    
  } catch (error) {
    console.error('Redeem error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rewards/:code - Check reward status
app.get('/api/rewards/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    const result = await pool.query(`
      SELECT cap.*, c.first_name, c.last_name
      FROM captures cap
      LEFT JOIN customers c ON cap.customer_id = c.id
      WHERE cap.reward_code = $1
    `, [code.toUpperCase()]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Code not found' });
    }
    
    res.json({ reward: result.rows[0] });
    
  } catch (error) {
    console.error('Check reward error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// IMPORT ROUTES
// ============================================

// POST /api/import - Upload and process CSV
app.post('/api/import', upload.single('file'), async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { courseSlug = 'crescent-pointe', source } = req.body;
    const file = req.file;
    
    if (!file) {
      throw new Error('No file uploaded');
    }
    
    // Get course
    const courseResult = await client.query('SELECT id FROM courses WHERE slug = $1', [courseSlug]);
    if (courseResult.rows.length === 0) {
      throw new Error('Course not found');
    }
    const courseId = courseResult.rows[0].id;
    
    // Create import record
    const importResult = await client.query(`
      INSERT INTO imports (course_id, source, filename, file_size, status, started_at)
      VALUES ($1, $2, $3, $4, 'processing', NOW())
      RETURNING id
    `, [courseId, source, file.originalname, file.size]);
    const importId = importResult.rows[0].id;
    
    // Parse CSV
    const records = [];
    const parser = csv.parse(file.buffer.toString(), {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    for await (const record of parser) {
      records.push(record);
    }
    
    let newCustomers = 0;
    let matchedCustomers = 0;
    let skippedRows = 0;
    const errors = [];
    
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      
      try {
        // Map fields based on source
        let mappedData;
        if (source === 'golfnow') {
          mappedData = {
            firstName: row['First Name'] || row['first_name'] || row['FirstName'],
            lastName: row['Last Name'] || row['last_name'] || row['LastName'],
            email: row['Email'] || row['email'] || row['E-mail'],
            phone: row['Phone'] || row['phone'] || row['Phone Number'],
            zip: row['Zip'] || row['zip'] || row['Postal Code']
          };
        } else if (source === 'clubessential') {
          mappedData = {
            firstName: row['FirstName'] || row['First Name'] || row['first_name'],
            lastName: row['LastName'] || row['Last Name'] || row['last_name'],
            email: row['Email'] || row['email'] || row['EmailAddress'],
            phone: row['Phone'] || row['phone'] || row['MobilePhone'] || row['HomePhone'],
            zip: row['Zip'] || row['zip'] || row['PostalCode']
          };
        } else {
          // Generic mapping
          mappedData = {
            firstName: row['first_name'] || row['firstName'] || row['First Name'],
            lastName: row['last_name'] || row['lastName'] || row['Last Name'],
            email: row['email'] || row['Email'],
            phone: row['phone'] || row['Phone'],
            zip: row['zip'] || row['Zip']
          };
        }
        
        const normalizedEmail = mappedData.email?.toLowerCase().trim();
        const normalizedPhone = normalizePhone(mappedData.phone);
        
        // Skip if no email and no phone
        if (!normalizedEmail && !normalizedPhone) {
          skippedRows++;
          await client.query(`
            INSERT INTO import_rows (import_id, row_number, raw_data, action, error_message)
            VALUES ($1, $2, $3, 'skipped', 'No email or phone')
          `, [importId, i + 1, JSON.stringify(row)]);
          continue;
        }
        
        // Check for existing customer
        let existingCustomer = null;
        let matchType = null;
        
        if (normalizedEmail) {
          const emailMatch = await client.query(
            'SELECT id FROM customers WHERE course_id = $1 AND email = $2',
            [courseId, normalizedEmail]
          );
          if (emailMatch.rows.length > 0) {
            existingCustomer = emailMatch.rows[0];
            matchType = 'email';
          }
        }
        
        if (!existingCustomer && normalizedPhone) {
          const phoneMatch = await client.query(
            'SELECT id FROM customers WHERE course_id = $1 AND phone = $2',
            [courseId, normalizedPhone]
          );
          if (phoneMatch.rows.length > 0) {
            existingCustomer = phoneMatch.rows[0];
            matchType = 'phone';
          }
        }
        
        let customerId;
        let action;
        
        if (existingCustomer) {
          // Update existing customer with any missing info
          await client.query(`
            UPDATE customers SET
              first_name = COALESCE(first_name, $2),
              last_name = COALESCE(last_name, $3),
              email = COALESCE(email, $4),
              phone = COALESCE(phone, $5),
              zip = COALESCE(zip, $6)
            WHERE id = $1
          `, [
            existingCustomer.id,
            mappedData.firstName,
            mappedData.lastName,
            normalizedEmail,
            normalizedPhone,
            mappedData.zip
          ]);
          customerId = existingCustomer.id;
          matchedCustomers++;
          action = 'matched';
        } else {
          // Create new customer
          const insertResult = await client.query(`
            INSERT INTO customers (course_id, first_name, last_name, email, phone, zip, source, source_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
          `, [
            courseId,
            mappedData.firstName,
            mappedData.lastName,
            normalizedEmail,
            normalizedPhone,
            mappedData.zip,
            source + '_import',
            row['id'] || row['ID'] || null
          ]);
          customerId = insertResult.rows[0].id;
          newCustomers++;
          action = 'created';
        }
        
        // Record the import row
        await client.query(`
          INSERT INTO import_rows (import_id, customer_id, row_number, raw_data, action, match_type)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [importId, customerId, i + 1, JSON.stringify(row), action, matchType]);
        
      } catch (rowError) {
        errors.push({ row: i + 1, error: rowError.message });
        await client.query(`
          INSERT INTO import_rows (import_id, row_number, raw_data, action, error_message)
          VALUES ($1, $2, $3, 'error', $4)
        `, [importId, i + 1, JSON.stringify(row), rowError.message]);
      }
    }
    
    // Update import record
    await client.query(`
      UPDATE imports SET
        status = 'completed',
        completed_at = NOW(),
        total_rows = $2,
        processed_rows = $3,
        new_customers = $4,
        matched_customers = $5,
        skipped_rows = $6,
        errors = $7
      WHERE id = $1
    `, [importId, records.length, newCustomers + matchedCustomers, newCustomers, matchedCustomers, skippedRows, JSON.stringify(errors)]);
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      importId,
      stats: {
        totalRows: records.length,
        newCustomers,
        matchedCustomers,
        skippedRows,
        errors: errors.length
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Import error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// GET /api/imports - List imports
app.get('/api/imports', async (req, res) => {
  try {
    const { courseSlug = 'crescent-pointe' } = req.query;
    
    const result = await pool.query(`
      SELECT i.* FROM imports i
      JOIN courses co ON i.course_id = co.id
      WHERE co.slug = $1
      ORDER BY i.created_at DESC
    `, [courseSlug]);
    
    res.json({ imports: result.rows });
    
  } catch (error) {
    console.error('List imports error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ANALYTICS ROUTES
// ============================================

// GET /api/analytics - Dashboard stats
app.get('/api/analytics', async (req, res) => {
  try {
    const { courseSlug = 'crescent-pointe' } = req.query;
    
    // Get course ID
    const courseResult = await pool.query('SELECT id FROM courses WHERE slug = $1', [courseSlug]);
    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const courseId = courseResult.rows[0].id;
    
    // Total customers
    const totalCustomers = await pool.query(
      'SELECT COUNT(*) FROM customers WHERE course_id = $1',
      [courseId]
    );
    
    // Captures today
    const capturesToday = await pool.query(`
      SELECT COUNT(*) FROM captures 
      WHERE course_id = $1 AND created_at > CURRENT_DATE
    `, [courseId]);
    
    // Captures this week
    const capturesThisWeek = await pool.query(`
      SELECT COUNT(*) FROM captures 
      WHERE course_id = $1 AND created_at > NOW() - INTERVAL '7 days'
    `, [courseId]);
    
    // Redemption rate
    const redemptionStats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE reward_redeemed = true) as redeemed
      FROM captures WHERE course_id = $1
    `, [courseId]);
    
    // Booking source breakdown
    const bookingSources = await pool.query(`
      SELECT booking_source, COUNT(*) as count
      FROM customers
      WHERE course_id = $1 AND booking_source IS NOT NULL
      GROUP BY booking_source
    `, [courseId]);
    
    // Local vs visitor
    const localVsVisitor = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE is_local = true) as local_count,
        COUNT(*) FILTER (WHERE is_local = false) as visitor_count
      FROM customers WHERE course_id = $1
    `, [courseId]);
    
    // Membership prospects count
    const prospectsCount = await pool.query(`
      SELECT COUNT(*) FROM customers 
      WHERE course_id = $1 AND is_membership_prospect = true
    `, [courseId]);
    
    // Captures by location
    const capturesByLocation = await pool.query(`
      SELECT l.name, COUNT(c.id) as count
      FROM locations l
      LEFT JOIN captures c ON l.id = c.location_id AND c.created_at > NOW() - INTERVAL '7 days'
      WHERE l.course_id = $1
      GROUP BY l.id, l.name
      ORDER BY count DESC
    `, [courseId]);
    
    // Play frequency breakdown
    const playFrequency = await pool.query(`
      SELECT play_frequency, COUNT(*) as count
      FROM customers
      WHERE course_id = $1 AND play_frequency IS NOT NULL
      GROUP BY play_frequency
    `, [courseId]);
    
    const redemptionRate = redemptionStats.rows[0].total > 0
      ? Math.round((redemptionStats.rows[0].redeemed / redemptionStats.rows[0].total) * 100)
      : 0;
    
    res.json({
      totalCustomers: parseInt(totalCustomers.rows[0].count),
      capturesToday: parseInt(capturesToday.rows[0].count),
      capturesThisWeek: parseInt(capturesThisWeek.rows[0].count),
      redemptionRate,
      prospectsCount: parseInt(prospectsCount.rows[0].count),
      bookingSources: bookingSources.rows,
      localVsVisitor: localVsVisitor.rows[0],
      capturesByLocation: capturesByLocation.rows,
      playFrequency: playFrequency.rows
    });
    
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TAGS ROUTES
// ============================================

// GET /api/tags - List tags
app.get('/api/tags', async (req, res) => {
  try {
    const { courseSlug = 'crescent-pointe' } = req.query;
    
    const result = await pool.query(`
      SELECT t.*, 
        (SELECT COUNT(*) FROM customer_tags WHERE tag_id = t.id) as customer_count
      FROM tags t
      JOIN courses co ON t.course_id = co.id
      WHERE co.slug = $1
      ORDER BY t.name
    `, [courseSlug]);
    
    res.json({ tags: result.rows });
    
  } catch (error) {
    console.error('List tags error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// EXPORT ROUTE
// ============================================

// GET /api/export/customers - Export customers as CSV
app.get('/api/export/customers', async (req, res) => {
  try {
    const { courseSlug = 'crescent-pointe', isProspect, isLocal } = req.query;
    
    let query = `
      SELECT 
        c.first_name, c.last_name, c.email, c.phone, c.zip,
        c.booking_source, c.is_local, c.play_frequency, c.member_elsewhere,
        c.visit_count, c.membership_score, c.created_at
      FROM customers c
      JOIN courses co ON c.course_id = co.id
      WHERE co.slug = $1
    `;
    const params = [courseSlug];
    let paramIndex = 2;
    
    if (isProspect === 'true') {
      query += ` AND c.is_membership_prospect = true`;
    }
    
    if (isLocal === 'true') {
      query += ` AND c.is_local = true`;
    }
    
    query += ` ORDER BY c.created_at DESC`;
    
    const result = await pool.query(query, params);
    
    // Convert to CSV
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No customers found' });
    }
    
    const headers = Object.keys(result.rows[0]);
    const csvRows = [headers.join(',')];
    
    for (const row of result.rows) {
      const values = headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      csvRows.push(values.join(','));
    }
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="customers-${Date.now()}.csv"`);
    res.send(csvRows.join('\n'));
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
