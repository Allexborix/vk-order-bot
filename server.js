const express = require("express");
const fs = require("fs");
const path = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const ADMIN_ID = "252564307";
const VK_TOKEN = process.env.VK_TOKEN;
const VK_SECRET = process.env.VK_SECRET;
const VK_CONFIRMATION_CODE = process.env.VK_CONFIRMATION_CODE;
const CRM_KEY = process.env.CRM_KEY || "change-me";
const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL;

let firebaseAdmin = null;

if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
) {
  try {
    firebaseAdmin = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      })
    });

    console.log("Firebase Admin initialized");
  } catch (e) {
    console.error("Firebase Admin init error:", e);
  }
} else {
  console.warn("Firebase Admin env vars not configured; push disabled");
}

const DB_FILE = path.join(__dirname, "orders.json");
const users = {};
const processedEvents = new Set();

let db = {
  orders: [],
  stats: {
    created: 0,
    accepted: 0,
    rejected: 0,
    completed: 0,
    revenue: 0
  }
};

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) { console.error("DB load:", e); }
}
function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (e) { console.error("DB save:", e); }
}
loadDb();

app.use("/admin", (req, res, next) => {
  if (req.path === "/login") return next();
  if (req.headers["x-crm-key"] === CRM_KEY || req.query.key === CRM_KEY) return next();
  return res.status(401).json({ error: "CRM key required" });
});

app.get("/", (req, res) => res.send("VK Order Bot 2.1 is running!"));
app.get("/admin/login", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/admin/data", (req, res) => res.json(db));

async function vkMethod(method, params = {}) {
  const body = new URLSearchParams();
  body.append("access_token", VK_TOKEN);
  body.append("v", "5.199");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.append(k, String(v));
  }
  const r = await fetch(`https://api.vk.com/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const result = await r.json();
  if (result.error) console.error(`VK ${method}:`, result.error);
  return result;
}

async function sendMessage(userId, message, keyboard = null, attachment = null) {
  const p = {
    user_id: userId,
    message,
    random_id: Math.floor(Math.random() * 2147483647)
  };
  if (keyboard) p.keyboard = JSON.stringify(keyboard);
  if (attachment) p.attachment = attachment;
  return vkMethod("messages.send", p);
}

async function uploadClientPhoto(photoUrl) {
  if (!photoUrl) return null;
  try {
    const r = await fetch(photoUrl);
    if (!r.ok) throw new Error(`photo HTTP ${r.status}`);

    const buf = await r.arrayBuffer();
    const server = await vkMethod("photos.getMessagesUploadServer");
    if (!server.response?.upload_url) throw new Error("no upload_url");

    const form = new FormData();
    form.append(
      "photo",
      new Blob([buf], { type: r.headers.get("content-type") || "image/jpeg" }),
      "order-photo.jpg"
    );

    const up = await fetch(server.response.upload_url, {
      method: "POST",
      body: form
    });
    const ur = await up.json();
    if (!ur.server || !ur.photo || !ur.hash) throw new Error("upload failed");

    const saved = await vkMethod("photos.saveMessagesPhoto", {
      server: ur.server,
      photo: ur.photo,
      hash: ur.hash
    });

    const p = saved.response?.[0];
    return p ? `photo${p.owner_id}_${p.id}` : null;
  } catch (e) {
    console.error("photo:", e);
    return null;
  }
}

/* Google Sheets:
   Если таблица недоступна, заказ всё равно сохраняется в локальной CRM.
*/
async function sendToGoogleSheets(action, order) {
  if (!GOOGLE_SHEETS_URL) {
    console.warn("GOOGLE_SHEETS_URL не задан — Google Sheets пропущен");
    return false;
  }

  try {
    const r = await fetch(GOOGLE_SHEETS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, order })
    });

    const text = await r.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { raw: text }; }

    if (!r.ok || result.success === false) {
      console.error("Google Sheets error:", r.status, result);
      return false;
    }

    console.log(`Google Sheets ${action}: OK`, order.id);
    return true;
  } catch (e) {
    console.error("Google Sheets connection error:", e.message);
    return false;
  }
}

function mainKeyboard() {
  return {
    one_time: false,
    buttons: [
      [{ action: { type: "text", label: "🐾 Фигурка питомца" }, color: "primary" }],
      [{ action: { type: "text", label: "🎀 Брелок / подвеска" }, color: "primary" }],
      [{ action: { type: "text", label: "💍 Украшение" }, color: "primary" }],
      [{ action: { type: "text", label: "✨ Своя идея" }, color: "positive" }]
    ]
  };
}

function cancelKeyboard() {
  return {
    one_time: false,
    buttons: [[
      { action: { type: "text", label: "❌ Отменить заказ" }, color: "negative" }
    ]]
  };
}

function quantityKeyboard() {
  return {
    one_time: true,
    buttons: [
      [
        { action: { type: "text", label: "1" }, color: "primary" },
        { action: { type: "text", label: "2" }, color: "primary" },
        { action: { type: "text", label: "3" }, color: "primary" }
      ],
      [
        { action: { type: "text", label: "4" }, color: "secondary" },
        { action: { type: "text", label: "5+" }, color: "secondary" }
      ],
      [
        { action: { type: "text", label: "❌ Отменить заказ" }, color: "negative" }
      ]
    ]
  };
}

function adminKeyboard(id) {
  return {
    one_time: false,
    inline: true,
    buttons: [
      [
        {
          action: {
            type: "callback",
            label: "🟢 Принять",
            payload: JSON.stringify({ command: "accept", order_id: id })
          },
          color: "positive"
        },
        {
          action: {
            type: "callback",
            label: "🔴 Отклонить",
            payload: JSON.stringify({ command: "reject", order_id: id })
          },
          color: "negative"
        }
      ],
      [
        {
          action: {
            type: "callback",
            label: "🔨 В работе",
            payload: JSON.stringify({ command: "status", status: "В работе", order_id: id })
          },
          color: "primary"
        },
        {
          action: {
            type: "callback",
            label: "✅ Готов",
            payload: JSON.stringify({ command: "status", status: "Готов", order_id: id })
          },
          color: "positive"
        }
      ],
      [
        {
          action: {
            type: "callback",
            label: "📦 Выдан",
            payload: JSON.stringify({ command: "status", status: "Выдан", order_id: id })
          },
          color: "secondary"
        }
      ]
    ]
  };
}

function makeId() {
  return `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function getPhotoUrl(message) {
  const a = Array.isArray(message?.attachments)
    ? message.attachments.find(x => x?.type === "photo" && x.photo)
    : null;
  if (!a) return null;

  const p = a.photo;
  if (Array.isArray(p.sizes) && p.sizes.length) {
    return [...p.sizes]
      .sort((x, y) => (y.width * y.height) - (x.width * x.height))[0].url;
  }
  return p.orig_photo?.url || null;
}

async function answerEvent(eventId, text) {
  if (!eventId) return;
  await vkMethod("messages.sendMessageEventAnswer", {
    event_id: eventId,
    user_id: ADMIN_ID,
    peer_id: ADMIN_ID,
    event_data: JSON.stringify({ type: "show_snackbar", text })
  });
}

function money(n) {
  return `${Number(n || 0).toLocaleString("ru-RU")} ₽`;
}

function findOrder(id) {
  return db.orders.find(o => o.id === id);
}

async function notifyStatus(order) {
  const messages = {
    "Принят": "🧡 Ваш заказ принят!\n\nМы свяжемся с вами для уточнения деталей и стоимости.",
    "В работе": "🔨 Ваш заказ перешёл в работу!\n\nМы уже занимаемся его изготовлением 🧡",
    "Готов": "✅ Ваш заказ готов!\n\nСкоро свяжемся с вами по получению 🧡",
    "Выдан": "📦 Заказ отмечен как выданный.\n\nСпасибо за заказ! Будем рады видеть вас снова 🧡",
    "Отклонён": "Спасибо за обращение 🧡\n\nК сожалению, сейчас мы не можем принять этот заказ."
  };
  if (messages[order.status]) await sendMessage(order.userId, messages[order.status]);
}

async function sendNewOrderPush(order) {
  if (!firebaseAdmin) {
    console.warn("FCM push пропущен: Firebase Admin не настроен");
    return;
  }

  try {
    const response = await getMessaging(firebaseAdmin).send({
      topic: "admin_orders",
      notification: {
        title: `🆕 Новый заказ #${order.id}`,
        body: `${order.name || "Новый клиент"} • ${order.type || "Заказ"}`
      },
      data: {
        orderId: String(order.id),
        status: String(order.status || "Новая")
      }
    });

    console.log("FCM push sent:", response);
  } catch (e) {
    console.error("FCM push error:", e);
  }
}

app.post("/callback", async (req, res) => {
  const data = req.body;
    if (data.type !== "confirmation" && data.event_id) {
    if (processedEvents.has(data.event_id)) {
      console.log("Повторное VK-событие пропущено:", data.event_id);
      return res.send("ok");
    }

    processedEvents.add(data.event_id);

    // Чтобы Set не рос бесконечно.
    if (processedEvents.size > 1000) {
      const firstEvent = processedEvents.values().next().value;
      processedEvents.delete(firstEvent);
    }
  }

  if (data.type === "confirmation") return res.send(VK_CONFIRMATION_CODE);
  if (VK_SECRET && data.secret !== VK_SECRET) return res.status(403).send("forbidden");

  try {
    if (data.type === "message_event") {
      let p = data.object?.payload;
      if (typeof p === "string") {
        try { p = JSON.parse(p); } catch { p = {}; }
      }

      const o = findOrder(p?.order_id);
      if (!o) {
        await answerEvent(data.event_id, "Заявка не найдена");
        return res.send("ok");
      }

      if (p.command === "accept") o.status = "Принят";
      else if (p.command === "reject") o.status = "Отклонён";
      else if (p.command === "status" && ["В работе", "Готов", "Выдан"].includes(p.status)) {
        o.status = p.status;
      } else {
        await answerEvent(data.event_id, "Неизвестная команда");
        return res.send("ok");
      }

      o.updatedAt = new Date().toISOString();

      if (o.status === "Принят") db.stats.accepted++;
      if (o.status === "Отклонён") db.stats.rejected++;
      if (o.status === "Выдан") db.stats.completed++;

      saveDb();

      // Обновляем статус и финансовые данные в Google Sheets.
      await sendToGoogleSheets("update", o);

      await notifyStatus(o);
      await answerEvent(data.event_id, `Статус: ${o.status}`);
      await sendMessage(
        ADMIN_ID,
        `📌 Заказ ${o.id}\nСтатус: ${o.status}\nКлиент: ${o.name}\nСумма: ${money(o.total)}`,
        adminKeyboard(o.id)
      );

      return res.send("ok");
    }

    if (data.type !== "message_new") return res.send("ok");

    const m = data.object?.message || data.object;
    const userId = m.from_id;
    const text = (m.text || "").trim();

    if (text === "❌ Отменить заказ") {
      delete users[userId];
      await sendMessage(
        userId,
        "Заказ отменён ❌\n\nЕсли захотите оформить заказ — напишите нам снова 🧡",
        mainKeyboard()
      );
      return res.send("ok");
    }

    if (!users[userId]) {
      users[userId] = { step: "type" };
      await sendMessage(
        userId,
        "Привет! 🧡\n\nДобро пожаловать в нашу мастерскую ручной работы!\n\nЧто хотите заказать?",
        mainKeyboard()
      );
      return res.send("ok");
    }

    const u = users[userId];

    if (u.step === "type") {
      const type =
        text.includes("Фигурка питомца") ? "🐾 Фигурка домашнего питомца" :
        text.includes("Брелок") ? "🎀 Брелок / подвеска" :
        text.includes("Украшение") ? "💍 Украшение" :
        text.includes("Своя идея") ? "✨ Индивидуальный заказ" : null;

      if (!type) {
        await sendMessage(userId, "Пожалуйста, выберите вариант ниже 👇", mainKeyboard());
      } else {
        u.type = type;
        u.step = "photo";
        await sendMessage(
          userId,
          `Отличный выбор! 🧡\n\n${type}\n\n📸 Отправьте фотографию или пример.\n\nЕсли фото не требуется — напишите «без фото».`,
          cancelKeyboard()
        );
      }
      return res.send("ok");
    }

    if (u.step === "photo") {
      const url = getPhotoUrl(m);

      if (url) {
        u.photo = await uploadClientPhoto(url);

        if (!u.photo) {
          await sendMessage(
            userId,
            "Не удалось сохранить фото 😔\n\nПопробуйте отправить его ещё раз.",
            cancelKeyboard()
          );
          return res.send("ok");
        }

        u.step = "quantity";
        await sendMessage(userId, "Фото получила! 📸✨\n\nСколько изделий?", quantityKeyboard());
      } else if (/^без фото$/i.test(text)) {
        u.photo = null;
        u.step = "quantity";
        await sendMessage(userId, "Хорошо 😊\n\nСколько изделий?", quantityKeyboard());
      } else {
        await sendMessage(
          userId,
          "Отправьте фотографию 📸 или напишите «без фото».",
          cancelKeyboard()
        );
      }
      return res.send("ok");
    }

    if (u.step === "quantity") {
      if (!["1", "2", "3", "4", "5+"].includes(text)) {
        await sendMessage(userId, "Выберите количество кнопкой 👇", quantityKeyboard());
        return res.send("ok");
      }

      u.quantity = text;
      u.step = "details";
      await sendMessage(
        userId,
        "Расскажите подробнее о заказе 💭\n\nЦвет, размер, оформление и другие пожелания.",
        cancelKeyboard()
      );
      return res.send("ok");
    }

    if (u.step === "details") {
      u.details = text;
      u.step = "name";
      await sendMessage(userId, "Как вас зовут?", cancelKeyboard());
      return res.send("ok");
    }

    if (u.step === "name") {
      u.name = text;
      u.step = "contact";
      await sendMessage(
        userId,
        "Оставьте удобный способ связи: VK, телефон или Telegram.",
        cancelKeyboard()
      );
      return res.send("ok");
    }

    if (u.step === "contact") {
      u.contact = text;
      u.step = "price";
      await sendMessage(
        userId,
        "Почти готово 🧡\n\nЕсли знаете желаемую стоимость/бюджет — напишите её. Если нет, напишите «не знаю».",
        cancelKeyboard()
      );
      return res.send("ok");
    }

    if (u.step === "price") {
      const parsed = Number(
        text.replace(/\s/g, "").replace(/[^\d.,]/g, "").replace(",", ".")
      );

      u.budget = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      u.step = "deadline";

      await sendMessage(
        userId,
        "📅 Когда примерно нужен заказ?\n\nНапример: «до 15 сентября» или «не срочно».",
        cancelKeyboard()
      );
      return res.send("ok");
    }

    if (u.step === "deadline") {
      const now = new Date().toISOString();

      const order = {
        id: makeId(),
        userId,
        type: u.type,
        photo: u.photo,
        quantity: u.quantity,
        details: u.details,
        name: u.name,
        contact: u.contact,
        budget: u.budget || 0,
        price: 0,
        prepayment: 0,
        total: 0,
        deadline: text,
        status: "Новая",
        createdAt: now,
        updatedAt: now
      };

      // Сначала сохраняем в локальную CRM.
     db.orders.unshift(order);
db.stats.created++;
saveDb();

// Отправляем push на Android.
await sendNewOrderPush(order);

// Затем отправляем тот же заказ в Google Sheets.

      // Затем отправляем тот же заказ в Google Sheets.
      // Если Google временно недоступен, VK-бот всё равно продолжит работать.
      await sendToGoogleSheets("append", order);

      const msg =
        `🆕 НОВАЯ ЗАЯВКА\n━━━━━━━━━━━━━━━━━━\n\n` +
        `🆔 ${order.id}\n📦 ${order.type}\n🔢 ${order.quantity}\n\n` +
        `💬 ${order.details || "Не указаны"}\n\n` +
        `👤 ${order.name}\n📱 ${order.contact}\n` +
        `💰 Бюджет: ${money(order.budget)}\n` +
        `📅 Срок: ${order.deadline}\n` +
        `📌 Статус: Новая`;

      await sendMessage(ADMIN_ID, msg, adminKeyboard(order.id));

      if (order.photo) {
        await sendMessage(ADMIN_ID, "📸 Фото / пример к заказу:", null, order.photo);
      }

      await sendMessage(
        userId,
        "🎉 Спасибо! Заявка отправлена!\n\nМы всё получили и скоро свяжемся с вами для уточнения стоимости и сроков 🧡",
        mainKeyboard()
      );

      delete users[userId];
      return res.send("ok");
    }

    return res.send("ok");
  } catch (e) {
    console.error("callback error:", e);
    return res.send("ok");
  }
});

app.post("/admin/order/:id", async (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return res.status(404).json({ error: "not found" });

  const allowed = ["Новая", "Принят", "В работе", "Готов", "Выдан", "Отклонён"];

  if (req.body.status && allowed.includes(req.body.status)) {
    o.status = req.body.status;
  }

  for (const k of ["price", "prepayment", "total", "deadline"]) {
    if (req.body[k] !== undefined) o[k] = req.body[k];
  }

  o.updatedAt = new Date().toISOString();

  if (o.total) {
    db.stats.revenue = db.orders.reduce((s, x) => s + Number(x.total || 0), 0);
  }

  saveDb();

  // Любое изменение из CRM синхронизируем с Google Sheets.
  await sendToGoogleSheets("update", o);

  if (req.body.status) await notifyStatus(o);

  res.json(o);
});

app.listen(PORT, () => console.log(`VK Order Bot 2.1 запущен на порту ${PORT}`));
