import fs from 'fs';
import FormData from 'form-data';
import axios from 'axios';

const TOKEN = '7725710973:AAEoh0_BpxD6ZZDupikB-ypvGEGIgcb1wpM';
const CHAT_ID = '-4716877836';

const form = new FormData();
form.append('chat_id', CHAT_ID);
form.append('photo', fs.createReadStream('./onu branches.png'));

axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, form, {
  headers: form.getHeaders(),
});
