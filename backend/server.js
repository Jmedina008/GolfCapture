const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const multer = require('multer');
const csv = require('csv-parse');
const { v4: uuidv4 } = require('uuid');
const dns = require('dns');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sgMail = require('@sendgrid/mail');

// Configure SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@crescentpointegolf.com';

// Force IPv4 for DNS resolution (fixes Railway + Supabase connectivity)
dns.setDefaultResultOrder('ipv4first');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// JWT Secret - require in production
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('WARNING: JWT_SECRET environment variable is not set. Authentication will not work securely.');
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET is required in production. Set it in your Railway environment variables.');
    process.exit(1);
  }
}
const JWT_SECRET_VALUE = JWT_SECRET || 'dev-only-secret-do-not-use-in-production';

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting for capture endpoint (prevent spam)
const captureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 submissions per IP per 15 min
  message: { error: 'Too many submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Auth Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET_VALUE);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

// Admin-only middleware (must be used after authenticateToken)
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
};

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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

// Helper: Render email template with placeholders
function renderTemplate(template, data) {
  let html = template.body_html;
  let subject = template.subject;
  const replacements = {
    '{{first_name}}': data.first_name || '',
    '{{last_name}}': data.last_name || '',
    '{{reward_code}}': data.reward_code || '',
    '{{visit_count}}': String(data.visit_count || 1)
  };
  for (const [key, value] of Object.entries(replacements)) {
    html = html.split(key).join(value);
    subject = subject.split(key).join(value);
  }
  return { subject, body_html: html };
}

// Helper: Queue an email for a customer
async function queueEmail(client, courseId, customerId, templateType, extraData = {}) {
  try {
    // Check opt-out
    const custResult = await client.query(
      'SELECT first_name, last_name, email, visit_count, opted_out_email FROM customers WHERE id = $1',
      [customerId]
    );
    if (custResult.rows.length === 0 || !custResult.rows[0].email || custResult.rows[0].opted_out_email) return;
    const customer = custResult.rows[0];

    // Get template
    const tmplResult = await client.query(
      'SELECT * FROM email_templates WHERE course_id = $1 AND type = $2 AND is_active = true LIMIT 1',
      [courseId, templateType]
    );
    if (tmplResult.rows.length === 0) return;
    const template = tmplResult.rows[0];

    const data = { ...customer, ...extraData };
    const rendered = renderTemplate(template, data);

    const scheduledFor = template.delay_hours > 0
      ? new Date(Date.now() + template.delay_hours * 3600000).toISOString()
      : new Date().toISOString();

    await client.query(`
      INSERT INTO email_queue (course_id, customer_id, template_id, to_email, subject, body_html, scheduled_for)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [courseId, customerId, template.id, customer.email, rendered.subject, rendered.body_html, scheduledFor]);
  } catch (err) {
    console.error('Queue email error:', err.message);
  }
}

// Helper: Build segment filter SQL from JSONB filters
function buildSegmentFilterSQL(filters, params, startIndex) {
  const conditions = [];
  let idx = startIndex;

  if (filters.booking_source && filters.booking_source.length > 0) {
    conditions.push(`c.booking_source = ANY($${idx})`);
    params.push(filters.booking_source);
    idx++;
  }
  if (filters.is_local !== undefined && filters.is_local !== null) {
    conditions.push(`c.is_local = $${idx}`);
    params.push(filters.is_local);
    idx++;
  }
  if (filters.play_frequency && filters.play_frequency.length > 0) {
    conditions.push(`c.play_frequency = ANY($${idx})`);
    params.push(filters.play_frequency);
    idx++;
  }
  if (filters.min_score) {
    conditions.push(`c.membership_score >= $${idx}`);
    params.push(parseInt(filters.min_score));
    idx++;
  }
  if (filters.max_days_since_visit) {
    conditions.push(`c.last_visit_at >= NOW() - INTERVAL '1 day' * $${idx}`);
    params.push(parseInt(filters.max_days_since_visit));
    idx++;
  }
  if (filters.member_elsewhere !== undefined && filters.member_elsewhere !== null) {
    conditions.push(`c.member_elsewhere = $${idx}`);
    params.push(filters.member_elsewhere);
    idx++;
  }
  if (filters.min_visits) {
    conditions.push(`c.visit_count >= $${idx}`);
    params.push(parseInt(filters.min_visits));
    idx++;
  }

  return { conditions, params, nextIndex: idx };
}

// ============================================
// CAPTURE ROUTES
// ============================================

// POST /api/capture - Submit capture form
app.post('/api/capture', captureLimiter, async (req, res) => {
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
      firstTime,
      chosenReward
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
    
    // Check for existing customer by email only (not phone — different people can share a number)
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

    // Check if this email has already claimed a reward
    if (!isNewCustomer && customerId) {
      const captureCheck = await client.query(
        'SELECT id, reward_code FROM captures WHERE customer_id = $1 LIMIT 1',
        [customerId]
      );
      if (captureCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'already_claimed',
          message: 'You have already claimed your reward.'
        });
      }
    }

    // Also check by email directly in captures (in case customer record differs)
    if (normalizedEmail) {
      const directCaptureCheck = await client.query(`
        SELECT c.id
        FROM captures c
        JOIN customers cu ON c.customer_id = cu.id
        WHERE cu.course_id = $1 AND cu.email = $2
        LIMIT 1
      `, [courseId, normalizedEmail]);

      if (directCaptureCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'already_claimed',
          message: 'You have already claimed your reward.'
        });
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

    // Resolve reward based on customer choice
    const rewardMap = {
      free_beer: { type: 'free_beer', description: 'Free beer after your round', emoji: '🍺' },
      free_soft_drink: { type: 'free_soft_drink', description: 'Free soft drink or water', emoji: '🥤' },
      pro_shop_5: { type: 'pro_shop_5', description: '$5 Pro Shop credit', emoji: '🏌️' },
      food_bev_5: { type: 'food_bev_5', description: '$5 Food & Bev credit', emoji: '🍔' }
    };

    const chosenRewardInfo = rewardMap[chosenReward] || rewardMap.free_beer;
    let rewardType = chosenRewardInfo.type;
    let rewardDescription = chosenRewardInfo.description;
    let rewardEmoji = chosenRewardInfo.emoji;

    // Create capture record
    const captureResult = await client.query(`
      INSERT INTO captures (
        course_id, customer_id, location_id, form_data, reward_code, reward_type,
        ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      courseId,
      customerId,
      locationId || null,
      JSON.stringify(req.body),
      rewardCode,
      rewardType,
      req.ip,
      req.get('User-Agent')
    ]);
    const captureId = captureResult.rows[0].id;

    // Auto-add to pipeline if prospect (score >= 60 + local)
    if (isProspect) {
      await client.query(`
        INSERT INTO prospect_pipeline (course_id, customer_id, status)
        VALUES ($1, $2, 'new')
        ON CONFLICT (customer_id) DO NOTHING
      `, [courseId, customerId]);
    }

    await client.query('COMMIT');

    // Send reward code email immediately (not queued — must arrive now)
    let emailSent = false;
    try {
      if (process.env.SENDGRID_API_KEY) {
        const rewardEmail = {
          to: normalizedEmail,
          from: FROM_EMAIL,
          subject: `Your Crescent Pointe Reward Code: ${rewardCode}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #166534, #15803d); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 22px;">Crescent Pointe Golf Club</h1>
                <p style="color: #bbf7d0; margin: 8px 0 0; font-size: 14px;">Thanks for joining our list!</p>
              </div>
              <div style="background: #ffffff; padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
                <p style="color: #374151; font-size: 16px; margin: 0 0 8px;">Hi ${firstName},</p>
                <p style="color: #6b7280; font-size: 14px; margin: 0 0 20px;">Here's your reward code. Show it to any staff member to redeem:</p>
                <div style="background: #f3f4f6; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 16px;">
                  <p style="font-size: 32px; font-weight: bold; font-family: monospace; color: #166534; margin: 0; letter-spacing: 4px;">${rewardCode}</p>
                </div>
                <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; text-align: center; margin-bottom: 16px;">
                  <p style="margin: 0; font-size: 18px;">${rewardEmoji} ${rewardDescription}</p>
                  <p style="margin: 4px 0 0; color: #92400e; font-size: 13px;">Valid today only</p>
                </div>
                <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 16px 0 0;">Take a screenshot of this email to save your code.</p>
              </div>
              <div style="background: #f9fafb; padding: 16px; border-radius: 0 0 16px 16px; border: 1px solid #e5e7eb; border-top: none; text-align: center;">
                <p style="color: #9ca3af; font-size: 11px; margin: 0;">Crescent Pointe Golf Club &bull; Myrtle Beach, SC</p>
              </div>
            </div>
          `
        };
        await sgMail.send(rewardEmail);
        emailSent = true;
      } else {
        // Dev mode - log and allow
        console.log(`[DEV] Reward email for ${normalizedEmail}: code ${rewardCode}`);
        emailSent = true;
      }
    } catch (emailErr) {
      console.error('Reward email send error:', emailErr.message);
    }

    // Queue follow-up emails (delayed, non-blocking)
    const emailClient = await pool.connect();
    try {
      const updatedCustomer = await emailClient.query('SELECT * FROM customers WHERE id = $1', [customerId]);
      const cust = updatedCustomer.rows[0];

      // Follow-up based on local/visitor (72h delay built into template)
      if (cust.is_local) {
        await queueEmail(emailClient, courseId, customerId, 'followup_local', { reward_code: rewardCode });
      } else {
        await queueEmail(emailClient, courseId, customerId, 'followup_visitor', { reward_code: rewardCode });
      }

      // Repeat visitor milestone
      if (cust.visit_count === 3) {
        await queueEmail(emailClient, courseId, customerId, 'repeat_visitor_3', { reward_code: rewardCode });
      }
    } catch (emailErr) {
      console.error('Email queueing error (non-fatal):', emailErr.message);
    } finally {
      emailClient.release();
    }

    // Do NOT send the reward code to the frontend — it goes to email only
    res.json({
      success: true,
      emailSent,
      maskedEmail: normalizedEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3'),
      rewardDescription,
      rewardEmoji,
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
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&data=${encodeURIComponent(qrUrl)}`;
    
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

    // Update A/B test result if this capture was part of a test
    const capture = result.rows[0];
    await pool.query(
      'UPDATE ab_test_results SET redeemed = true WHERE capture_id = $1',
      [capture.id]
    );

    res.json({ success: true, capture });

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

    // Reward choice breakdown
    const rewardChoices = await pool.query(`
      SELECT reward_type, COUNT(*) as count,
        COUNT(*) FILTER (WHERE reward_redeemed = true) as redeemed
      FROM captures
      WHERE course_id = $1 AND reward_type IS NOT NULL
      GROUP BY reward_type
      ORDER BY count DESC
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
      playFrequency: playFrequency.rows,
      rewardChoices: rewardChoices.rows
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

// ============================================
// AUTHENTICATION ROUTES
// ============================================

// POST /api/auth/register - Create admin user (admin only)
app.post('/api/auth/register', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email, password, name, role = 'staff', courseSlug = 'crescent-pointe' } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    // Get course ID
    const course = await pool.query('SELECT id FROM courses WHERE slug = $1', [courseSlug]);
    if (course.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const courseId = course.rows[0].id;

    // Check if user already exists
    const existingUser = await pool.query('SELECT id FROM admin_users WHERE email = $1', [email.toLowerCase()]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const result = await pool.query(`
      INSERT INTO admin_users (course_id, email, password_hash, name, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, name, role, created_at
    `, [courseId, email.toLowerCase(), passwordHash, name, role]);

    res.status(201).json({
      message: 'User created successfully',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/login - Login and get token
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const result = await pool.query(`
      SELECT au.*, c.slug as course_slug
      FROM admin_users au
      JOIN courses c ON au.course_id = c.id
      WHERE au.email = $1 AND au.is_active = true
    `, [email.toLowerCase()]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await pool.query('UPDATE admin_users SET last_login = NOW() WHERE id = $1', [user.id]);

    // Generate token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        courseId: user.course_id,
        courseSlug: user.course_slug
      },
      JWT_SECRET_VALUE,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        courseSlug: user.course_slug
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/auth/me - Get current user info
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT au.id, au.email, au.name, au.role, au.last_login, c.slug as course_slug
      FROM admin_users au
      JOIN courses c ON au.course_id = c.id
      WHERE au.id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TEAM MANAGEMENT ROUTES (admin only)
// ============================================

// GET /api/admin/users - List all admin users
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, email, name, role, is_active, last_login, created_at
      FROM admin_users
      ORDER BY created_at ASC
    `);
    res.json({ users: result.rows });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/users/:id - Update user role/name/is_active
app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, is_active } = req.body;

    // Prevent deactivating yourself
    if (String(id) === String(req.user.id) && is_active === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }

    // Prevent demoting yourself
    if (String(id) === String(req.user.id) && role && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot change your own role.' });
    }

    const fields = [];
    const params = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
    if (role !== undefined) { fields.push(`role = $${idx++}`); params.push(role); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); params.push(is_active); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    params.push(id);
    const result = await pool.query(
      `UPDATE admin_users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, email, name, role, is_active`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/users/:id - Remove user
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (String(id) === String(req.user.id)) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    // Prevent deleting the last admin
    const adminCount = await pool.query("SELECT COUNT(*) FROM admin_users WHERE role = 'admin' AND is_active = true");
    const targetUser = await pool.query('SELECT role FROM admin_users WHERE id = $1', [id]);

    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (targetUser.rows[0].role === 'admin' && parseInt(adminCount.rows[0].count) <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin user.' });
    }

    await pool.query('DELETE FROM admin_users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/auth/password - Change own password
app.put('/api/auth/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const user = await pool.query('SELECT password_hash FROM admin_users WHERE id = $1', [req.user.id]);
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const valid = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);
    await pool.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

    res.json({ success: true, message: 'Password updated.' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// EMAIL ROUTES
// ============================================

// GET /api/admin/process-emails - Manual trigger to process email queue
app.get('/api/admin/process-emails', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await processEmailQueue();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Process emails error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/emails - List email activity with summary counts
app.get('/api/admin/emails', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courseId = req.user.courseId;

    const summary = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM email_queue WHERE course_id = $1
    `, [courseId]);

    const emails = await pool.query(`
      SELECT eq.*, c.first_name, c.last_name, et.name as template_name
      FROM email_queue eq
      LEFT JOIN customers c ON eq.customer_id = c.id
      LEFT JOIN email_templates et ON eq.template_id = et.id
      WHERE eq.course_id = $1
      ORDER BY eq.created_at DESC
      LIMIT 100
    `, [courseId]);

    res.json({
      summary: summary.rows[0],
      emails: emails.rows
    });
  } catch (error) {
    console.error('List emails error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/email-templates - List templates
app.get('/api/admin/email-templates', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courseId = req.user.courseId;
    const result = await pool.query(
      'SELECT * FROM email_templates WHERE course_id = $1 ORDER BY delay_hours ASC',
      [courseId]
    );
    res.json({ templates: result.rows });
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/email-templates/:id - Toggle active, edit subject/body
app.put('/api/admin/email-templates/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active, subject, body_html } = req.body;

    const fields = [];
    const params = [];
    let idx = 1;

    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); params.push(is_active); }
    if (subject !== undefined) { fields.push(`subject = $${idx++}`); params.push(subject); }
    if (body_html !== undefined) { fields.push(`body_html = $${idx++}`); params.push(body_html); }
    fields.push(`updated_at = NOW()`);

    if (fields.length <= 1) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    params.push(id);
    const result = await pool.query(
      `UPDATE email_templates SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: result.rows[0] });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/customers/:id/unsubscribe - Opt out + cancel pending emails
app.put('/api/customers/:id/unsubscribe', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE customers SET opted_out_email = true WHERE id = $1', [id]);
    await pool.query(
      "UPDATE email_queue SET status = 'cancelled' WHERE customer_id = $1 AND status = 'pending'",
      [id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SEGMENT ROUTES
// ============================================

// GET /api/admin/segments - List segments with customer counts
app.get('/api/admin/segments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courseId = req.user.courseId;
    const result = await pool.query(
      'SELECT * FROM customer_segments WHERE course_id = $1 ORDER BY created_at DESC',
      [courseId]
    );

    // Get counts for each segment
    const segments = [];
    for (const seg of result.rows) {
      const filters = seg.filters || {};
      const params = [courseId];
      const { conditions } = buildSegmentFilterSQL(filters, params, 2);
      let where = 'c.course_id = $1';
      if (conditions.length > 0) where += ' AND ' + conditions.join(' AND ');
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM customers c WHERE ${where}`, params
      );
      segments.push({ ...seg, customer_count: parseInt(countResult.rows[0].count) });
    }

    res.json({ segments });
  } catch (error) {
    console.error('List segments error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/segments - Create segment
app.post('/api/admin/segments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courseId = req.user.courseId;
    const { name, description, filters } = req.body;

    const result = await pool.query(`
      INSERT INTO customer_segments (course_id, name, description, filters, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [courseId, name, description || '', JSON.stringify(filters || {}), req.user.id]);

    res.json({ segment: result.rows[0] });
  } catch (error) {
    console.error('Create segment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/segments/:id/customers - Get customers matching segment
app.get('/api/admin/segments/:id/customers', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const segResult = await pool.query('SELECT * FROM customer_segments WHERE id = $1', [id]);
    if (segResult.rows.length === 0) return res.status(404).json({ error: 'Segment not found' });

    const seg = segResult.rows[0];
    const filters = seg.filters || {};
    const params = [seg.course_id];
    const { conditions } = buildSegmentFilterSQL(filters, params, 2);
    let where = 'c.course_id = $1';
    if (conditions.length > 0) where += ' AND ' + conditions.join(' AND ');

    const result = await pool.query(
      `SELECT c.* FROM customers c WHERE ${where} ORDER BY c.created_at DESC LIMIT 500`,
      params
    );

    res.json({ customers: result.rows });
  } catch (error) {
    console.error('Segment customers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/segments/:id/export - Export segment as CSV
app.post('/api/admin/segments/:id/export', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const segResult = await pool.query('SELECT * FROM customer_segments WHERE id = $1', [id]);
    if (segResult.rows.length === 0) return res.status(404).json({ error: 'Segment not found' });

    const seg = segResult.rows[0];
    const filters = seg.filters || {};
    const params = [seg.course_id];
    const { conditions } = buildSegmentFilterSQL(filters, params, 2);
    let where = 'c.course_id = $1';
    if (conditions.length > 0) where += ' AND ' + conditions.join(' AND ');

    const result = await pool.query(
      `SELECT c.first_name, c.last_name, c.email, c.phone, c.zip, c.booking_source, c.is_local, c.play_frequency, c.visit_count, c.membership_score FROM customers c WHERE ${where} ORDER BY c.created_at DESC`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'No customers in segment' });

    const headers = Object.keys(result.rows[0]);
    const csvRows = [headers.join(',')];
    for (const row of result.rows) {
      const values = headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) return `"${val.replace(/"/g, '""')}"`;
        return val;
      });
      csvRows.push(values.join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="segment-${seg.name}-${Date.now()}.csv"`);
    res.send(csvRows.join('\n'));
  } catch (error) {
    console.error('Export segment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/segments/:id/email - Send email to entire segment
app.post('/api/admin/segments/:id/email', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { templateId } = req.body;

    const segResult = await pool.query('SELECT * FROM customer_segments WHERE id = $1', [id]);
    if (segResult.rows.length === 0) return res.status(404).json({ error: 'Segment not found' });

    const seg = segResult.rows[0];
    const filters = seg.filters || {};
    const params = [seg.course_id];
    const { conditions } = buildSegmentFilterSQL(filters, params, 2);
    let where = 'c.course_id = $1 AND c.opted_out_email = false AND c.email IS NOT NULL';
    if (conditions.length > 0) where += ' AND ' + conditions.join(' AND ');

    const customers = await pool.query(`SELECT c.* FROM customers c WHERE ${where}`, params);

    const template = await pool.query('SELECT * FROM email_templates WHERE id = $1', [templateId]);
    if (template.rows.length === 0) return res.status(404).json({ error: 'Template not found' });

    const tmpl = template.rows[0];
    let queued = 0;

    for (const cust of customers.rows) {
      const rendered = renderTemplate(tmpl, cust);
      await pool.query(`
        INSERT INTO email_queue (course_id, customer_id, template_id, to_email, subject, body_html, scheduled_for)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `, [seg.course_id, cust.id, tmpl.id, cust.email, rendered.subject, rendered.body_html]);
      queued++;
    }

    res.json({ success: true, queued });
  } catch (error) {
    console.error('Email segment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/segments/preview-count - Live count preview without saving
app.post('/api/admin/segments/preview-count', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courseId = req.user.courseId;
    const { filters } = req.body;
    const params = [courseId];
    const { conditions } = buildSegmentFilterSQL(filters || {}, params, 2);
    let where = 'c.course_id = $1';
    if (conditions.length > 0) where += ' AND ' + conditions.join(' AND ');

    const result = await pool.query(`SELECT COUNT(*) FROM customers c WHERE ${where}`, params);
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Preview count error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/segments/:id - Delete segment
app.delete('/api/admin/segments/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM customer_segments WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete segment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PIPELINE ROUTES
// ============================================

// GET /api/admin/pipeline - List prospects with pipeline status + summary stats
app.get('/api/admin/pipeline', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courseId = req.user.courseId;
    const { status } = req.query;

    let query = `
      SELECT pp.*, c.first_name, c.last_name, c.email, c.phone, c.membership_score, c.visit_count
      FROM prospect_pipeline pp
      JOIN customers c ON pp.customer_id = c.id
      WHERE pp.course_id = $1
    `;
    const params = [courseId];
    let idx = 2;

    if (status) {
      query += ` AND pp.status = $${idx}`;
      params.push(status);
      idx++;
    }
    query += ' ORDER BY pp.last_activity_at DESC';

    const result = await pool.query(query, params);

    const summary = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'new') as new_count,
        COUNT(*) FILTER (WHERE status = 'contacted') as contacted_count,
        COUNT(*) FILTER (WHERE status = 'tour_scheduled') as tour_count,
        COUNT(*) FILTER (WHERE status = 'joined') as joined_count,
        COUNT(*) FILTER (WHERE status = 'passed') as passed_count
      FROM prospect_pipeline WHERE course_id = $1
    `, [courseId]);

    res.json({
      prospects: result.rows,
      summary: summary.rows[0]
    });
  } catch (error) {
    console.error('Pipeline list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/pipeline/:customerId - Update status/notes/assigned_to
app.put('/api/admin/pipeline/:customerId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status, notes, assigned_to } = req.body;

    const fields = ['last_activity_at = NOW()', 'updated_at = NOW()'];
    const params = [];
    let idx = 1;

    if (status !== undefined) { fields.push(`status = $${idx++}`); params.push(status); }
    if (notes !== undefined) { fields.push(`notes = $${idx++}`); params.push(notes); }
    if (assigned_to !== undefined) { fields.push(`assigned_to = $${idx++}`); params.push(assigned_to); }

    params.push(customerId);
    const result = await pool.query(
      `UPDATE prospect_pipeline SET ${fields.join(', ')} WHERE customer_id = $${idx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Pipeline entry not found' });
    res.json({ pipeline: result.rows[0] });
  } catch (error) {
    console.error('Pipeline update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/pipeline - Manually add customer to pipeline
app.post('/api/admin/pipeline', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courseId = req.user.courseId;
    const { customerId } = req.body;

    const result = await pool.query(`
      INSERT INTO prospect_pipeline (course_id, customer_id, status)
      VALUES ($1, $2, 'new')
      ON CONFLICT (customer_id) DO NOTHING
      RETURNING *
    `, [courseId, customerId]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Customer already in pipeline' });
    }
    res.json({ pipeline: result.rows[0] });
  } catch (error) {
    console.error('Pipeline add error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// A/B TESTING ROUTES
// ============================================

// GET /api/admin/ab-tests - List tests with variant counts + redemption rates
app.get('/api/admin/ab-tests', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courseId = req.user.courseId;

    const tests = await pool.query(`
      SELECT ab.*, l.name as location_name
      FROM ab_tests ab
      JOIN locations l ON ab.location_id = l.id
      WHERE ab.course_id = $1
      ORDER BY ab.created_at DESC
    `, [courseId]);

    const results = [];
    for (const test of tests.rows) {
      const stats = await pool.query(`
        SELECT
          variant,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE redeemed = true) as redeemed
        FROM ab_test_results
        WHERE ab_test_id = $1
        GROUP BY variant
      `, [test.id]);

      const variantStats = { A: { total: 0, redeemed: 0 }, B: { total: 0, redeemed: 0 } };
      for (const row of stats.rows) {
        variantStats[row.variant] = {
          total: parseInt(row.total),
          redeemed: parseInt(row.redeemed)
        };
      }

      results.push({ ...test, variants: variantStats });
    }

    res.json({ tests: results });
  } catch (error) {
    console.error('AB tests list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/ab-tests - Create test (auto-deactivates existing test on same location)
app.post('/api/admin/ab-tests', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courseId = req.user.courseId;
    const {
      locationId, name,
      variantARewardType, variantADescription, variantAEmoji,
      variantBRewardType, variantBDescription, variantBEmoji
    } = req.body;

    // Deactivate existing test on this location
    await pool.query(
      'UPDATE ab_tests SET is_active = false, ended_at = NOW() WHERE location_id = $1 AND is_active = true',
      [locationId]
    );

    const result = await pool.query(`
      INSERT INTO ab_tests (
        course_id, location_id, name,
        variant_a_reward_type, variant_a_description, variant_a_emoji,
        variant_b_reward_type, variant_b_description, variant_b_emoji
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      courseId, locationId, name,
      variantARewardType, variantADescription, variantAEmoji || '🎁',
      variantBRewardType, variantBDescription, variantBEmoji || '🎁'
    ]);

    res.json({ test: result.rows[0] });
  } catch (error) {
    console.error('Create AB test error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/ab-tests/:id - Toggle active/end test
app.put('/api/admin/ab-tests/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const updates = is_active
      ? 'is_active = true, ended_at = NULL'
      : 'is_active = false, ended_at = NOW()';

    const result = await pool.query(
      `UPDATE ab_tests SET ${updates} WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Test not found' });
    res.json({ test: result.rows[0] });
  } catch (error) {
    console.error('Update AB test error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// REVENUE ROUTES
// ============================================

// POST /api/admin/revenue - Record revenue event
app.post('/api/admin/revenue', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courseId = req.user.courseId;
    const { customerId, eventType, amount, source, locationId, notes, eventDate } = req.body;

    const result = await pool.query(`
      INSERT INTO revenue_events (course_id, customer_id, event_type, amount, source, attributed_location_id, notes, recorded_by, event_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      courseId,
      customerId || null,
      eventType,
      amount,
      source || null,
      locationId || null,
      notes || null,
      req.user.id,
      eventDate || new Date().toISOString().split('T')[0]
    ]);

    res.json({ event: result.rows[0] });
  } catch (error) {
    console.error('Record revenue error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/revenue - List events with filters
app.get('/api/admin/revenue', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courseId = req.user.courseId;
    const { eventType, startDate, endDate, customerId } = req.query;

    let query = `
      SELECT re.*, c.first_name, c.last_name, l.name as location_name
      FROM revenue_events re
      LEFT JOIN customers c ON re.customer_id = c.id
      LEFT JOIN locations l ON re.attributed_location_id = l.id
      WHERE re.course_id = $1
    `;
    const params = [courseId];
    let idx = 2;

    if (eventType) { query += ` AND re.event_type = $${idx++}`; params.push(eventType); }
    if (startDate) { query += ` AND re.event_date >= $${idx++}`; params.push(startDate); }
    if (endDate) { query += ` AND re.event_date <= $${idx++}`; params.push(endDate); }
    if (customerId) { query += ` AND re.customer_id = $${idx++}`; params.push(customerId); }

    query += ' ORDER BY re.event_date DESC LIMIT 200';

    const result = await pool.query(query, params);
    res.json({ events: result.rows });
  } catch (error) {
    console.error('List revenue error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/revenue/summary - Aggregated revenue data
app.get('/api/admin/revenue/summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courseId = req.user.courseId;

    const total = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM revenue_events WHERE course_id = $1',
      [courseId]
    );

    const byType = await pool.query(`
      SELECT event_type, SUM(amount) as total, COUNT(*) as count
      FROM revenue_events WHERE course_id = $1
      GROUP BY event_type ORDER BY total DESC
    `, [courseId]);

    const bySource = await pool.query(`
      SELECT COALESCE(source, 'Unknown') as source, SUM(amount) as total, COUNT(*) as count
      FROM revenue_events WHERE course_id = $1
      GROUP BY source ORDER BY total DESC
    `, [courseId]);

    const byLocation = await pool.query(`
      SELECT COALESCE(l.name, 'Unattributed') as location_name, SUM(re.amount) as total, COUNT(*) as count
      FROM revenue_events re
      LEFT JOIN locations l ON re.attributed_location_id = l.id
      WHERE re.course_id = $1
      GROUP BY l.name ORDER BY total DESC
    `, [courseId]);

    const topCustomers = await pool.query(`
      SELECT c.first_name, c.last_name, c.email, SUM(re.amount) as ltv, COUNT(*) as transactions
      FROM revenue_events re
      JOIN customers c ON re.customer_id = c.id
      WHERE re.course_id = $1
      GROUP BY c.id, c.first_name, c.last_name, c.email
      ORDER BY ltv DESC LIMIT 10
    `, [courseId]);

    // Conversion funnel
    const totalCaptures = await pool.query(
      'SELECT COUNT(*) FROM captures WHERE course_id = $1', [courseId]
    );
    const redeemedCaptures = await pool.query(
      'SELECT COUNT(*) FROM captures WHERE course_id = $1 AND reward_redeemed = true', [courseId]
    );
    const repeatCustomers = await pool.query(
      'SELECT COUNT(*) FROM customers WHERE course_id = $1 AND visit_count >= 2', [courseId]
    );
    const revenueCustomers = await pool.query(
      'SELECT COUNT(DISTINCT customer_id) FROM revenue_events WHERE course_id = $1', [courseId]
    );

    res.json({
      total: parseFloat(total.rows[0].total),
      byType: byType.rows,
      bySource: bySource.rows,
      byLocation: byLocation.rows,
      topCustomers: topCustomers.rows,
      funnel: {
        captures: parseInt(totalCaptures.rows[0].count),
        redeemed: parseInt(redeemedCaptures.rows[0].count),
        repeat: parseInt(repeatCustomers.rows[0].count),
        revenue: parseInt(revenueCustomers.rows[0].count)
      }
    });
  } catch (error) {
    console.error('Revenue summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// EMAIL PROCESSOR
// ============================================

async function processEmailQueue() {
  let sent = 0;
  let failed = 0;

  try {
    const pending = await pool.query(`
      SELECT eq.*, c.first_name, c.last_name
      FROM email_queue eq
      LEFT JOIN customers c ON eq.customer_id = c.id
      WHERE eq.status = 'pending' AND eq.scheduled_for <= NOW()
      ORDER BY eq.scheduled_for ASC
      LIMIT 50
    `);

    if (!process.env.SENDGRID_API_KEY) {
      // Mark as sent even without SendGrid (development mode)
      for (const email of pending.rows) {
        await pool.query(
          "UPDATE email_queue SET status = 'sent', sent_at = NOW() WHERE id = $1",
          [email.id]
        );
        await pool.query(
          'INSERT INTO email_logs (queue_id) VALUES ($1)',
          [email.id]
        );
        sent++;
      }
      return { sent, failed, mode: 'dev' };
    }

    for (const email of pending.rows) {
      try {
        const msg = {
          to: email.to_email,
          from: FROM_EMAIL,
          subject: email.subject,
          html: email.body_html
        };

        const [response] = await sgMail.send(msg);
        const messageId = response?.headers?.['x-message-id'] || null;

        await pool.query(
          "UPDATE email_queue SET status = 'sent', sent_at = NOW() WHERE id = $1",
          [email.id]
        );
        await pool.query(
          'INSERT INTO email_logs (queue_id, sendgrid_message_id) VALUES ($1, $2)',
          [email.id, messageId]
        );
        sent++;
      } catch (sendErr) {
        console.error(`Failed to send email ${email.id}:`, sendErr.message);
        await pool.query(
          "UPDATE email_queue SET status = 'failed', error_message = $2 WHERE id = $1",
          [email.id, sendErr.message]
        );
        failed++;
      }
    }
  } catch (err) {
    console.error('Email processor error:', err.message);
  }

  return { sent, failed };
}

// ============================================
// ADMIN SEED & SETUP
// ============================================

// Seed default admin on startup if admin_users table is empty
async function seedDefaultAdmin() {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) FROM admin_users');
    if (parseInt(rows[0].count) > 0) return;

    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD;
    if (!defaultPassword) {
      console.warn('No DEFAULT_ADMIN_PASSWORD set — skipping admin seed');
      return;
    }

    const course = await pool.query("SELECT id FROM courses WHERE slug = 'crescent-pointe'");
    if (course.rows.length === 0) {
      console.warn('Course not found — skipping admin seed');
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(defaultPassword, salt);

    await pool.query(
      `INSERT INTO admin_users (course_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [course.rows[0].id, 'joshmedina008@gmail.com', hash, 'Josh Medina', 'admin']
    );
    console.log('Default admin created: joshmedina008@gmail.com');
  } catch (err) {
    console.error('Seed admin error:', err.message);
  }
}

// POST /api/setup - One-time fallback to create admin (gated by SETUP_TOKEN)
app.post('/api/setup', async (req, res) => {
  try {
    const setupToken = process.env.SETUP_TOKEN;
    if (!setupToken) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { token, email, password, name } = req.body;
    if (token !== setupToken) {
      return res.status(403).json({ error: 'Invalid setup token' });
    }

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    const existing = await pool.query('SELECT id FROM admin_users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const course = await pool.query("SELECT id FROM courses WHERE slug = 'crescent-pointe'");
    if (course.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `INSERT INTO admin_users (course_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role`,
      [course.rows[0].id, email.toLowerCase(), hash, name, 'admin']
    );

    res.status(201).json({ message: 'Admin created', user: result.rows[0] });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await seedDefaultAdmin();

  // Email processor - runs every 5 minutes
  setInterval(async () => {
    const result = await processEmailQueue();
    if (result.sent > 0 || result.failed > 0) {
      console.log(`Email processor: ${result.sent} sent, ${result.failed} failed`);
    }
  }, 5 * 60 * 1000);
});

module.exports = app;
