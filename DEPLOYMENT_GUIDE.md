# Golf Capture: Complete Deployment Guide

This guide will take you from zero to a fully deployed customer capture platform. Follow each step in order.

---

## Prerequisites

Before you start, make sure you have:
- A computer with internet access
- A code editor (VS Code recommended: https://code.visualstudio.com/)
- Node.js installed (https://nodejs.org/ - download LTS version)
- Git installed (https://git-scm.com/downloads)
- A GitHub account (https://github.com)

---

## Step 1: Set Up Your Project Locally

### 1.1 Create project folder

Open your terminal (Command Prompt on Windows, Terminal on Mac) and run:

```bash
mkdir golf-capture
cd golf-capture
```

### 1.2 Initialize Git

```bash
git init
```

### 1.3 Create folder structure

```bash
mkdir backend
mkdir frontend
mkdir database
```

### 1.4 Copy the files

Copy the following files into their respective folders:
- `backend/server.js` (the API code)
- `backend/package.json` (backend dependencies)
- `database/schema.sql` (database setup)

---

## Step 2: Set Up Supabase (Database)

### 2.1 Create Supabase account

1. Go to https://supabase.com
2. Click "Start your project"
3. Sign up with GitHub (easiest)

### 2.2 Create new project

1. Click "New Project"
2. Enter project name: `golf-capture`
3. Create a strong database password (SAVE THIS - you'll need it)
4. Select region closest to you (e.g., "East US" for East Coast)
5. Click "Create new project"
6. Wait 2-3 minutes for setup

### 2.3 Get your database connection string

1. In your Supabase project, click "Project Settings" (gear icon)
2. Click "Database" in the left sidebar
3. Scroll to "Connection string"
4. Select "URI" tab
5. Copy the connection string - it looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
   ```
6. Replace `[YOUR-PASSWORD]` with the password you created

### 2.4 Run the database schema

1. In Supabase, click "SQL Editor" in the left sidebar
2. Click "New query"
3. Paste the entire contents of `database/schema.sql`
4. Click "Run" (or press Cmd+Enter / Ctrl+Enter)
5. You should see "Success. No rows returned"

### 2.5 Verify tables were created

1. Click "Table Editor" in the left sidebar
2. You should see tables: courses, customers, captures, locations, etc.
3. Click on "courses" - you should see one row for "Crescent Pointe"

---

## Step 3: Set Up the Backend API

### 3.1 Navigate to backend folder

```bash
cd backend
```

### 3.2 Install dependencies

```bash
npm install
```

### 3.3 Create environment file

Create a file called `.env` in the backend folder:

```bash
# On Mac/Linux:
touch .env

# On Windows (in PowerShell):
New-Item .env
```

### 3.4 Add environment variables

Open `.env` in your code editor and add:

```
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
PORT=3001
FRONTEND_URL=http://localhost:3000
```

Replace the DATABASE_URL with your actual Supabase connection string.

### 3.5 Test locally

```bash
npm run dev
```

You should see: `Server running on port 3001`

### 3.6 Test the API

Open a new terminal tab and run:

```bash
curl http://localhost:3001/health
```

You should see: `{"status":"ok","timestamp":"..."}`

---

## Step 4: Set Up the Frontend

### 4.1 Create React app

Open a new terminal, navigate to your project root, then:

```bash
cd frontend
npx create-react-app . --template typescript
```

If it asks to install create-react-app, type `y` and press Enter.

### 4.2 Install additional dependencies

```bash
npm install axios react-router-dom
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

### 4.3 Configure Tailwind

Replace the contents of `tailwind.config.js` with:

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

### 4.4 Add Tailwind to CSS

Replace the contents of `src/index.css` with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 4.5 Create environment file

Create `.env` in the frontend folder:

```
REACT_APP_API_URL=http://localhost:3001
```

### 4.6 Add the capture form and dashboard components

Copy the React component files (CaptureForm, AdminDashboard) into `src/components/`

---

## Step 5: Deploy the Backend to Railway

### 5.1 Create Railway account

1. Go to https://railway.app
2. Sign up with GitHub

### 5.2 Create new project

1. Click "New Project"
2. Select "Deploy from GitHub repo"
3. If prompted, authorize Railway to access your GitHub
4. You'll need to push your code to GitHub first (see step 5.3)

### 5.3 Push code to GitHub

First, create a new repository on GitHub:
1. Go to https://github.com/new
2. Name it `golf-capture`
3. Keep it private
4. Don't initialize with README
5. Click "Create repository"

Then push your code:

```bash
# From your project root
cd ..

# Create .gitignore
echo "node_modules/
.env
.DS_Store" > .gitignore

# Add all files
git add .

# Commit
git commit -m "Initial commit"

# Add remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/golf-capture.git

# Push
git branch -M main
git push -u origin main
```

### 5.4 Deploy backend on Railway

1. Back in Railway, select your `golf-capture` repo
2. Railway will detect it's a Node.js app
3. Click on the deployment
4. Go to "Variables" tab
5. Add your environment variables:
   - `DATABASE_URL` = your Supabase connection string
   - `PORT` = 3001
   - `FRONTEND_URL` = (leave blank for now, we'll update after deploying frontend)

### 5.5 Configure Railway settings

1. Go to "Settings" tab
2. Under "Root Directory", enter: `backend`
3. Under "Build Command", enter: `npm install`
4. Under "Start Command", enter: `npm start`
5. Click "Deploy"

### 5.6 Get your backend URL

1. Once deployed, Railway will give you a URL like: `https://golf-capture-production.up.railway.app`
2. Save this URL - you'll need it for the frontend

### 5.7 Test deployed backend

```bash
curl https://your-railway-url.up.railway.app/health
```

---

## Step 6: Deploy the Frontend to Vercel

### 6.1 Create Vercel account

1. Go to https://vercel.com
2. Sign up with GitHub

### 6.2 Import project

1. Click "Add New Project"
2. Select your `golf-capture` repository
3. Configure project:
   - Framework Preset: Create React App
   - Root Directory: `frontend`
4. Add environment variable:
   - Name: `REACT_APP_API_URL`
   - Value: Your Railway backend URL (e.g., `https://golf-capture-production.up.railway.app`)
5. Click "Deploy"

### 6.3 Get your frontend URL

Once deployed, Vercel will give you a URL like: `https://golf-capture.vercel.app`

### 6.4 Update Railway with frontend URL

1. Go back to Railway
2. Go to your project's Variables
3. Update `FRONTEND_URL` to your Vercel URL
4. Railway will automatically redeploy

---

## Step 7: Set Up Your Custom Domain (Optional)

### 7.1 For Vercel (frontend)

1. In Vercel, go to your project
2. Go to "Settings" → "Domains"
3. Add your domain (e.g., `capture.crescentpointe.com`)
4. Follow the DNS instructions provided

### 7.2 For Railway (backend)

1. In Railway, go to your project
2. Go to "Settings" → "Domains"
3. Add your domain (e.g., `api.crescentpointe.com`)
4. Follow the DNS instructions provided

---

## Step 8: Test Everything

### 8.1 Test the capture form

1. Open your frontend URL in a mobile browser (or use Chrome DevTools mobile view)
2. Fill out the form
3. Submit and verify you get a reward code

### 8.2 Test the admin dashboard

1. Navigate to `/admin` on your frontend
2. Verify you can see the capture you just submitted
3. Test filtering and search

### 8.3 Test redemption

1. Go to `/admin/redeem` (or wherever you put it)
2. Enter the reward code
3. Verify it shows as redeemed

### 8.4 Test CSV import

1. Export a sample CSV from GolfNow
2. Go to the import section
3. Upload the CSV
4. Verify customers appear in the dashboard

---

## Step 9: Generate QR Codes

### 9.1 Get QR codes for each location

For each location in your system, you can generate a QR code using the API:

```bash
curl https://your-api-url.up.railway.app/api/locations
```

This will return location IDs. Then for each location:

```bash
curl https://your-api-url.up.railway.app/api/locations/LOCATION_ID/qr
```

This returns a QR image URL you can download and print.

### 9.2 Print QR codes

1. Download the QR images
2. Add your branding (course logo, "Scan for free beer" text)
3. Print on:
   - Stickers for golf carts
   - Coasters for the bar
   - Table tents for the restaurant
   - Signs at the turn station

---

## Step 10: Train Staff

### 10.1 Redemption process

1. Customer shows code on phone
2. Staff goes to admin dashboard
3. Enters code in redemption search
4. Clicks "Redeem"
5. Gives customer their free beer

### 10.2 What not to do

- Don't push the QR code on customers at check-in
- Let the impersonal placements (carts, coasters) do the work

---

## Troubleshooting

### "Cannot connect to database"

- Verify your DATABASE_URL is correct
- Make sure your Supabase project is active
- Check if you need to add Railway's IP to Supabase allowed connections

### "CORS error"

- Make sure FRONTEND_URL is set correctly in Railway
- Verify the URL includes `https://` but NOT a trailing slash

### "Build failed on Railway"

- Check that your `package.json` is in the `backend` folder
- Verify the root directory is set to `backend` in Railway settings

### "Environment variables not loading"

- In Vercel, make sure variables start with `REACT_APP_`
- Redeploy after adding new environment variables

---

## Maintenance

### Weekly

- Check the prospects list for new membership candidates
- Review redemption rates by location

### Monthly

- Import fresh GolfNow data
- Review which QR locations are performing best
- Export customer list for email campaigns

### As needed

- Add new QR locations
- Adjust membership scoring criteria
- Update reward offers

---

## Costs

### Free tier limits

- **Supabase**: 500MB database, 2GB bandwidth
- **Railway**: $5/month credit (usually enough for low traffic)
- **Vercel**: 100GB bandwidth, unlimited deploys

### When to upgrade

- If you're capturing 1000+ customers/month
- If the database exceeds 500MB
- If you need custom domains with SSL

Estimated cost once past free tiers: $10-25/month

---

## Support

If you get stuck:
1. Check the error message carefully
2. Search the error on Google/Stack Overflow
3. Check the respective platform's docs (Supabase, Railway, Vercel)
4. Reach out to Josh

---

## Next Steps (Future Features)

Once the basic system is working:

1. **SMS delivery**: Add Twilio to text reward codes
2. **Email automation**: Connect to Mailchimp/SendGrid
3. **Repeat detection alerts**: Notify when someone scans 3+ times
4. **Multi-course support**: If Ron expands to other properties
5. **POS integration**: Connect to Clubessential API when available
