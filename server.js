from pathlib import Path

code = r'''const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const ADMIN_ID = "252564307";

const VK_TOKEN = process.env.VK_TOKEN;
const VK_SECRET = process.env.VK_SECRET;
const VK_CONFIRMATION_CODE = process.env.VK_CONFIRMATION_CODE;

// Состояния пользователей
const users = {};

// =========================
// Главная
// =========================

app.get("/", (req, res) => {
  res.send("VK Order Bot is running!");
});

// =========================
// Запрос к VK API
// =========================

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

// =========================
// Отправка сообщения
// =========================

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

// =========================
// Загрузка фото клиента в VK
// =========================
// Фото загружается сразу после получения.
// Поэтому даже если клиент будет заполнять заказ несколько минут,
// нам не нужно хранить временный URL фотографии.

async function uploadClientPhoto(photoUrl) {
  if (!photoUrl) {
    return null;
  }

  try {
    console.log("Скачиваем фото клиента...");

    const photoResponse = await fetch(photoUrl);

    if (!photoResponse.ok) {
      throw new Error(
        `Не удалось скачать фото: HTTP ${photoResponse.status}`
      );
    }

    const arrayBuffer = await photoResponse.arrayBuffer();

    // Получаем сервер загрузки фотографий в сообщения
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

    const uploadResponse = await fetch(
      uploadServer.response.upload_url,
      {
        method: "POST",
        body: form
      }
    );

    const uploadResult = await uploadResponse.json();

    if (!uploadResult.server || !uploadResult.photo || !uploadResult.hash) {
      console.error("Ответ загрузки фото:", uploadResult);
      throw new Error("VK не принял загруженную фотографию");
    }

    // Сохраняем загруженное фото
    const saveResult = await vkMethod("photos.saveMessagesPhoto", {
      server: uploadResult.server,
      photo: uploadResult.photo,
      hash: uploadResult.hash
    });

    if (!saveResult.response || !saveResult.response[0]) {
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

// =========================
// Главное меню
// =========================

function mainKeyboard() {
  return {
    one_time: false,
    buttons: [
      [
        {
          action: {
            type: "text",
            label: "🐾 Фигурка питомца"
          },
          color: "primary"
        }
      ],
      [
        {
          action: {
            type: "text",
            label: "🎀 Брелок / подвеска"
          },
          color: "primary"
        }
      ],
      [
        {
          action: {
            type: "text",
            label: "💍 Украшение"
          },
          color: "primary"
        }
      ],
      [
        {
          action: {
            type: "text",
            label: "✨ Своя идея"
          },
          color: "positive"
        }
      ]
    ]
  };
}

// =========================
// Клавиатура отмены
// =========================

function cancelKeyboard() {
  return {
    one_time: false,
    buttons: [
      [
        {
          action: {
            type: "text",
            label: "❌ Отменить заказ"
          },
          color: "negative"
        }
      ]
    ]
  };
}

// =========================
// Количество
// =========================

function quantityKeyboard() {
  return {
    one_time: true,
    buttons: [
      [
        {
          action: {
            type: "text",
            label: "1"
          },
          color: "primary"
        },
        {
          action: {
            type: "text",
            label: "2"
          },
          color: "primary"
        },
        {
          action: {
            type: "text",
            label: "3"
          },
          color: "primary"
        }
      ],
      [
        {
          action: {
            type: "text",
            label: "4"
          },
          color: "secondary"
        },
        {
          action: {
            type: "text",
            label: "5+"
          },
          color: "secondary"
        }
      ],
      [
        {
          action: {
            type: "text",
            label: "❌ Отменить заказ"
          },
          color: "negative"
        }
      ]
    ]
  };
}

// =========================
// Начало заказа
// =========================

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

// =========================
// Получение URL лучшего размера фото
// =========================

function getBestPhotoUrl(message) {
  if (!message?.attachments || !Array.isArray(message.attachments)) {
    return null;
  }

  const photoAttachment = message.attachments.find(
    attachment =>
      attachment &&
      attachment.type === "photo" &&
      attachment.photo
  );

  if (!photoAttachment) {
    return null;
  }

  const photo = photoAttachment.photo;

  // Современный формат VK: массив sizes
  if (Array.isArray(photo.sizes) && photo.sizes.length > 0) {
    const sorted = [...photo.sizes].sort((a, b) => {
      return (b.width * b.height) - (a.width * a.height);
    });

    return sorted[0]?.url || null;
  }

  // Запасной вариант для старого формата
  if (photo.orig_photo?.url) {
    return photo.orig_photo.url;
  }

  return null;
}

// =========================
// Callback API
// =========================

app.post("/callback", async (req, res) => {
  const data = req.body;

  console.log("Получено событие:", data.type);

  // Подтверждение сервера
  if (data.type === "confirmation") {
    console.log("Отправляем confirmation code");
    return res.send(VK_CONFIRMATION_CODE);
  }

  // Проверка secret
  if (VK_SECRET && data.secret !== VK_SECRET) {
    console.log("Неверный secret");
    return res.status(403).send("forbidden");
  }

  if (data.type !== "message_new") {
    return res.send("ok");
  }

  try {
    // В Callback API VK сообщение находится внутри object.message
    const message = data.object?.message || data.object;

    const userId = message.from_id;
    const text = (message.text || "").trim();

    console.log(
      "Новое сообщение:",
      userId,
      text,
      "attachments:",
      Array.isArray(message.attachments)
        ? message.attachments.length
        : 0
    );

    // =========================
    // Отмена заказа
    // =========================

    if (text === "❌ Отменить заказ") {
      delete users[userId];

      await sendMessage(
        userId,
        "Заказ отменён ❌\n\nЕсли захотите оформить заказ — просто напишите мне снова 🧡",
        mainKeyboard()
      );

      return res.send("ok");
    }

    // =========================
    // Новый пользователь
    // =========================

    if (!users[userId]) {
      users[userId] = {
        step: "type"
      };

      await sendMessage(
        userId,
        "Привет! 🧡\n\nДобро пожаловать в нашу мастерскую ручной работы!\n\nМы создаём фигурки питомцев, брелоки, украшения и воплощаем индивидуальные идеи ✨\n\nЧто хотите заказать?",
        mainKeyboard()
      );

      return res.send("ok");
    }

    const user = users[userId];

    // =========================
    // Выбор изделия
    // =========================

    if (user.step === "type") {
      if (text.includes("Фигурка питомца")) {
        await startOrder(
          userId,
          "🐾 Фигурка домашнего питомца"
        );
      } else if (text.includes("Брелок")) {
        await startOrder(
          userId,
          "🎀 Брелок / подвеска"
        );
      } else if (text.includes("Украшение")) {
        await startOrder(
          userId,
          "💍 Украшение"
        );
      } else if (text.includes("Своя идея")) {
        await startOrder(
          userId,
          "✨ Индивидуальный заказ"
        );
      } else {
        await sendMessage(
          userId,
          "Пожалуйста, выберите вариант ниже 👇",
          mainKeyboard()
        );
      }

      return res.send("ok");
    }

    // =========================
    // Получение фотографии
    // =========================

    if (user.step === "photo") {
      const photoUrl = getBestPhotoUrl(message);

      if (photoUrl) {
        console.log("Фото найдено. Загружаем его в VK...");

        // Загружаем фото сразу и сохраняем attachment
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

    // =========================
    // Количество
    // =========================

    if (user.step === "quantity") {
      if (
        text === "1" ||
        text === "2" ||
        text === "3" ||
        text === "4" ||
        text === "5+"
      ) {
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

    // =========================
    // Пожелания
    // =========================

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

    // =========================
    // Имя
    // =========================

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

    // =========================
    // Контакт + готовая заявка
    // =========================

    if (user.step === "contact") {
      user.contact = text;

      const orderText =
        `🆕 НОВАЯ ЗАЯВКА\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `📦 Изделие:\n${user.type}\n\n` +
        `🔢 Количество:\n${user.quantity}\n\n` +
        `💬 Пожелания:\n${user.details || "Не указаны"}\n\n` +
        `👤 Имя:\n${user.name}\n\n` +
        `📱 Контакт:\n${user.contact}\n\n` +
        `🔗 VK ID клиента:\n${userId}\n\n` +
        `━━━━━━━━━━━━━━━━━━`;

      // Отправляем текст заявки
      await sendMessage(
        ADMIN_ID,
        orderText
      );

      // Отправляем сохранённое фото отдельным сообщением
      if (user.photo) {
        const photoResult = await sendMessage(
          ADMIN_ID,
          "📸 Фото / пример к заказу:",
          null,
          user.photo
        );

        console.log("Результат отправки фото админу:", photoResult);
      }

      // Сообщение клиенту
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

// =========================
// Запуск
// =========================

app.listen(PORT, () => {
  console.log(`VK Order Bot запущен на порту ${PORT}`);
});
'''

path = Path("/mnt/data/server.js")
path.write_text(code, encoding="utf-8")
print(f"Готово: {path}")
