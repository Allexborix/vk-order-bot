const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ADMIN_ID = "252564307";

const VK_TOKEN = process.env.VK_TOKEN;
const VK_SECRET = process.env.VK_SECRET;
const VK_CONFIRMATION_CODE = process.env.VK_CONFIRMATION_CODE;

const users = {};

app.get("/", (req, res) => {
  res.send("VK Order Bot is running!");
});

async function vkMethod(method, params = {}) {
  const body = new URLSearchParams();

  body.append("access_token", VK_TOKEN);
  body.append("v", "5.199");

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      body.append(key, String(value));
    }
  }

  const response = await fetch(`https://api.vk.com/method/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const result = await response.json();

  if (result.error) {
    console.error(`VK API error (${method}):`, result.error);
  }

  return result;
}

async function sendMessage(userId, message, keyboard = null, attachment = null) {
  const params = {
    user_id: userId,
    message,
    random_id: Math.floor(Math.random() * 2147483647)
  };

  if (keyboard) {
    params.keyboard = JSON.stringify(keyboard);
  }

  if (attachment) {
    params.attachment = attachment;
  }

  const result = await vkMethod("messages.send", params);

  console.log("VK messages.send:", result.response ?? result.error ?? result);

  return result;
}

async function uploadClientPhoto(photoUrl) {
  if (!photoUrl) return null;

  try {
    console.log("Скачиваем фото клиента...");

    const photoResponse = await fetch(photoUrl);

    if (!photoResponse.ok) {
      throw new Error(`Не удалось скачать фото: HTTP ${photoResponse.status}`);
    }

    const arrayBuffer = await photoResponse.arrayBuffer();

    const uploadServer = await vkMethod("photos.getMessagesUploadServer");

    if (!uploadServer.response?.upload_url) {
      throw new Error("VK не вернул upload_url");
    }

    const form = new FormData();

    const blob = new Blob([arrayBuffer], {
      type: photoResponse.headers.get("content-type") || "image/jpeg"
    });

    form.append("photo", blob, "order-photo.jpg");

    console.log("Загружаем фото в VK...");

    const uploadResponse = await fetch(uploadServer.response.upload_url, {
      method: "POST",
      body: form
    });

    const uploadResult = await uploadResponse.json();

    if (!uploadResult.server || !uploadResult.photo || !uploadResult.hash) {
      console.error("Ответ загрузки фото:", uploadResult);
      throw new Error("VK не принял загруженную фотографию");
    }

    const saveResult = await vkMethod("photos.saveMessagesPhoto", {
      server: uploadResult.server,
      photo: uploadResult.photo,
      hash: uploadResult.hash
    });

    if (!saveResult.response?.[0]) {
      throw new Error("VK не вернул сохранённую фотографию");
    }

    const savedPhoto = saveResult.response[0];
    const attachment = `photo${savedPhoto.owner_id}_${savedPhoto.id}`;

    console.log("Фото успешно сохранено:", attachment);

    return attachment;
  } catch (error) {
    console.error("Ошибка обработки фотографии:", error);
    return null;
  }
}

function mainKeyboard() {
  return {
    one_time: false,
    buttons: [
      [{
        action: { type: "text", label: "🐾 Фигурка питомца" },
        color: "primary"
      }],
      [{
        action: { type: "text", label: "🎀 Брелок / подвеска" },
        color: "primary"
      }],
      [{
        action: { type: "text", label: "💍 Украшение" },
        color: "primary"
      }],
      [{
        action: { type: "text", label: "✨ Своя идея" },
        color: "positive"
      }]
    ]
  };
}

function cancelKeyboard() {
  return {
    one_time: false,
    buttons: [[{
      action: { type: "text", label: "❌ Отменить заказ" },
      color: "negative"
    }]]
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
      [{
        action: { type: "text", label: "❌ Отменить заказ" },
        color: "negative"
      }]
    ]
  };
}


function adminOrderKeyboard(orderId) {
  return {
    one_time: false,
    inline: true,
    buttons: [
      [
        {
          action: {
            type: "callback",
            label: "🟢 Принять заказ",
            payload: JSON.stringify({
              command: "accept_order",
              order_id: orderId
            })
          },
          color: "positive"
        },
        {
          action: {
            type: "callback",
            label: "🔴 Отклонить",
            payload: JSON.stringify({
              command: "reject_order",
              order_id: orderId
            })
          },
          color: "negative"
        }
      ],
      [
        {
          action: {
            type: "callback",
            label: "💬 Связаться с клиентом",
            payload: JSON.stringify({
              command: "contact_client",
              order_id: orderId
            })
          },
          color: "primary"
        }
      ]
    ]
  };
}

async function answerCallbackEvent(eventId, text) {
  if (!eventId) return;

  await vkMethod("messages.sendMessageEventAnswer", {
    event_id: eventId,
    user_id: ADMIN_ID,
    peer_id: ADMIN_ID,
    event_data: JSON.stringify({
      type: "show_snackbar",
      text
    })
  });
}

async function startOrder(userId, type) {
  users[userId] = {
    step: "photo",
    type,
    photo: null,
    quantity: null,
    details: null,
    name: null,
    contact: null
  };

  await sendMessage(
    userId,
    `Отличный выбор! 🧡\n\nВы выбрали:\n${type}\n\n📸 Теперь отправьте фотографию или пример того, что хотите получить.\n\nЕсли фото не требуется — просто напишите «без фото».`,
    cancelKeyboard()
  );
}

function getBestPhotoUrl(message) {
  if (!Array.isArray(message?.attachments)) return null;

  const photoAttachment = message.attachments.find(
    attachment => attachment?.type === "photo" && attachment.photo
  );

  if (!photoAttachment) return null;

  const photo = photoAttachment.photo;

  if (Array.isArray(photo.sizes) && photo.sizes.length > 0) {
    const sorted = [...photo.sizes].sort(
      (a, b) => (b.width * b.height) - (a.width * a.height)
    );

    return sorted[0]?.url || null;
  }

  return photo.orig_photo?.url || null;
}


const orders = {};

function makeOrderId() {
  return `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

app.post("/callback", async (req, res) => {
  const data = req.body;

  console.log("Получено событие:", data.type);

  if (data.type === "confirmation") {
    return res.send(VK_CONFIRMATION_CODE);
  }

  if (VK_SECRET && data.secret !== VK_SECRET) {
    console.log("Неверный secret");
    return res.status(403).send("forbidden");
  }

  // Нажатия inline-кнопок администратором
  if (data.type === "message_event") {
    try {
      let payload = data.object?.payload;

      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          payload = {};
        }
      }

      const orderId = payload?.order_id;
      const command = payload?.command;
      const order = orderId ? orders[orderId] : null;

      if (!order) {
        await answerCallbackEvent(data.event_id, "Заявка уже обработана или не найдена");
        return res.send("ok");
      }

      if (command === "accept_order") {
        order.status = "Принят";

        await sendMessage(
          order.userId,
          "🧡 Ваш заказ принят!\n\nМы начинаем его подготовку. Скоро свяжемся с вами, чтобы обсудить детали и стоимость."
        );

        await sendMessage(
          ADMIN_ID,
          `🟢 Заказ ${orderId} принят.\n\nКлиент: ${order.name}\nИзделие: ${order.type}`
        );

        await answerCallbackEvent(data.event_id, "Заказ принят 🟢");
      }

      if (command === "reject_order") {
        order.status = "Отклонён";

        await sendMessage(
          order.userId,
          "Спасибо за обращение 🧡\n\nК сожалению, сейчас мы не можем принять этот заказ.\n\nЕсли обстоятельства изменятся — будем рады вашему обращению."
        );

        await sendMessage(
          ADMIN_ID,
          `🔴 Заказ ${orderId} отклонён.\n\nКлиент: ${order.name}\nИзделие: ${order.type}`
        );

        await answerCallbackEvent(data.event_id, "Заказ отклонён 🔴");
      }

      if (command === "contact_client") {
        order.status = order.status || "Новая";

        await answerCallbackEvent(
          data.event_id,
          `VK ID клиента: ${order.userId}`
        );

        await sendMessage(
          ADMIN_ID,
          `💬 Клиент для связи:\n\n👤 ${order.name}\n🔗 VK ID: ${order.userId}\n\nОткройте диалог с клиентом в сообществе.`
        );
      }

      return res.send("ok");
    } catch (error) {
      console.error("Ошибка обработки кнопки:", error);
      return res.send("ok");
    }
  }

  if (data.type !== "message_new") {
    return res.send("ok");
  }

  try {
    const message = data.object?.message || data.object;
    const userId = message.from_id;
    const text = (message.text || "").trim();

    console.log(
      "Новое сообщение:",
      userId,
      text,
      "attachments:",
      Array.isArray(message.attachments) ? message.attachments.length : 0
    );

    if (text === "❌ Отменить заказ") {
      delete users[userId];

      await sendMessage(
        userId,
        "Заказ отменён ❌\n\nЕсли захотите оформить заказ — просто напишите мне снова 🧡",
        mainKeyboard()
      );

      return res.send("ok");
    }

    if (!users[userId]) {
      users[userId] = { step: "type" };

      await sendMessage(
        userId,
        "Привет! 🧡\n\nДобро пожаловать в нашу мастерскую ручной работы!\n\nМы создаём фигурки питомцев, брелоки, украшения и воплощаем индивидуальные идеи ✨\n\nЧто хотите заказать?",
        mainKeyboard()
      );

      return res.send("ok");
    }

    const user = users[userId];

    if (user.step === "type") {
      if (text.includes("Фигурка питомца")) {
        await startOrder(userId, "🐾 Фигурка домашнего питомца");
      } else if (text.includes("Брелок")) {
        await startOrder(userId, "🎀 Брелок / подвеска");
      } else if (text.includes("Украшение")) {
        await startOrder(userId, "💍 Украшение");
      } else if (text.includes("Своя идея")) {
        await startOrder(userId, "✨ Индивидуальный заказ");
      } else {
        await sendMessage(
          userId,
          "Пожалуйста, выберите вариант ниже 👇",
          mainKeyboard()
        );
      }

      return res.send("ok");
    }

    if (user.step === "photo") {
      const photoUrl = getBestPhotoUrl(message);

      if (photoUrl) {
        console.log("Фото найдено. Загружаем его в VK...");

        const savedAttachment = await uploadClientPhoto(photoUrl);

        if (savedAttachment) {
          user.photo = savedAttachment;
          user.step = "quantity";

          await sendMessage(
            userId,
            "Фото получила! 📸✨\n\nСколько изделий вы хотите заказать?",
            quantityKeyboard()
          );
        } else {
          await sendMessage(
            userId,
            "Я увидела фотографию, но не смогла сохранить её 😔\n\nПопробуйте отправить фото ещё раз.",
            cancelKeyboard()
          );
        }
      } else if (
        text.toLowerCase() === "без фото" ||
        text.toLowerCase() === "без фотографии"
      ) {
        user.photo = null;
        user.step = "quantity";

        await sendMessage(
          userId,
          "Хорошо 😊\n\nСколько изделий вы хотите заказать?",
          quantityKeyboard()
        );
      } else {
        await sendMessage(
          userId,
          "Мне нужна фотография или пример изделия 📸\n\nЕсли фотография не нужна — напишите «без фото».",
          cancelKeyboard()
        );
      }

      return res.send("ok");
    }

    if (user.step === "quantity") {
      if (["1", "2", "3", "4", "5+"].includes(text)) {
        user.quantity = text;
        user.step = "details";

        await sendMessage(
          userId,
          "Отлично! ✨\n\nТеперь расскажите подробнее о заказе 💭\n\nКакой цвет, размер, оформление или другие пожелания вы хотите?",
          cancelKeyboard()
        );
      } else {
        await sendMessage(
          userId,
          "Пожалуйста, выберите количество кнопкой ниже 👇",
          quantityKeyboard()
        );
      }

      return res.send("ok");
    }

    if (user.step === "details") {
      user.details = text;
      user.step = "name";

      await sendMessage(
        userId,
        "Почти готово 🧡\n\nКак вас зовут?",
        cancelKeyboard()
      );

      return res.send("ok");
    }

    if (user.step === "name") {
      user.name = text;
      user.step = "contact";

      await sendMessage(
        userId,
        "И последний вопрос 😊\n\nОставьте удобный способ связи: VK, телефон или Telegram.",
        cancelKeyboard()
      );

      return res.send("ok");
    }

    if (user.step === "contact") {
      user.contact = text;

      const orderId = makeOrderId();

      orders[orderId] = {
        userId,
        type: user.type,
        quantity: user.quantity,
        details: user.details,
        name: user.name,
        contact: user.contact,
        photo: user.photo,
        status: "Новая",
        createdAt: new Date().toISOString()
      };

      const orderText =
        `🆕 НОВАЯ ЗАЯВКА\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `🆔 Заказ: ${orderId}\n\n` +
        `📦 Изделие:\n${user.type}\n\n` +
        `🔢 Количество:\n${user.quantity}\n\n` +
        `💬 Пожелания:\n${user.details || "Не указаны"}\n\n` +
        `👤 Имя:\n${user.name}\n\n` +
        `📱 Контакт:\n${user.contact}\n\n` +
        `🔗 VK ID клиента:\n${userId}\n\n` +
        `📌 Статус: Новая\n\n` +
        `━━━━━━━━━━━━━━━━━━`;

      await sendMessage(
        ADMIN_ID,
        orderText,
        adminOrderKeyboard(orderId)
      );

      if (user.photo) {
        const photoResult = await sendMessage(
          ADMIN_ID,
          "📸 Фото / пример к заказу:",
          null,
          user.photo
        );

        console.log("Результат отправки фото админу:", photoResult);
      }

      await sendMessage(
        userId,
        "🎉 Спасибо! Ваша заявка отправлена!\n\nМы всё получили и скоро свяжемся с вами, чтобы обсудить детали и стоимость 🧡\n\nЕсли захотите оформить ещё один заказ — просто напишите нам.",
        mainKeyboard()
      );

      delete users[userId];

      return res.send("ok");
    }

    return res.send("ok");
  } catch (error) {
    console.error("Ошибка обработки сообщения:", error);
    return res.send("ok");
  }
});

app.listen(PORT, () => {
  console.log(`VK Order Bot запущен на порту ${PORT}`);
});
