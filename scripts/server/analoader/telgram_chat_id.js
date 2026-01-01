import axios from 'axios';

const TOKEN = '7725710973:AAEoh0_BpxD6ZZDupikB-ypvGEGIgcb1wpM';
const CHAT_ID = '-4716877836';
const MESSAGE = 'Hello from Node.js! 🎉';

(async () => {
  //   const res = await axios.get(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
  //   console.log(JSON.stringify(res.data, null, 2));

  axios
    .post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: MESSAGE,
    })
    .then((res) => {
      console.log('Message sent!');
    })
    .catch((err) => {
      console.error('Error sending message:', err.response?.data || err.message);
    });
})();

// 1008089344
