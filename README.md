# 🥛 GharFresh 2.0

Roz subah 7:30 se pehle doodh, dahi, paneer, ande aur bread ghar tak. **Ek hi process, koi database setup nahi, koi `npm install` nahi.**

```bash
node server.js          # Node 20 ya usse naya
```

Phir kholein:

| | Link | Demo login |
|---|---|---|
| 🛒 Customer shop | http://localhost:3000 | "Demo customer" button |
| 🧑‍💼 Admin panel | http://localhost:3000/admin | "Demo admin" button |
| 🛵 Rider app | http://localhost:3000/rider | "Demo rider" button |

Pehli baar chalte hi Jaipur ke 5 delivery areas, **20 products (har ek ki 6 photos)**, 3 riders, 14 customers, 3 coupons, 4 banners aur 14 din ki order history apne aap ban jaati hai.

## Sab kuch automatic kya hai

| Kab | Kya hota hai (bina kisi ke haath lagaye) |
|---|---|
| Raat 10:15 PM | Active subscriptions se kal ke orders ban jaate hain, wallet se paise kat te hain |
| Wallet kam ho | Order **hold** ho jaata hai (paise nahi katte), customer ko notification. Top-up hote hi **khud release** |
| Order bante hi | Area ke hisaab se route, nearest-stop order, kam load wale rider ko assign |
| Subah 3:00 | Stock par-level tak **auto restock** |
| Subah 4:00 | Aaj ke orders **auto pack** |
| Rider | Route start → har stop par **photo + GPS** → customer ko turant notification |
| Delivery fail | **Auto refund** wallet mein, customer ko message |
| Wallet < limit | **Auto-recharge** (customer ne on kiya ho to) + cashback |
| Chhoti complaint (≤ ₹150) | **Auto approve + refund** |
| Server raat bhar band raha | Subah catch-up run: aaj ke orders ban jaate hain |

Admin → **Automation** page se har automation on/off, timing aur rules badal sakte hain. **Dashboard → "Run demo day"** dabaiye: 9 naye orders bante hain aur simulated riders live deliver karte hain. Admin, customer tracking aur rider app sab ek saath update hote dikhte hain.

## Naya kya hai (purane Next.js + Supabase version se)

- Supabase, Brevo cron, pg_cron sab hata diya. Backend, database aur scheduler ab ek hi process hain.
- Har product ki **5 asli photos + pack illustration**, swipe gallery, zoom, ratings aur reviews, nutrition, shelf life, source.
- Live order tracking, rider ka naam aur "kitne stop pehle" (server-sent events).
- Wallet: UPI top-up sheet (demo), cashback slabs, auto-recharge, coupons, referral (₹50 dono ko), welcome bonus.
- Subscription: daily / alternate / weekdays / weekends / custom days, pause, skip a day, quantity, 7-din ka calendar.
- Admin: live dashboard, orders, products (photo upload + link), customers + wallet, plans, complaints, riders, areas, coupons, banners, automation settings, activity log, CSV export.
- Rider app: offline mode (photo-GPS ke saath save, net aate hi sync), navigation link, earnings.
- PWA: phone par "Add to Home screen" se app ki tarah chalta hai.

## Render FREE plan par chalana (step by step)

Free plan mein 2 dikkat hain: (1) 15 minute visitor na aaye to server so jaata hai, aur raat 10:15 ka job nahi chalta. (2) Restart par data mit jaata hai. Dono ka free ilaaj code mein hai:

**1. Data bachana (Supabase, free):**
Supabase project kholein → SQL Editor mein ye **ek baar** chalayein:
```sql
create table if not exists gf_state (id text primary key, data jsonb not null, updated_at timestamptz default now());
alter table gf_state enable row level security;   -- koi policy nahi: sirf aapki service key access kar paayegi
```
Project Settings → API se **Project URL** aur **service_role key** copy karein.

**2. Render par Web Service banayein:**
- Build command: `echo ok`   |   Start command: `node server.js`   |   Plan: Free
- Environment variables:

| Naam | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_KEY` | service_role key (sirf yahin, kisi ko mat dikhaiye) |
| `ADMIN_EMAIL` | aapka email (isse signup karte hi aap admin) |

Shuru mein log mein "Data restored from Supabase backup" ya "starting fresh" dikhega. Data har 15 second mein aur band hote waqt backup hota hai.

**3. Server ko jagaye rakhna (raat ka job isi par tika hai):**
- Code khud apne address ko har 9 minute mein ping karta hai (Render ka `RENDER_EXTERNAL_URL` use karke).
- Pakka karne ke liye free **UptimeRobot** (ya cron-job.org) par ek monitor banayein: URL `https://aapka-app.onrender.com/healthz`, har 5 minute.
- Free plan ke 750 ghante/mahina ek service ko 24x7 chalane ke liye kaafi hain.
- Phir bhi agar server raat bhar band raha, to subah chalu hote hi catch-up run aaj ke orders bana deta hai.

**4. Asli OTP email (optional):** `BREVO_API_KEY` aur `BREVO_SENDER_EMAIL` daalein. Tab demo-login buttons hat jaate hain.

> Free plan par server restart/deploy ke baad pehli request mein 30-50 second lag sakte hain. Customers ke liye Starter plan behtar hai, par shuru karne ke liye free + upar ke steps theek hain.

**Paid plan (baad mein):** Starter + disk `/data` aur `DATA_DIR=/data` (`render.yaml` mein ready). Tab Supabase backup ki zaroorat nahi.

## Asli business ke liye abhi ye karna baaki hai

- **Payments:** wallet top-up abhi *demo* hai (paise nahi kat te). Razorpay/Cashfree ka slot `POST /api/wallet/topup` mein ready hai. Aapka gateway account chahiye.
- **Sample data hatana:** Admin se demo customers/riders block karein, products ke daam aur areas apne hisaab se badlein. Ya `data/db.json` delete karke server dobara chalayein, phir bhi demo data wapas banega, isliye asli launch se pehle admin panel se edit karna behtar hai.
- **Photos:** products ki photos Unsplash (free licence) ke links hain. Apne products ki asli photos Admin → Products → Edit se upload karein, wahi cover ban jaati hain.
- **SMS/WhatsApp:** abhi sirf in-app + email.

## Test

```bash
DATA_DIR=/tmp/gf PORT=3111 node server.js &
BASE=http://localhost:3111 node tests/e2e.js     # 45 checks: login, wallet, order, cancel, subscription, nightly job, hold/release, rider, refund, complaint, admin, autopilot
```

## Photo credits

Unsplash photographers (links in `lib/photos.json`): Eiliv Aceron aur anya, Unsplash licence.

## Folder

```
server.js        http server + static + realtime
lib/core.js      wallet, orders, subscriptions, dispatch, refunds
lib/engine.js    scheduler + autopilot
lib/api.js       saare endpoints
lib/seed.js      demo data
public/          shop (index.html, app*.js), rider.*, admin.*
```
