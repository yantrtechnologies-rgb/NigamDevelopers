# Boundary Cricket
Responsive cricket turf website for Sambalpur. React, Vite, Supabase and Razorpay.

## Local development
Requires Node 22 or newer.

```sh
npm ci
npm run dev
npm run build
```

Without configuration, the website runs in an explicitly labeled preview mode. Slots are illustrative, no customer records are saved, and no payments or confirmations are simulated. Images are loaded from Unsplash; fonts from Google Fonts. Replace the provisional Boundary branding, venue details and amenities before launch.

## Connect Supabase
1. Create a Supabase project. Apply `supabase/schema.sql` once in its SQL editor.
2. Copy `.env.example` to `.env.local`. Set the public project URL and anon key. Never put service-role keys or Razorpay secrets in VITE variables.
3. Enable email OTP in Supabase Auth; configure an SMTP provider and the email template to include `{{ .Token }}`. Set site URL and allowed redirects. Phone OTP needs a separate SMS provider and additional UI integration.
4. Insert the real facility and its seven operating-hours records through the Supabase dashboard. No sample facility or artificial bookings are inserted. Current UI targets a single facility. Configure real hourly and weekend rates in paise.
5. Create an owner account and insert its auth UUID into `admin_users` using the SQL editor. Never allow clients to assign administrator roles.
6. Deploy `checkout`, `verify-payment`, `razorpay-webhook`, and `cancel-booking` with Supabase CLI. Configure `SITE_ORIGIN`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` as Edge Function secrets. Supabase supplies service credentials to functions automatically.
7. Configure Razorpay automatic capture and the `payment.captured` webhook to the deployed webhook function. Disable JWT verification only for that endpoint: its raw request body is authenticated with HMAC. Keep JWT verification enabled elsewhere.
8. Test in Razorpay test mode, including declined payments, simultaneous attempts, delayed webhooks, duplicate webhooks, abandoned checkout, and unauthorized access before enabling live payments.

## Booking integrity
The server calculates amounts from database prices. A database exclusion constraint prevents overlapping confirmed or held bookings, and a facility row lock serializes reservations. Holds expire after ten minutes. Availability ignores expired holds; reservation cleanup releases them before each new reservation. Optionally schedule `update public.bookings set status='expired' where status='held' and expires_at<=now()` every minute with Supabase Cron. All date/time conversion occurs in Asia/Kolkata. Payment confirmation checks HMAC, fetches captured payment status from Razorpay, validates order/amount/currency and atomically generates the booking reference. Confirmation is idempotent. Captures received after expiration require owner reconciliation/refund; they must not overwrite another reservation.

## Implementation status / launch checklist
Implemented: responsive homepage, date/duration/time selection, pricing packages, FAQ, maps, email OTP UI, customer booking list, protected booking queries, database schema/RLS, atomic reservation RPC, server-created Razorpay order, signed payment verification and webhook handler.

Not yet production-complete: full admin facility/pricing editor, dashboard charts/revenue export, profile editor, mobile OTP, booking reference/mobile lookup, receipt downloads, automatic refunds/reconciliation, holiday/peak/group discounts, tax configuration, email delivery worker and reminder scheduler. Email jobs are queued, **not sent**. Cancellation intentionally returns an explicit unavailable response until policy/refund handling is implemented. Admin modal currently lists records visible under RLS; it is not a complete management dashboard. No testimonials are fabricated. Exact venue address, contact number and email are still required. Maps currently shows Sambalpur, not an invented venue pin.

Configure an email worker that reads pending `email_notifications`, sends branded templates through your selected provider, and records delivery outcomes with retry handling. Add tax rules only after the venue confirms applicable GST treatment; current pricing has no tax calculation. Validate remaining features and provision live services before taking real customer bookings.

## Architecture
Customer UI → authenticated Edge Functions → Supabase PostgreSQL.
Razorpay webhook → HMAC + captured-payment lookup → transactional confirmation → notification queue.
Core tables: users, customer_profiles, admin_users, turf_facilities, turf_operating_hours, booking_slots (maintenance ranges), bookings (reservations), booking_payments, payment_transactions, booking_cancellations, refunds, promotional_coupons, email_notifications, audit_logs.
