# Collectly — Payment Reminder & Debt Collection SaaS Backend

## Overview
Production-grade Node.js + Express backend for automated payment 
reminders, debt collection workflows, and multi-channel notifications.

## Live Production URL
https://collectly-backend-4d5f.onrender.com

## Tech Stack
- Node.js + Express 5
- MongoDB Atlas (Mongoose)
- Redis (Upstash)
- Stripe (billing)
- SendGrid (email)
- Twilio (SMS + WhatsApp)
- AWS S3 (file storage)
- Sentry (monitoring)
- Render (hosting)

## Modules
- Module A: Authentication (JWT, 2FA, OAuth, RBAC)
- Module B: Billing & Subscriptions (Stripe)
- Module C: Customer & Invoice Management
- Module D: Reminder & Escalation Sequences
- Module E: Multi-Channel Delivery Engine
- Module F: Conversations & Agent Tools
- Module G: Dashboards & Analytics
- Module H: Search & Filters
- Module I: Notifications & Alerts
- Module J: Security & Compliance (GDPR)

## Local Setup
1. Clone the repository
2. Copy .env.example to .env
3. Fill in all environment variables
4. npm install
5. npm run dev

## API Documentation
Base URL: https://collectly-backend-4d5f.onrender.com
Health:   https://collectly-backend-4d5f.onrender.com/health

## Testing
npm test              # Run all tests
npm run test:coverage # Coverage report

## Architecture
Models → Validators → Services → Controllers → Routes → Tests