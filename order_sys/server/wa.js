import axios from "axios";

const TOKEN = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.WA_PHONE_ID;

async function sendOrderLink({ to, link }) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: "welcome_eatalia",
      language: { code: "he" },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: link
            }
          ]
        }
      ]
    }
  };

  const res = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    }
  });

  return res.data;
}

// דוגמה להרצה
sendOrderLink({
  to: "9725XXXXXXXX",
  link: "https://orders.yoursite.co.il/invite/abc123"
})
  .then(r => console.log("Sent OK:", r))
  .catch(e => console.error("Send failed:", e.response?.data || e.message));
