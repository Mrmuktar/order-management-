require("dotenv").config();

const express = require("express");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const ADMIN = String(process.env.ADMIN_NUMBER || "").replace(/\D/g, "");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const AUTH_DIR = path.join(DATA_DIR, "whatsapp-auth");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const LOG_FILE = path.join(DATA_DIR, "activity.json");
const logger = pino({ level: process.env.LOG_LEVEL || "info" });

let sock;
let latestQR = "";
let connectionState = "Starting";
let pairingMessage = "সার্ভার চালু হচ্ছে…";
let reconnectTimer;

function ensureStorage() {
  // Create only inside the configured writable data directory.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]");
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "[]");
}
function readJSON(file, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJSON(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function orders() { return readJSON(ORDERS_FILE, []); }
function saveOrders(data) { writeJSON(ORDERS_FILE, data); }
function logAction(action, detail = "") {
  const logs = readJSON(LOG_FILE, []);
  logs.unshift({ at: new Date().toISOString(), action, detail });
  writeJSON(LOG_FILE, logs.slice(0, 1000));
}
function jidToNumber(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}
function isAdminJid(jid) {
  return !!ADMIN && jidToNumber(jid) === ADMIN;
}
function money(n) {
  return Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 });
}
function nextId(list) {
  return "BW-" + String(Date.now()).slice(-8) + "-" + String(list.length + 1).padStart(3, "0");
}
function menuText() {
  return `🎀 *BABY WORLD BD*
👑 *PRIVATE ADMIN ORDER DESK*

স্বাগতম! এটি শুধু আপনার ব্যক্তিগত অর্ডার ম্যানেজমেন্ট প্যানেল।
কাস্টমারদের কোনো অটো-মেসেজ পাঠানো হয় না।

━━━━━━━━━━━━━━━━━━
🛒 *1. Add Order* — অর্ডার এন্ট্রি
📦 *2. All Orders* — সব অর্ডার
⏳ *3. Pending* — অপেক্ষমাণ
✅ *4. Confirm* — কনফার্ম
🚚 *5. Steadfast* — কুরিয়ার বুকিং
🔎 *6. Search* — খুঁজুন
✏️ *7. Edit* — পরিবর্তন
❌ *8. Cancel* — বাতিল
↩️ *9. Return* — রিটার্ন
📊 *10. Report* — রিপোর্ট
💰 *11. COD হিসাব* — পেমেন্ট হিসাব
💾 *12. Backup* — ডেটা সংরক্ষণ
📜 *13. Activity Log* — কার্যক্রম লগ
━━━━━━━━━━━━━━━━━━

কাজ শুরু করতে নিচের কমান্ড পাঠান:
*1* = নতুন অর্ডার
*2* = সব অর্ডার
*3* = Pending
*4 ORDER-ID = Confirm
*5 ORDER-ID = Steadfast বুকিং
*6 KEYWORD = Search
*7 ORDER-ID = Edit
*8 ORDER-ID = Cancel
*9 ORDER-ID = Return
*10 = Report
*11 = COD হিসাব
*12 = Backup
*13 = Activity Log

নতুন অর্ডার: 
*add | নাম | ফোন | ঠিকানা | পণ্য | পরিমাণ | COD টাকা*

উদাহরণ:
add | Rahim | 017XXXXXXXX | ঢাকা | Baby Set | 1 | 850`;
}
async function sendAdmin(text) {
  if (!sock || !ADMIN) return;
  await sock.sendMessage(`${ADMIN}@s.whatsapp.net`, { text });
}
function helpForEdit() {
  return "✏️ Edit format:\nedit | ORDER-ID | নাম | ফোন | ঠিকানা | পণ্য | পরিমাণ | COD";
}
async function steadfastBooking(order) {
  const key = process.env.STEADFAST_API_KEY;
  const secret = process.env.STEADFAST_SECRET_KEY;
  if (!key || !secret) throw new Error("Steadfast API Key/Secret Key .env-এ সেট করা হয়নি।");
  const base = (process.env.STEADFAST_BASE_URL || "https://portal.steadfast.com.bd/api/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/create_order`, {
    method: "POST",
    headers: {
      "Api-Key": key,
      "Secret-Key": secret,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      invoice: order.id,
      recipient_name: order.name,
      recipient_phone: order.phone,
      recipient_address: order.address,
      cod_amount: Number(order.cod || 0),
      note: `Baby World BD ${order.product || ""}`.trim()
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Steadfast API error: HTTP ${response.status}`);
  return data;
}
async function handleAdminMessage(text) {
  const raw = String(text || "").trim();
  if (!raw) return;
  const [first, ...rest] = raw.split("|").map(x => x.trim());
  const cmd = first.toLowerCase();

  if (["menu", "start", "/start", "help", "হোম"].includes(cmd)) {
    await sendAdmin(menuText());
    return;
  }
  if (cmd === "add" || cmd === "1") {
    if (rest.length < 6) {
      await sendAdmin("🛒 *নতুন অর্ডার এন্ট্রি*\nএই ফরম্যাটে পাঠান:\nadd | নাম | ফোন | ঠিকানা | পণ্য | পরিমাণ | COD টাকা");
      return;
    }
    const list = orders();
    const [name, phone, address, product, qty, cod] = rest;
    const order = {
      id: nextId(list), name, phone, address, product,
      qty: Number(qty) || 1, cod: Number(cod) || 0,
      status: "Pending", createdAt: new Date().toISOString()
    };
    list.unshift(order); saveOrders(list); logAction("ADD_ORDER", order.id);
    await sendAdmin(`✅ *অর্ডার এন্ট্রি সম্পন্ন*\nঅর্ডার আইডি: *${order.id}*\nনাম: ${name}\nফোন: ${phone}\nঠিকানা: ${address}\nপণ্য: ${product}\nপরিমাণ: ${order.qty}\nCOD: ৳${money(order.cod)}\n\nকাস্টমারকে কোনো মেসেজ পাঠানো হয়নি।`);
    return;
  }
  if (cmd === "2" || cmd === "all" || cmd === "orders") {
    const list = orders();
    await sendAdmin(list.length ? "📦 *সর্বশেষ অর্ডারগুলো*\n\n" + list.slice(0, 25).map(o => `${o.id} · ${o.name} · ${o.phone}\n${o.status} · ৳${money(o.cod)}`).join("\n\n") : "এখনো কোনো অর্ডার নেই।");
    return;
  }
  if (cmd === "3" || cmd === "pending") {
    const list = orders().filter(o => o.status === "Pending");
    await sendAdmin(list.length ? "⏳ *Pending Orders*\n\n" + list.map(o => `${o.id} · ${o.name} · ${o.phone} · ৳${money(o.cod)}`).join("\n") : "কোনো Pending অর্ডার নেই।");
    return;
  }
  if (cmd === "4" || cmd === "confirm") {
    const id = rest[0] || raw.split(/\s+/)[1];
    const list = orders(); const o = list.find(x => x.id === id);
    if (!o) return sendAdmin("অর্ডার আইডি পাওয়া যায়নি।");
    o.status = "Confirmed"; o.updatedAt = new Date().toISOString();
    saveOrders(list); logAction("CONFIRM", id);
    return sendAdmin(`✅ *অর্ডার কনফার্ম হয়েছে*\n${id}\n${o.name} · ${o.phone}\nCOD: ৳${money(o.cod)}\n\nএটি শুধু Admin confirmation; কাস্টমারকে মেসেজ পাঠানো হয়নি।`);
  }
  if (cmd === "5" || cmd === "steadfast" || cmd === "booking") {
    const id = rest[0] || raw.split(/\s+/)[1];
    const list = orders(); const o = list.find(x => x.id === id);
    if (!o) return sendAdmin("অর্ডার আইডি পাওয়া যায়নি।");
    try {
      const result = await steadfastBooking(o);
      o.status = "Booked"; o.courier = "Steadfast";
      o.consignmentId = result.consignment?.consignment_id || result.consignment_id || "";
      o.trackingCode = result.consignment?.tracking_code || result.tracking_code || "";
      saveOrders(list); logAction("STEADFAST_BOOKING", id);
      return sendAdmin(`🚚 *Steadfast Booking সফল*\nঅর্ডার: ${id}\nConsignment: ${o.consignmentId || "API response দেখুন"}\nTracking: ${o.trackingCode || "N/A"}\n\nকাস্টমারকে কোনো মেসেজ পাঠানো হয়নি।`);
    } catch (e) { return sendAdmin(`❌ Steadfast Booking ব্যর্থ:\n${e.message}`); }
  }
  if (cmd === "6" || cmd === "search") {
    const q = (rest.join(" ") || raw.split(/\s+/).slice(1).join(" ")).toLowerCase();
    if (!q) return sendAdmin("🔎 Search format:\n6 KEYWORD অথবা search | নাম/ফোন/Order ID");
    const found = orders().filter(o => [o.id,o.name,o.phone,o.address,o.product].some(v => String(v || "").toLowerCase().includes(q)));
    return sendAdmin(found.length ? "🔎 *Search Result*\n\n" + found.slice(0, 20).map(o => `${o.id} · ${o.name} · ${o.phone}\n${o.status} · ৳${money(o.cod)}`).join("\n\n") : "কোনো অর্ডার পাওয়া যায়নি।");
  }
  if (cmd === "7" || cmd === "edit") {
    if (rest.length < 7) return sendAdmin(helpForEdit());
    const [id,name,phone,address,product,qty,cod] = rest;
    const list = orders(); const o = list.find(x => x.id === id);
    if (!o) return sendAdmin("অর্ডার আইডি পাওয়া যায়নি।");
    Object.assign(o, { name, phone, address, product, qty: Number(qty)||1, cod: Number(cod)||0, updatedAt: new Date().toISOString() });
    saveOrders(list); logAction("EDIT", id); return sendAdmin(`✏️ ${id} আপডেট হয়েছে।`);
  }
  if (["8","cancel","cance"].includes(cmd) || ["9","return"].includes(cmd)) {
    const id = rest[0] || raw.split(/\s+/)[1];
    const list = orders(); const o = list.find(x => x.id === id);
    if (!o) return sendAdmin("অর্ডার আইডি পাওয়া যায়নি।");
    o.status = (cmd === "9" || cmd === "return") ? "Returned" : "Cancelled";
    o.updatedAt = new Date().toISOString(); saveOrders(list);
    logAction(o.status.toUpperCase(), id);
    return sendAdmin(`✅ ${id} → ${o.status}`);
  }
  if (cmd === "10" || cmd === "report") {
    const list = orders();
    const total = list.reduce((s,o)=>s+Number(o.cod||0),0);
    const count = status => list.filter(o=>o.status===status).length;
    return sendAdmin(`📊 *Baby World BD Report*\nমোট অর্ডার: ${list.length}\nPending: ${count("Pending")}\nConfirmed: ${count("Confirmed")}\nBooked: ${count("Booked")}\nCancelled: ${count("Cancelled")}\nReturned: ${count("Returned")}\nমোট COD: ৳${money(total)}`);
  }
  if (cmd === "11" || cmd === "cod") {
    const list = orders().filter(o => !["Cancelled","Returned"].includes(o.status));
    const total = list.reduce((s,o)=>s+Number(o.cod||0),0);
    return sendAdmin(`💰 *COD হিসাব*\nসক্রিয় অর্ডার: ${list.length}\nমোট সম্ভাব্য COD: ৳${money(total)}\n\nএটি অর্ডারভিত্তিক হিসাব; কুরিয়ার settlement নয়।`);
  }
  if (cmd === "12" || cmd === "backup") {
    const list = orders();
    const stamp = new Date().toISOString();
    const backupPath = path.join(DATA_DIR, `backup-${stamp.replace(/[:.]/g,"-")}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ exportedAt: stamp, orders: list }, null, 2));
    logAction("BACKUP", path.basename(backupPath));
    return sendAdmin(`💾 Backup তৈরি হয়েছে:\n${path.basename(backupPath)}\nঅর্ডার: ${list.length}\nফাইলটি সার্ভারের Persistent Disk-এ সংরক্ষিত।`);
  }
  if (cmd === "13" || cmd === "activity" || cmd === "log") {
    const logs = readJSON(LOG_FILE, []);
    return sendAdmin(logs.length ? "📜 *সাম্প্রতিক Activity Log*\n\n" + logs.slice(0,20).map(x => `${new Date(x.at).toLocaleString("en-GB")} · ${x.action} · ${x.detail}`).join("\n") : "কোনো Activity নেই।");
  }
  await sendAdmin("কমান্ড বুঝতে পারিনি। *menu* লিখে মেনু দেখুন।");
}

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version, auth: state, logger: pino({ level: "silent" }),
    printQRInTerminal: false, browser: ["Baby World BD Admin Desk", "Chrome", "1.0.0"],
    markOnlineOnConnect: false, syncFullHistory: false
  });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      latestQR = await QRCode.toDataURL(qr);
      connectionState = "Scan QR";
      pairingMessage = "WhatsApp → Linked devices → Link a device → QR স্ক্যান করুন";
    }
    if (connection === "open") {
      latestQR = ""; connectionState = "Connected";
      pairingMessage = "WhatsApp Admin Desk সংযুক্ত হয়েছে।";
      logAction("WHATSAPP_CONNECTED");
      await sendAdmin(menuText());
    }
    if (connection === "close") {
      connectionState = "Disconnected";
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => startWhatsApp().catch(e => logger.error(e)), 4000);
      } else {
        pairingMessage = "WhatsApp থেকে লগআউট হয়েছে। Persistent Disk-এর auth data পরীক্ষা করুন।";
      }
    }
  });
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe || msg.key.remoteJid === "status@broadcast") continue;
      // Strict allowlist: ignore every non-admin sender silently.
      if (!isAdminJid(msg.key.remoteJid)) continue;
      const content = msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.buttonsResponseMessage?.selectedButtonId ||
        msg.message.listResponseMessage?.singleSelectReply?.selectedRowId || "";
      try { await handleAdminMessage(content); }
      catch (e) { logger.error(e); await sendAdmin(`⚠️ Error: ${e.message}`); }
    }
  });
}

function dashboardAuth(req, res, next) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return next();
  const supplied = req.headers["x-dashboard-password"] || req.query.password || req.body.password;
  if (supplied !== password) return res.status(401).send("Unauthorized — dashboard password required.");
  next();
}
app.get("/", dashboardAuth, (req,res) => res.type("html").send(`<!doctype html>
<html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Baby World BD · Admin Desk</title><style>
*{box-sizing:border-box}body{margin:0;background:linear-gradient(145deg,#101827,#172d42);font-family:system-ui;color:#f8fafc;min-height:100vh;padding:24px}
main{max-width:720px;margin:5vh auto;background:#ffffff12;border:1px solid #ffffff22;border-radius:28px;padding:28px;box-shadow:0 24px 80px #0006}
h1{font-size:clamp(24px,5vw,36px);margin:0 0 8px}.sub{color:#cbd5e1;margin-bottom:24px}
.status{padding:14px 18px;background:#ffffff12;border-radius:16px;margin:16px 0;color:#a7f3d0}
.qr{width:min(100%,360px);aspect-ratio:1;background:white;border-radius:22px;display:grid;place-items:center;margin:20px auto;overflow:hidden}
.qr img{width:100%;height:100%;object-fit:contain}.hint{color:#cbd5e1;line-height:1.8}
a{color:#93c5fd}.tag{display:inline-block;padding:6px 12px;border-radius:999px;background:#ffffff18;color:#a7f3d0;font-size:13px}
</style></head><body><main><span class="tag">PRIVATE · ADMIN ONLY</span><h1>🛍️ BABY WORLD BD</h1>
<div class="sub">WhatsApp Private Order Desk · Connection Panel</div>
<div class="status">● ${connectionState}<br>${pairingMessage}</div>
<div class="qr">${latestQR ? `<img src="${latestQR}" alt="WhatsApp QR Code">` : `<div style="color:#334155;font-size:20px">${connectionState === "Connected" ? "✓ Connected" : "QR তৈরি হচ্ছে…"}</div>`}</div>
<div class="hint">📱 WhatsApp → Linked devices → Link a device → QR স্ক্যান করুন।<br><br>সংযুক্ত হলে আপনার Admin WhatsApp-এ মেনু আসবে। কাস্টমারদের মেসেজ এই বট উপেক্ষা করবে।</div>
</main><script>setTimeout(()=>location.reload(),5000)</script></body></html>`));
app.get("/health", (req,res)=>res.json({ok:true,whatsapp:connectionState}));
app.get("/api/orders", dashboardAuth, (req,res)=>res.json(orders()));

ensureStorage();
app.listen(PORT, () => logger.info(`Baby World BD Admin Desk listening on ${PORT}`));
startWhatsApp().catch(err => logger.error(err));
