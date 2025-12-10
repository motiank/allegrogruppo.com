// ==============================
// Hard-coded list of messages
// ==============================
const MESSAGE_INTERVAL_MS = 20_000; // 20 שניות

// דוגמה לסט הודעות – תחליף לנתונים אמיתיים
// phone בפורמט בינ"ל בלי + ובלי 0 אחרי הקידומת (כמו ב wa.me)
const messagesQueue = [
  {
    phone: "972526611747",
    text: "היי 🙂 כאן Eatalia, תודה שנרשמת!"
  },
];

let isSending = false;
let currentIndex = 0;

// ==============================
// Utility: sleep
// ==============================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==============================
// UI button injection
// ==============================
function injectStartButton() {
  if (document.getElementById("wa-auto-sender-btn")) return;

  const btn = document.createElement("button");
  btn.id = "wa-auto-sender-btn";
  btn.textContent = "Start Auto Send";
  Object.assign(btn.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "9999",
    padding: "10px 16px",
    borderRadius: "999px",
    border: "none",
    backgroundColor: "#25D366", // צבע וואטסאפ
    color: "#fff",
    fontSize: "14px",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(0,0,0,0.2)"
  });

  btn.addEventListener("click", () => {
    if (isSending) {
      alert("Already sending messages...");
      return;
    }
    if (!messagesQueue.length) {
      alert("No messages in queue (hard-coded list is empty).");
      return;
    }
    isSending = true;
    btn.textContent = "Sending...";
    btn.style.backgroundColor = "#128C7E";
    startSending()
      .then(() => {
        btn.textContent = "Done";
        btn.style.backgroundColor = "#4CAF50";
      })
      .catch((err) => {
        console.error("Error in sending loop:", err);
        btn.textContent = "Error (check console)";
        btn.style.backgroundColor = "#e53935";
      });
  });

  document.body.appendChild(btn);
}

// ==============================
// Core: open chat & send message
// ==============================
async function sendMessageToPhone(phone, text) {
  console.log("[WA Auto Sender] Sending to:", phone, "text:", text);

  // פותח את הצ'אט למספר + טקסט (WhatsApp Web יתמלא אוטומטית עם ההודעה)
  const url =
    "https://web.whatsapp.com/send?phone=" +
    encodeURIComponent(phone) +
    "&text=" +
    encodeURIComponent(text);

  // משנה location – אםווטסאפ כבר פתוח, זה פשוט יטען את הצ'אט החדש
  window.location.href = url;

  // ממתינים לטעינת הצ'אט – אפשר לכוון את זה
  await sleep(5000);

  // עכשיו ננסה למצוא את האלמנט של תיבת ההקלדה ולשגר ENTER
  const input = findMessageInput();
  if (!input) {
    console.warn("[WA Auto Sender] Could not find message input.");
    return;
  }

  // לפעמים יש כבר טקסט מוכן מה-URL, אבל ליתר ביטחון נמלא שוב
  setInputText(input, text);

  // שולח Enter
  sendEnter(input);

  console.log("[WA Auto Sender] Message triggered (ENTER sent).");
}

// מוצא את האלמנט של תיבת ההקלדה של ווטסאפ
function findMessageInput() {
  // WhatsApp Web מחזיק TextArea/Div עם contenteditable=true
  // ננסה לחפש אלמנט כזה בתוך ה-footer
  const editor = document.querySelector("[contenteditable='true'][data-tab='10'], [contenteditable='true'][data-tab='6']");
  return editor || document.querySelector("[contenteditable='true']");
}

// מכניס את הטקסט לתוך האלמנט
function setInputText(element, text) {
  // הדרך הבטוחה יותר: להשתמש ב-Input Event
  element.focus();
  // מנקים תוכן קודם
  element.textContent = "";
  element.innerHTML = "";

  const event = new InputEvent("input", {
    bubbles: true,
    cancelable: true,
    data: text,
    inputType: "insertText"
  });
  element.textContent = text;
  element.dispatchEvent(event);
}

// משגר ENTER כאילו המשתמש לחץ
function sendEnter(element) {
  element.focus();
  const keyboardEvent = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true
  });
  element.dispatchEvent(keyboardEvent);
}

// ==============================
// Sending loop
// ==============================
async function startSending() {
  while (currentIndex < messagesQueue.length) {
    const { phone, text } = messagesQueue[currentIndex];

    try {
      await sendMessageToPhone(phone, text);
    } catch (e) {
      console.error("[WA Auto Sender] Error sending to", phone, e);
    }

    currentIndex++;
    if (currentIndex < messagesQueue.length) {
      console.log(`[WA Auto Sender] Waiting ${MESSAGE_INTERVAL_MS / 1000}s before next message...`);
      await sleep(MESSAGE_INTERVAL_MS);
    }
  }

  isSending = false;
  console.log("[WA Auto Sender] All messages processed.");
}

// ==============================
// Init when WhatsApp Web loads
// ==============================
function waitForWhatsAppAndInject() {
  // לוודא שהדף נטען וה-UI של ווטסאפ קיים
  const checkInterval = setInterval(() => {
    const appRoot = document.querySelector("#app");
    if (appRoot && document.body) {
      clearInterval(checkInterval);
      injectStartButton();
    }
  }, 1000);
}

waitForWhatsAppAndInject();
