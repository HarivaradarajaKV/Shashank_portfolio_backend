# Shashank's Portfolio - Backend Server & Supabase Database

This is the standalone backend server for Shashank M S's UX Portfolio, powered by Node.js, Express, PostgreSQL, and Supabase Storage.

## Features
- **Supabase PostgreSQL Database**: Stores dynamic metadata, aspect ratios, dimensions, and image URLs for all 101 image slots across 8 case studies.
- **Supabase Storage Bucket (`portfolio-images`)**: Stores uploaded images while strictly preserving original file extensions (`.webp`, `.png`, `.jpg`, `.svg`, etc.) and MIME types.
- **Automatic Storage Bucket Cleanup**: Deletes previous image files from the bucket whenever an admin uploads a replacement.
- **Admin Authentication**: Secure credentials verification for `shashankms08112000@gmail.com`.
- **CORS Enabled**: Configured to accept requests from the frontend client.

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and configure your credentials:
```bash
cp .env.example .env
```

### 3. Initialize Database Tables and Slots
```bash
npm run init-db
```

### 4. Start the Server
```bash
# Production mode
npm start

# Development mode
npm run dev
```

---

## Deployment Instructions

### Deploy to Render
1. Create a new **Web Service** on [Render](https://render.com).
2. Connect this repository: `https://github.com/Harivaradarajakv/Shashank_portfolio_backend.git`.
3. Set **Build Command**: `npm install`
4. Set **Start Command**: `npm start`
5. Under **Environment Variables**, add the variables from `.env`.
6. Copy your Render service URL (e.g. `https://shashank-portfolio-backend.onrender.com`) and set it as `VITE_API_URL` in your frontend deployment!

### Deploy to Railway
1. Create a new Project on [Railway](https://railway.app).
2. Deploy from GitHub Repo: `https://github.com/Harivaradarajakv/Shashank_portfolio_backend.git`.
3. Add the Environment Variables from `.env`.
4. Railway will automatically detect Node.js and run `npm start`.
5. Copy the generated domain and set it as `VITE_API_URL` in your frontend environment.
