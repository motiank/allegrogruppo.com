import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the payload from the JSON file
const payloadPath = join(__dirname, 'pelecardgoodfeedback.json');
const fullPayload = JSON.parse(readFileSync(payloadPath, 'utf8'));

// The endpoint expects the transaction data
// The JSON has ResultData wrapping the actual transaction data
// Based on the endpoint code, we'll send the ResultData content
const payload = fullPayload.ResultData || fullPayload;

// Server configuration
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3020';
const ENDPOINT = `${SERVER_URL}/beecomm/pelecard/placeorder`;

console.log('Sending payload to:', ENDPOINT);
console.log('Payload:', JSON.stringify(payload, null, 2));
console.log('---');

try {
  const response = await axios.post(ENDPOINT, payload, {
    headers: {
      'Content-Type': 'application/json',
    },
    validateStatus: (status) => status < 500, // Don't throw on 4xx errors
  });

  console.log('Response Status:', response.status);
  console.log('Response Data:', JSON.stringify(response.data, null, 2));
  
  if (response.status >= 400) {
    process.exit(1);
  }
} catch (error) {
  console.error('Error sending request:');
  if (error.response) {
    console.error('Status:', error.response.status);
    console.error('Data:', JSON.stringify(error.response.data, null, 2));
  } else if (error.request) {
    console.error('No response received. Is the server running?');
    console.error('Request:', error.request);
  } else {
    console.error('Error:', error.message);
  }
  process.exit(1);
}

