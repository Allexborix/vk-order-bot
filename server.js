const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const GROUP_ID = "241213245";
const ADMIN_ID = "252564307";

app.get("/", (req, res) => {
  res.send("VK Order Bot is running!");
});

// Проверка Callback API
app.post("/callback", (req, res) => {
  const data = req.body;

  // Подтверждение сервера ВКонтакте
  if (data.type === "confirmation") {
    return res.send(process.env.VK_CONFIRMATION_CODE);
  }

  // Новое сообщение
  if (data.type === "message_new") {
    const message = data.object;

    console.log("Новое сообщение:", message);

    // Здесь позже подключим полноценную анкету заказа
  }

  res.send("ok");
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
