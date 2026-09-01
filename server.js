const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const GROUP_ID = "241213245";
const ADMIN_ID = "252564307";

const VK_TOKEN = process.env.VK_TOKEN;
const VK_SECRET = process.env.VK_SECRET;
const VK_CONFIRMATION_CODE = process.env.VK_CONFIRMATION_CODE;

// Состояния пользователей
const users = {};

app.get("/", (req, res) => {
  res.send("VK Order Bot is running!");
});

// Отправка сообщения через VK API
async function sendMessage(userId, message, keyboard = null) {
  const params = new URLSearchParams();

  params.append("access_token", VK_TOKEN);
  params.append("v", "5.199");
  params.append("user_id", userId);
  params.append("message", message);
  params.append("random_id", Math.floor(Math.random() * 2147483647));

  if (keyboard) {
    params.append("keyboard", JSON.stringify(keyboard));
  }

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

  return response.json();
}

// Клавиатура главного меню
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

// Клавиатура количества
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
      ]
    ]
  };
}

// Начало заказа
function startOrder(userId, type) {
  users[userId] = {
    step: "photo",
    type: type
  };

  sendMessage(
    userId,
    `Отличный выбор! 🧡\n\nВы выбрали: ${type}\n\n📸 Теперь отправьте фотографию или пример того, что хотите получить.\n\nЕсли фото не требуется — просто напишите «без фото».`
  );
}

// Callback API
app.post("/callback", async (req, res) => {
  const data = req.body;

  // Подтверждение сервера
  if (data.type === "confirmation") {
    return res.send(VK_CONFIRMATION_CODE);
  }

  // Проверка секретного ключа
  if (VK_SECRET && data.secret !== VK_SECRET) {
    return res.status(403).send("forbidden");
  }

  if (data.type === "message_new") {
    const message = data.object;

    const userId = message.from_id;
    const text = (message.text || "").trim();

    console.log("Новое сообщение:", userId, text);

    try {
      // Первое сообщение
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

      // Выбор изделия
      if (user.step === "type") {
        if (text.includes("Фигурка питомца")) {
          startOrder(userId, "🐾 Фигурка домашнего питомца");
        } else if (text.includes("Брелок")) {
          startOrder(userId, "🎀 Брелок / подвеска");
        } else if (text.includes("Украшение")) {
          startOrder(userId, "💍 Украшение");
        } else if (text.includes("Своя идея")) {
          startOrder(userId, "✨ Индивидуальный заказ");
        } else {
          await sendMessage(
            userId,
            "Пожалуйста, выберите вариант ниже 👇",
            mainKeyboard()
          );
        }

        return res.send("ok");
      }

      // Получение фото
      if (user.step === "photo") {
        const hasPhoto =
          message.attachments &&
          message.attachments.some(
            (attachment) => attachment.type === "photo"
          );

        user.photo = hasPhoto ? "Фото прикреплено" : text;

        user.step = "quantity";

        await sendMessage(
          userId,
          "Супер! ✨\n\nСколько изделий вы хотите заказать?",
          quantityKeyboard()
        );

        return res.send("ok");
      }

      // Количество
      if (user.step === "quantity") {
        user.quantity = text;
        user.step = "details";

        await sendMessage(
          userId,
          "Теперь расскажите подробнее о заказе 💭\n\nКакой цвет, размер, оформление или другие пожелания вы хотите?"
        );

        return res.send("ok");
      }

      // Пожелания
      if (user.step === "details") {
        user.details = text;
        user.step = "name";

        await sendMessage(
          userId,
          "Почти готово 🧡\n\nКак вас зовут?"
        );

        return res.send("ok");
      }

      // Имя
      if (user.step === "name") {
        user.name = text;
        user.step = "contact";

        await sendMessage(
          userId,
          "И последний вопрос 😊\n\nОставьте удобный способ связи: VK, телефон или Telegram."
        );

        return res.send("ok");
      }

      // Контакт и готовая заявка
      if (user.step === "contact") {
        user.contact = text;

        const orderText =
          `🆕 НОВАЯ ЗАЯВКА!\n\n` +
          `📦 Изделие: ${user.type}\n` +
          `📸 Фото: ${user.photo || "нет"}\n` +
          `🔢 Количество: ${user.quantity}\n` +
          `💬 Пожелания: ${user.details}\n` +
          `👤 Имя: ${user.name}\n` +
          `📱 Контакт: ${user.contact}\n` +
          `🔗 VK ID клиента: ${userId}`;

        await sendMessage(ADMIN_ID, orderText);

        await sendMessage(
          userId,
          "🎉 Спасибо! Ваша заявка отправлена!\n\nМы всё получили и скоро свяжемся с вами, чтобы обсудить детали и стоимость 🧡\n\nЕсли захотите оформить ещё один заказ — просто напишите нам."
        );

        delete users[userId];

        return res.send("ok");
      }

      res.send("ok");

    } catch (error) {
      console.error("Ошибка:", error);
      return res.send("ok");
    }
  }

  res.send("ok");
});

app.listen(PORT, () => {
  console.log(`VK Order Bot запущен на порту ${PORT}`);
});
