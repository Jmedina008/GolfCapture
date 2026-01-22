# Golf Capture

Customer data capture and membership prospecting platform for golf courses.

## What It Does

1. **Captures customer data on property** via QR codes on carts, coasters, and table tents
2. **Tracks booking source** (GolfNow, Website, Phone, Walk-in)
3. **Identifies membership prospects** using automated scoring
4. **Merges data** from GolfNow and Clubessential imports
5. **Tracks reward redemption** for free beer incentives

## Why It's Not Just a Google Form

| Feature | Google Form | Golf Capture |
|---------|-------------|--------------|
| Instant reward code | ❌ | ✅ |
| Location-tagged QR codes | ❌ | ✅ |
| Redemption tracking | ❌ | ✅ |
| Repeat visitor detection | ❌ | ✅ |
| CSV import + merge | ❌ | ✅ |
| Membership scoring | ❌ | ✅ |
| Filtered dashboard | ❌ | ✅ |

## Project Structure

```
golf-capture/
├── backend/
│   ├── server.js          # Express API
│   └── package.json       # Dependencies
├── frontend/
│   └── src/
│       └── components/
│           ├── CaptureForm.jsx      # Golfer-facing form
│           └── AdminDashboard.jsx   # Staff dashboard
├── database/
│   └── schema.sql         # PostgreSQL schema
└── DEPLOYMENT_GUIDE.md    # Step-by-step deployment
```

## Tech Stack

- **Frontend**: React + Tailwind CSS (hosted on Vercel)
- **Backend**: Node.js + Express (hosted on Railway)
- **Database**: PostgreSQL (hosted on Supabase)

## Quick Start

See `DEPLOYMENT_GUIDE.md` for complete step-by-step instructions.

## Membership Scoring

Customers are scored 0-100 based on:

| Criteria | Points |
|----------|--------|
| Is local | +30 |
| Plays weekly | +25 |
| Plays monthly | +15 |
| Visited 5+ times | +20 |
| Visited 3-4 times | +15 |
| Not member elsewhere | +15 |
| Has email AND phone | +5 |
| Has zip code | +5 |

Customers with score >= 60 AND is_local = true are flagged as membership prospects.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/capture | Submit capture form |
| GET | /api/customers | List customers (with filters) |
| GET | /api/customers/:id | Get single customer |
| GET | /api/prospects | Get membership prospects |
| GET | /api/locations | List QR locations |
| POST | /api/rewards/:code/redeem | Redeem a reward code |
| POST | /api/import | Upload CSV file |
| GET | /api/analytics | Dashboard stats |
| GET | /api/export/customers | Export as CSV |

## Data Captured

From the form:
- First name, Last name
- Email, Phone
- Zip code
- How they booked (GolfNow, Website, Phone, Walk-in)
- Local or visiting
- How often they play golf
- Member at another club
- First time at this course

Automatically tracked:
- Visit count (repeat scans)
- Capture location (which QR code)
- Reward redemption status
- Membership score

## Built For

Ron Schiavone at Crescent Pointe Golf Club, Myrtle Beach, SC.

Based on customer discovery interviews revealing:
- 70% of rounds booked through GolfNow
- 20% fake email problem
- Zero overlap between booking and POS data
- Staff pitches at check-in get dismissed
- Cart and coaster placements work better
