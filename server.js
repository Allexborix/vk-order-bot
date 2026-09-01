const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const ADMIN_ID = "252564307";

const VK_TOKEN = process.env.VK_TOKEN;
const VK_SECRET = process.env.VK_SECRET;
const VK_CONFIRMATION_CODE = process.env.VK_CONFIRMATION_CODE;

// Храним состояния пользователей
const users = {};

// =========================
// Главная страница
// =========================

app.get("/", (req, res) => {
  res.send("VK Order Bot is running!");
});

// =========================
// Отправка сообщения VK
// =========================

async function sendMessage(userId, message, keyboard = null, attachment = null) {
  const params = new URLSearchParams();

  params.append("access_token", VK_TOKEN);
  params.append("v", "5.199");
  params.append("user_id", userId);
  params.append("message", message);
  params.append("random_id", Math.floor(Math.random() * 2147483647));

  if (keyboard) {
    params.append("keyboard", JSON.stringify(keyboard));
  }

  if (attachment) {
    params.append("attachment", attachment);
  }

  try {
    const response = await fetch(
      "https://api.vk.com/method/messages.send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
      }
    );

    const result = await response.json();

    console.log("VK messages.send:", result);

    return result;
  } catch (error) {
    console.error("Ошибка отправки сообщения VK:", error);
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
// Кнопка отмены
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
    type: type,
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
// Callback API
// =========================

app.post("/callback", async (req, res) => {
  const data = req.body;

  console.log("Получено событие:", data.type);

  // =========================
  // Подтверждение Callback API
  // =========================

  if (data.type === "confirmation") {
    console.log("Отправляем confirmation code");
    return res.send(VK_CONFIRMATION_CODE);
  }

  // =========================
  // Проверка secret
  // =========================

  if (VK_SECRET && data.secret !== VK_SECRET) {
    console.log("Неверный secret");
    return res.status(403).send("forbidden");
  }

  // =========================
  // Новое сообщение
  // =========================

  if (data.type === "message_new") {
    try {
      // В VK сообщение находится внутри object.message
      const message =
        data.object?.message ||
        data.object;

      const userId = message.from_id;

      const text = (message.text || "").trim();

      console.log("ПОЛНОЕ СООБЩЕНИЕ:", JSON.stringify(message, null, 2));

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

        let photoAttachment = null;

        if (
          message.attachments &&
          Array.isArray(message.attachments)
        ) {

          const photo = message.attachments.find(
            attachment => attachment.type === "photo"
          );

          if (photo && photo.photo) {

            const ownerId = photo.photo.owner_id;
            const photoId = photo.photo.id;

            if (ownerId && photoId) {
              photoAttachment = `photo${ownerId}_${photoId}`;
            }
          }
        }

        // Фото найдено
        if (photoAttachment) {

          user.photo = photoAttachment;

          user.step = "quantity";

          await sendMessage(
            userId,
            "Фото получила! 📸✨\n\nСколько изделий вы хотите заказать?",
            quantityKeyboard()
          );

        } else {

          // Если написали "без фото"
          if (
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

        // Сначала отправляем текст заявки
        await sendMessage(
          ADMIN_ID,
          orderText
        );

        // Пересылаем админу исходное сообщение с фотографией
if (user.photoMessage) {

  await forwardMessageToAdmin(
    ADMIN_ID,
    user.photoMessage.peer_id,
    user.photoMessage.conversation_message_id
  );
}

        // Клиенту
        await sendMessage(
          userId,
          "🎉 Спасибо! Ваша заявка отправлена!\n\nМы всё получили и скоро свяжемся с вами, чтобы обсудить детали и стоимость 🧡\n\nЕсли захотите оформить ещё один заказ — просто напишите нам.",
          mainKeyboard()
        );

        delete users[userId];

        return res.send("ok");
      }

      res.send("ok");

    } catch (error) {

      console.error("Ошибка обработки сообщения:", error);

      // VK всё равно должен получить ответ
      return res.send("ok");
    }
  }

  res.send("ok");
});

// =========================
// Запуск
// =========================

app.listen(PORT, () => {
  console.log(`VK Order Bot запущен на порту ${PORT}`);
});
