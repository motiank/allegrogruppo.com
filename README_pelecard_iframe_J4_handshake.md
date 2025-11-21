
# Pelecard Iframe Checkout (J4) with Server-Side Handshake

This README explains how to implement a **regular debit transaction (ActionType = "J4")** using **Pelecard’s Iframe/Redirect payment page** with a **server-side handshake**.

It is written so that any developer or LLM-based assistant (like Cursor / ChatGPT) can follow it and integrate Pelecard into a typical web backend (Node.js, .NET, PHP, etc.).

---

## 1. Endpoints and Overall Flow

### 1.1 Main Endpoints

**Iframe Init (create payment URL):**  
`POST https://gateway21.pelecard.biz/PaymentGW/init`

**GetTransaction (fetch transaction details):**  
`POST https://gateway21.pelecard.biz/PaymentGW/GetTransaction`

**ValidateByUniqueKey (handshake / verify transaction):**  
`POST https://gateway21.pelecard.biz/PaymentGW/ValidateByUniqueKey`

> Note: In some examples, `gateway20` is mentioned instead of `gateway21`. For new integrations, use `gateway21` unless Pelecard explicitly tells you otherwise.

### 1.2 High-Level Flow

1. **Your server → Pelecard:**  
   Send a JSON body to `/PaymentGW/init` with the transaction settings (amount, currency, URLs, etc.).

2. **Pelecard → Your server:**  
   Returns a JSON object that contains:
   - Status and error fields
   - A `ResultData` object with:
     - `TransactionId` – unique transaction identifier
     - An internal Pelecard transaction ID
     - A **payment URL** you will use in the iframe

3. **Frontend:**  
   Your app displays an `<iframe>` whose `src` is the payment URL from step 2.

4. **Cardholder:**  
   Enters credit card details inside the iframe and clicks **“Pay Now”**.

5. **Pelecard:**  
   - Processes the payment with the card networks.  
   - Calls your **server-side feedback URL(s)** (if configured).  
   - Redirects the browser to your **GoodURL / ErrorURL / CancelURL**, including landing page parameters.

6. **Your server:**  
   - Receives the landing parameters (including `ConfirmationKey` and `UserKey` / `ParamX`).  
   - (Optionally) receives server-side feedback JSON.  
   - Calls `ValidateByUniqueKey` to **verify** that the transaction is authentic and matches your order.  
   - Optionally calls `GetTransaction` to pull full transaction details.  
   - Only after successful verification does your server mark the order as **paid**.

---

## 2. Init Request (Iframe URL Creation)

You start each checkout by POSTing JSON to:

```text
https://gateway21.pelecard.biz/PaymentGW/init
```

### 2.1 Minimal Example for J4 Regular Debit

```json
{
  "terminal": "YOUR_TERMINAL",
  "user": "YOUR_USER",
  "password": "YOUR_PASSWORD",

  "GoodURL": "https://your-site.com/pelecard/good",
  "ErrorURL": "https://your-site.com/pelecard/error",

  "ActionType": "J4",
  "Currency": "1",
  "Total": "100",

  "Language": "HE",
  "UserKey": "order-12345",
  "ParamX": "order-12345",

  "ServerSideGoodFeedbackURL": "https://your-api.com/pelecard/feedback/good",
  "ServerSideErrorFeedbackURL": "https://your-api.com/pelecard/feedback/error"
}
```

This is enough for a typical **regular checkout** in NIS with a debit (`J4`) transaction and a basic handshake implementation.

### 2.2 Required Parameters for Init

These fields must be sent for every iframe transaction (according to Pelecard’s spec).

| Parameter | Type | Required | Description |
|----------|------|----------|-------------|
| `terminal` | string | Yes | The terminal number assigned by Pelecard (e.g. `"0882577012"` in examples). |
| `user` | string | Yes | Your Pelecard username. |
| `password` | string | Yes | Your Pelecard password. |
| `GoodURL` | string (URL) | Yes | URL to which the buyer is redirected after the transaction completes (success or failure). You must check `PelecardStatusCode` to decide if it is actually successful. |
| `Total` | string | Yes | **Total amount in agorot** (cents). Example: `"100"` = 1 NIS. Often called “Total (in agorot)”. |
| `Currency` | string | Yes | Currency code. Common values: `1` = NIS (₪), `2` = USD, `978` = EUR, `826` = GBP. Note: credit and payments transactions are usually allowed in ILS only. |

### 2.3 Important Optional Parameters for Init

These are not strictly required but are essential or very useful in a real integration.

#### 2.3.1 URLs & Flow Control

| Parameter | Type | Default | Description |
|----------|------|---------|-------------|
| `ErrorURL` | string (URL) | (None) | URL to redirect to when the transaction fails. If not set, `GoodURL` may receive both success and error flows, and you must check `StatusCode`. |
| `CancelURL` | string (URL) | (None) | URL when the buyer clicks **Cancel** on the payment page. `StatusCode` will be `555` for cancel. |
| `FeedbackOnTop` | `True` / `False` | `False` | Controls where the landing page appears in iframe mode. `False`: within iframe (default). `True`: in the hosting page (outside the iframe). For non-SSL sites, some combinations are required. |
| `UseBuildInFeedbackPage` | `True` / `False` | `False` | When `True`, Pelecard displays its own landing page first and only then redirects to your `GoodURL`/`ErrorURL`. Usually you leave this as `False` and implement your own landing page. |
| `FeedbackDataTransferMethod` | `"GET"` / `"POST"` | `"GET"` | How landing parameters are sent to your `GoodURL`/`ErrorURL` (query string vs form). |

#### 2.3.2 Transaction Type & Testing

| Parameter | Type | Default | Description |
|----------|------|---------|-------------|
| `ActionType` | string | `"J4"` | Transaction type. `J4` = debit, `J2` = tokenization only (no charge), `J5` = authorization only (capture later). For standard checkout use `J4`. |
| `QAResultStatus` | string | (None) | Sandbox-only parameter to simulate responses. `000` for success, or any error code (e.g. `"003"`) to simulate a specific failure. Works only on test terminals. |

#### 2.3.3 Server-Side Feedback (Handshake Support)

| Parameter | Type | Default | Description |
|----------|------|---------|-------------|
| `ServerSideGoodFeedbackURL` | string (URL) | (None) | Server-side URL that Pelecard POSTs transaction details to **when the transaction is successful**. This is NOT the URL the browser opens; this is server → server. |
| `ServerSideErrorFeedbackURL` | string (URL) | (None) | Server-side URL that Pelecard POSTs to when the transaction fails. |
| `resultDataKeyName` | string | (None) | Controls feedback format. If set, Pelecard wraps the JSON in a single form field with this name. If not set, the raw request body is JSON. |
| `ServerSideFeedbackContentType` | string | `"application/x-www-form-urlencoded"` | By default, Pelecard sends a form POST with body that contains JSON. You can change this to `"application/json"` so that feedback is standard JSON. |

Pelecard sends these server-side requests only over HTTP/HTTPS on ports **80 or 443** and expects a **200 OK** response. It retries once if it does not receive 200.

#### 2.3.4 Token and Identification

| Parameter | Type | Default | Description |
|----------|------|---------|-------------|
| `CreateToken` | `"True"` / `"False"` | `"False"` | When `"True"`, Pelecard will create a token for the card. The token is returned in the landing/feedback data and can be used for future charges via APIs. |
| `UserKey` | string | (None) | Your own **unique transaction identifier** (up to ~50 characters). Strongly recommended. Used together with `ConfirmationKey` to validate the transaction using `ValidateByUniqueKey`. |
| `ParamX` | string | (None) | Free-text additional details (up to ~19 characters; English lowercase + digits). Very useful to carry an order ID or some other tracking string. Appears in responses as `ParamX` and sometimes as `AdditionalDetailsParamX`. |
| `ShowXParam` | `"True"` / `"False"` | `"False"` | Whether to display `ParamX` on the payment page. |
| `AddHolderNameToXParam` | `"True"` / `"False"` | `"False"` | When `True`, the card holder name is appended to `ParamX` (with a `#` separator). |

#### 2.3.5 Language & UI

| Parameter | Type | Default | Description |
|----------|------|---------|-------------|
| `Language` | string | `"HE"` | UI language & direction. `"HE"` = Hebrew (RTL), `"EN"` = English, `"RU"` = Russian. The CSS must match the direction you choose. |
| `CssURL` | string (URL) | Pelecard default | URL to a CSS file to change the payment page design. Must be whitelisted by Pelecard. |
| `LogoURL` | string (URL) | (None) | URL to your logo. Must be whitelisted. |
| `bussiness_name` | string | (None) | Business name text shown at the top. |
| `topText` / `BottomText` | string | (None) | Text above/below the main payment form. |
| `CreditCard` | nested JSON | `{ "Enable": "true" }` | Controls whether the **credit card** payment option is shown, mainly relevant when you also enable ApplePay/GooglePay/other wallets. For card-only pages you can leave this default. |

#### 2.3.6 Cardholder Form Fields

These parameters control which **input fields** appear on the iframe (ID, address, email, etc.). The pattern is:

- `"Hide"` – field not displayed
- `"Optional"` – displayed but optional
- `"Must"` – displayed and required
- `"Value"` / `"Input Value"` – field pre-filled and mandatory

Common ones:

| Parameter | Possible Values | Default | Description |
|----------|------------------|---------|-------------|
| `CustomerIdField` | `"Hide"`, `"Optional"`, `"Value"`, `"Must"`, `"Input Value"` | `"Optional"` | Buyer ID/SSN/Passport. |
| `CustomerAddressField` | same as above | `"Optional"` | Street + house number. |
| `CustomerCityField` | same as above | `"Optional"` | City. |
| `CustomerIndexField` | same as above | `"Optional"` | Postal code. |
| `CustomerCountryField` | same as above | `"Optional"` | Country. |
| `Cvv2Field` | `"Optional"`, `"Must"`, `"Hide"` | `"Optional"` | CVV input (3 digits, 4 for Amex). Highly recommended to set `"Must"`. |
| `EmailField` | `"Hide"`, `"Optional"`, `"Must"`, `"Value"` | `"Hide"` | Cardholder email field. |
| `TelField` | `"Hide"`, `"Optional"`, `"Must"`, `"Value"` | `"Hide"` | Phone number field. |

For most basic checkouts you only need to tweak `Cvv2Field`, `CustomerIdField`, and maybe `EmailField`.

#### 2.3.7 Payments Configuration

For single-shot debit, you can leave defaults; but if you support installments/credit, use:

| Parameter | Type | Default | Description |
|----------|------|---------|-------------|
| `MaxPayments` | number (string) | `"12"` | Maximum number of payments allowed. If both `MinPayments` and `MaxPayments` are 1, the payments selector is hidden. |
| `MinPayments` | number (string) | `"1"` | Minimum number of payments. |
| `MinPaymentsForCredit` | number (string) | (None) | Minimum number of payments that counts as a **credit** transaction instead of plain installments. |
| `FirstPayment` | `"auto"`, `"Manual"`, `"XXX"` | `"auto"` | Controls first payment amount (auto or manual). |
| `DisabledPaymentNumbers` | number(s) | (None) | Disables specific payment counts (e.g. set `"2"` to prevent exactly 2 payments). |

For a simple single-payment debit, just keep `MinPayments = 1`, `MaxPayments = 1` and you don’t need other payment parameters.

#### 2.3.8 Wallets (Apple Pay / Google Pay)

If you want to enable wallets inside the iframe, you add nested JSON objects. Example for ApplePay:

```json
"ApplePay": {
  "Enabled": "true",
  "Label": "test transaction"
}
```

Similar structure exists for Google Pay. You will also need proper configuration and domains with Pelecard.

---

## 3. Response from Init (Iframe URL)

The init response is JSON. Schema can evolve, but an example (from the manual):

```json
{
  "StatusCode": "000",
  "ErrorMessage": "operation success",
  "ResultData": {
    "TransactionId": "111e4629-a057-41f4-858b-550650ba9404",
    "ShvaResult": "000",
    "AdditionalDetailsParamX": "test payment",
    "Token": "",
    "DebitApproveNumber": "0000000",
    "ConfirmationKey": "cfa825d17b15efbd25ce71279eedf111",
    "VoucherId": "11-111-111",
    "TransactionPelecardId": 11111,
    "CardHolderID": "123456789",
    "CardHolderName": "",
    "CardHolderEmail": "",
    "CardHolderPhone": "",
    "ShvaFileNumber": 11,
    "StationNumber": 1,
    "Reciept": 11,
    "JParam": 4,
    "CreditCardNumber": "11******1111",
    "CreditCardExpDate": "0118",
    "CreditCardCompanyClearer": 2,
    "CreditCardCompanyIssuer": 2,
    "DebitTotal": 100,
    "DebitCurrency": "1",
    "...": "... other fields ..."
  }
}
```

Implementation steps:

1. Check `StatusCode === "000"` – if not, log and treat as error.
2. Extract the **URL** field from `ResultData` (in production you will see the exact name; typically `Url` or similar) to use as iframe `src`.
3. Optionally store `TransactionId`, `ConfirmationKey`, and `ParamX`/`UserKey` with your order.

---

## 4. Frontend Iframe Usage

Once you have the payment URL, your frontend just renders:

```html
<iframe
  id="pelecard-checkout"
  src="PAYMENT_URL_FROM_RESULTDATA"
  width="100%"
  height="600"
  frameborder="0">
</iframe>
```

If you use Google Pay or some advanced browser payment APIs, you may need attributes like `allow="payment *"` or `allowpaymentrequest` depending on your setup and browser requirements.

---

## 5. Landing Page Parameters

After the user completes or cancels the payment, Pelecard redirects the browser to `GoodURL`, `ErrorURL` or `CancelURL` with landing parameters **either in GET or POST** (depending on `FeedbackDataTransferMethod`).

Important parameters:

| Parameter | Description |
|----------|-------------|
| `PelecardStatusCode` | Transaction status code. `"000"` means **success**. Any other value indicates error; see Pelecard’s error code list. |
| `PelecardTransactionId` | Pelecard’s unique transaction ID. Use this with `GetTransaction` if you want full details. |
| `ApprovalNo` | Card company approval number (may be empty). |
| `Token` | Token value if `CreateToken = true` or using a registration page; can be empty. |
| `ConfirmationKey` | Security key used for forgery protection and final handshake via `ValidateByUniqueKey`. |
| `ParamX` | The same value you sent; useful to match to your internal order ID. |
| `UserKey` | The unique transaction identifier you sent; used with `ConfirmationKey` in `ValidateByUniqueKey`. |

Your landing page should:

1. Read these parameters.
2. Show a message to the user (“payment succeeded”, “failed”, etc.).
3. Call your backend (AJAX or redirect) to verify status (using `ValidateByUniqueKey` as described below).

---

## 6. Server-Side Feedback

If you configured:

- `ServerSideGoodFeedbackURL`
- `ServerSideErrorFeedbackURL`

Pelecard will send server-to-server POST requests with **JSON** (or JSON in a form field) to those URLs.

### 6.1 Format Control

- If `resultDataKeyName` is **empty**: the entire request body is JSON.
- If `resultDataKeyName` is set (e.g. `"result"`): you receive a form POST and the field named `result` contains the JSON string.
- `ServerSideFeedbackContentType` controls the `Content-Type` header.  
  - Default: `application/x-www-form-urlencoded`.  
  - If you set it to `application/json`, Pelecard will send standard JSON.

### 6.2 What the Server Needs to Do

For both good and error feedback URLs:

1. **Expose endpoints**, e.g.:  
   - `POST /pelecard/feedback/good`  
   - `POST /pelecard/feedback/error`

2. **Parse the request** based on `resultDataKeyName` and `ServerSideFeedbackContentType`.

3. **Extract key fields**, such as:

   - `PelecardTransactionId` or `TransactionId`
   - `ConfirmationKey`
   - `UserKey`
   - `ParamX`
   - `Total` / `DebitTotal`
   - `Currency`
   - `ApprovalNo`
   - `Token` (if `CreateToken` was set)
   - Card holder information (`CardHolderName`, `CardHolderEmail`, `CardHolderPhone`, etc.)
   - etc.

   **Important:** `PelecardStatusCode` is **NOT** included in server-side feedback payloads. It is only sent to landing pages (`GoodURL`/`ErrorURL`). Since `ServerSideGoodFeedbackURL` is only called for successful transactions, there's no need for a status code.

4. **Log everything**.

5. **Call `ValidateByUniqueKey`** (see next section) to confirm the transaction before closing the order.

6. Reply with **HTTP 200** to Pelecard so it knows the feedback was received. If not 200, Pelecard may retry once.

---

## 7. Handshake – ValidateByUniqueKey

To protect against fraud or spoofed redirects, Pelecard recommends validating each transaction using the `ConfirmationKey` mechanism.

### 7.1 Endpoint and Request

**Endpoint:**  
`POST https://gateway21.pelecard.biz/PaymentGW/ValidateByUniqueKey`

**Request JSON:**

```json
{
  "ConfirmationKey": "CONFIRMATION_KEY_FROM_FEEDBACK_OR_LANDING",
  "UniqueKey": "YOUR_USERKEY_OR_TRANSACTIONID",
  "TotalX100": "100"
}
```

Parameters:

| Parameter | Description |
|----------|-------------|
| `ConfirmationKey` | Value received in landing params or server-side feedback. It is tied to the transaction’s amount and `UserKey`. |
| `UniqueKey` | Usually the `UserKey` you sent in the init JSON. If you did not send `UserKey`, you can use `TransactionId` instead. |
| `TotalX100` | The transaction amount multiplied by 100 (i.e., in agorot). If the amount is 1.00 NIS, send `"100"`. |

### 7.2 Response

The response is a simple indicator:

- `"1"` → transaction **identified / valid**  
- `"0"` → **error** (do not trust the transaction; do not mark order as paid)

### 7.3 Handshake Logic

When your server receives landing or feedback data:

**For server-side feedback (`ServerSideGoodFeedbackURL`):**
1. Extract `ConfirmationKey`, `UserKey`, `ParamX`, `Total`/`DebitTotal` from the feedback payload.
   - **Note:** `PelecardStatusCode` is NOT in server-side feedback - it's only sent to landing pages.
2. Call `ValidateByUniqueKey` with:
   - `ConfirmationKey` from Pelecard.
   - `UniqueKey` = your `UserKey` or transaction ID.
   - `TotalX100` = the order amount in agorot.
3. If the result is `"1"`, mark the order as **paid** (status is implicit - only successful transactions trigger `ServerSideGoodFeedbackURL`).
4. Otherwise, treat it as an error or suspicious and log for manual investigation.

**For landing pages (`GoodURL`/`ErrorURL`):**
1. Extract `PelecardStatusCode` and verify it equals `"000"`.
2. Extract `ConfirmationKey`, `UserKey`, `ParamX` from landing parameters.
3. Call `ValidateByUniqueKey` with:
   - `ConfirmationKey` from Pelecard.
   - `UniqueKey` = your `UserKey` or transaction ID.
   - `TotalX100` = the order amount in agorot.
4. If the result is `"1"` and status is `"000"`, mark the order as **paid**.
5. Otherwise, treat it as an error or suspicious and log for manual investigation.

---

## 8. GetTransaction – Fetch Full Transaction Details

Sometimes you need the full transaction details (card brand, masked card number, timestamps, etc.). For that, use `GetTransaction`.

### 8.1 Endpoint and Request

**Endpoint:**  
`POST https://gateway21.pelecard.biz/PaymentGW/GetTransaction`

**Request JSON:**

```json
{
  "terminal": "YOUR_TERMINAL",
  "user": "YOUR_USER",
  "password": "YOUR_PASSWORD",
  "TransactionId": "TRANSACTION_ID_FROM_RESULTDATA_OR_LANDING"
}
```

Parameters:

| Parameter | Description |
|----------|-------------|
| `terminal` | Your terminal number (same as in Init). |
| `user` | Your username. |
| `password` | Your password. |
| `TransactionId` | The transaction ID returned in `ResultData.TransactionId` or `PelecardTransactionId`. |

The response is JSON with many fields about the transaction (status, totals, card brand, masked card number, etc.). Use it mainly for back-office operations, reconciliation, or debugging.

---

## 9. Recommended Implementation Pattern

### 9.1 On Your Server

**1. “Create Checkout” endpoint** (e.g. `POST /api/checkout`)

- Input: cart details from your frontend.
- Steps:
  1. Calculate `Total` in agorot and `Currency`.
  2. Generate a new internal `orderId`.
  3. Build the Init JSON (Section 2.2 + main optional fields). Set:
     - `ActionType: "J4"`
     - `UserKey: orderId`
     - `ParamX: orderId` or some short descriptor
     - `GoodURL`, `ErrorURL`, `ServerSideGoodFeedbackURL`, `ServerSideErrorFeedbackURL`
  4. POST to `https://gateway21.pelecard.biz/PaymentGW/init`.
  5. On success (`StatusCode === "000"`):
     - Read the iframe payment URL from `ResultData`.
     - Save `orderId`, `TransactionId`, `UserKey`, and possibly `ConfirmationKey` to your DB.
     - Return `{ iframeUrl: "..." }` to the frontend.

**2. Feedback endpoints**

- `POST /pelecard/feedback/good`
- `POST /pelecard/feedback/error`

For both:

1. Parse request according to `resultDataKeyName` and `ServerSideFeedbackContentType`.
2. Extract `ConfirmationKey`, `UserKey`, `ParamX`, `DebitTotal`/`Total`, `PelecardTransactionId`, etc.
   **Note:** `PelecardStatusCode` is NOT in server-side feedback - it's only in landing page parameters. `ServerSideGoodFeedbackURL` is only called for successful transactions.
3. Match to your local order using `UserKey` or `ParamX`.
4. Call `ValidateByUniqueKey`:
   - `ConfirmationKey`: from feedback.
   - `UniqueKey`: `UserKey` (or `TransactionId` if no `UserKey`).
   - `TotalX100`: your stored order amount.
5. If validation returns `"1"`:
   - Mark order as `paid` in your DB.
6. Respond with `HTTP 200`.

**3. Optionally, an admin “refresh from Pelecard” endpoint**

- `GET /admin/orders/:id/refresh-from-pelecard`
- Loads your order, calls `GetTransaction` with `TransactionId`, and updates local data.

### 9.2 On Your Frontend

1. Call `POST /api/checkout` to create a new order and get `iframeUrl`.
2. Render an iframe with `src = iframeUrl` on the checkout page.
3. Implement `GoodURL`, `ErrorURL`, and `CancelURL` routes on your site:
   - They read landing params (or call your backend to check status).
   - For success, show “Order Paid” and redirect to order summary.
   - For failure/cancel, show an error/retry message.

---

## 10. Checklist

Use this list when implementing:

- [ ] Store your Pelecard `terminal`, `user`, and `password` securely on the server only.
- [ ] Implement backend call to `/PaymentGW/init` with `ActionType = "J4"`, `Total`, `Currency`, `GoodURL` and authentication data.
- [ ] Generate a unique `UserKey` (usually your internal `orderId`) and send it.
- [ ] Optionally send `ParamX` with a short order identifier.
- [ ] Parse the Init response, check `StatusCode === "000"`, and extract the payment URL.
- [ ] Return the iframe URL to the frontend.
- [ ] Render an iframe pointing to the payment URL.
- [ ] Implement `GoodURL` / `ErrorURL` / `CancelURL` landing routes in your app.
- [ ] Implement `ServerSideGoodFeedbackURL` / `ServerSideErrorFeedbackURL` endpoints.
- [ ] In feedback and/or landing handler, call `ValidateByUniqueKey` with `ConfirmationKey`, `UserKey`, `TotalX100`.
- [ ] Only mark orders as **paid** when:
  - For server-side feedback (`ServerSideGoodFeedbackURL`): `ValidateByUniqueKey` returns `1` (status is implicit - only successful transactions trigger this URL).
  - For landing pages (`GoodURL`): `PelecardStatusCode === "000"` **and** `ValidateByUniqueKey` returns `1`.
- [ ] (Optional) Use `GetTransaction` for reconciliation / admin views.

Once you have this flow in place, you have a robust, server-verified checkout using Pelecard’s iframe with regular debit (`J4`) transactions.
