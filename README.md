# Baby World BD — Private Admin Order Desk

এটি WhatsApp-এর **Admin-only** অর্ডার ম্যানেজমেন্ট বট। সাধারণ কাস্টমার মেসেজ করলে বট নীরবে উপেক্ষা করে—কোনো অটো রিপ্লাই বা কাস্টমারকে মেসেজ পাঠায় না। বটের মেনু শুধু `ADMIN_NUMBER`-এ নির্ধারিত নম্বরের সাথে চ্যাটে পাঠানো হয়।

## গুরুত্বপূর্ণ WhatsApp সীমাবদ্ধতা
আপনার দেওয়া ছবির মতো রঙিন ৩-কলামের স্থায়ী বাটন WhatsApp-এর সাধারণ linked-device chat-এ তৃতীয়-পক্ষের বট দিয়ে হুবহু তৈরি করা যায় না। এই সংস্করণে একই অপশনগুলো একটি সুন্দর formatted WhatsApp menu message এবং নম্বর/কমান্ড দিয়ে চালানো হয়। এটি WhatsApp-এর UI-তে নিজস্ব কাস্টম বাটন বা ব্যাকগ্রাউন্ড আঁকে না।

## Render-এ Deploy

1. ZIP Extract করে GitHub repository-তে সব ফাইল আপলোড করুন।
2. Render → New → Web Service → আপনার GitHub repository নির্বাচন করুন।
3. Runtime: Node
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Render-এর Environment-এ নিচের ভ্যারিয়েবলগুলো দিন:
   - `ADMIN_NUMBER` = আপনার Admin WhatsApp নম্বর, country code-সহ শুধু সংখ্যা; যেমন `8801XXXXXXXXX`
   - `DASHBOARD_PASSWORD` = শক্তিশালী একটি পাসওয়ার্ড
   - `DATA_DIR` = `/var/data`
   - `STEADFAST_API_KEY` = আপনার Steadfast API Key
   - `STEADFAST_SECRET_KEY` = আপনার Steadfast Secret Key
   - `STEADFAST_BASE_URL` = `https://portal.steadfast.com.bd/api/v1`
7. Render Service → Disks → Add Disk:
   - Name: `babyworld-data`
   - Mount Path: `/var/data`
   - Size: আপনার প্ল্যান অনুযায়ী
8. Save করে Manual Deploy → Deploy latest commit দিন।
9. Render-এর দেওয়া `https://....onrender.com` URL খুলুন। QR দেখালে WhatsApp → Linked devices → Link a device থেকে স্ক্যান করুন।
10. Connected হলে Admin WhatsApp চ্যাটে `menu` পাঠান। বট মেনু দেখাবে।

**নোট:** Persistent Disk ছাড়া WhatsApp login/session ও অর্ডার ডেটা redeploy/restart-এ হারাতে পারে। Render-এর plan অনুযায়ী Disk সুবিধা ও খরচ যাচাই করুন।

## WhatsApp কমান্ড

- `menu` — মূল মেনু
- `add | নাম | ফোন | ঠিকানা | পণ্য | পরিমাণ | COD`
- `2` — সব অর্ডার
- `3` — Pending
- `4 ORDER-ID` — Confirm
- `5 ORDER-ID` — Steadfast booking
- `6 KEYWORD` — Search
- `7 | ORDER-ID | নাম | ফোন | ঠিকানা | পণ্য | পরিমাণ | COD` — Edit
- `8 ORDER-ID` — Cancel
- `9 ORDER-ID` — Return
- `10` — Report
- `11` — COD হিসাব
- `12` — Backup
- `13` — Activity Log

নতুন অর্ডারের উদাহরণ:
`add | Rahim | 017XXXXXXXX | ঢাকা, মিরপুর | Baby Set | 1 | 850`

## Steadfast
Steadfast বুকিংয়ের আগে আপনার Merchant API Key ও Secret Key Render Environment Variables-এ যোগ করুন। আসল Key কখনো GitHub বা ZIP-এ রাখবেন না। API response-এ পরিবর্তন হলে booking response parsing সামঞ্জস্য করতে হতে পারে। প্রথমে অল্প/টেস্ট অর্ডার দিয়ে যাচাই করুন।

## Security
- `ADMIN_NUMBER` অবশ্যই আপনার নিজের নম্বর দিন।
- `.env` কখনো GitHub-এ আপলোড করবেন না।
- Dashboard password দিন।
- এই সফটওয়্যার কাস্টমারকে মেসেজ পাঠায় না; কেবল Admin-এর সাথে কাজ করে।
- WhatsApp Web automation অনানুষ্ঠানিক; WhatsApp-এর নীতিমালা ও অ্যাকাউন্ট-ঝুঁকি বিবেচনা করুন।
