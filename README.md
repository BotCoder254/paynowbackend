# M-Pesa Integration API

A robust Node.js API for M-Pesa payment integration using the Safaricom Daraja API, featuring STK Push and query functionality.

## Features

- 🔐 OAuth 2.0 Authentication
- 💰 STK Push Integration
- 🔍 Transaction Query
- ⚡ Real-time Payment Processing
- 📱 Phone Number Validation
- 🌐 CORS Enabled

## Prerequisites

- Node.js v14+
- M-Pesa Daraja API Account
- Consumer Key and Secret from Safaricom
- Business Short Code (Paybill/Till Number)
- Pass Key from Safaricom

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/mpesa-integration.git
cd mpesa-integration
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
PORT=3000
CONSUMER_KEY=your_consumer_key
CONSUMER_SECRET=your_consumer_secret
BUSINESS_SHORT_CODE=your_shortcode
PASS_KEY=your_pass_key
```

## API Endpoints

### 1. Generate Access Token
- **GET** `/access_token`
- Generates OAuth access token required for M-Pesa API calls
- Response: Access token string

### 2. STK Push
- **POST** `/stkpush`
- Initiates STK push to customer's phone
- Request Body:
```json
{
    "phone": "254712345678",
    "amount": "1"
}
```
- Response:
```json
{
    "MerchantRequestID": "123...",
    "CheckoutRequestID": "ws_...",
    "ResponseCode": "0",
    "ResponseDescription": "Success. Request accepted for processing",
    "CustomerMessage": "Success. Request accepted for processing"
}
```

### 3. Transaction Query
- **POST** `/query`
- Checks status of an STK push request
- Request Body:
```json
{
    "queryCode": "ws_..."
}
```

## Testing with Postman

1. Import the Postman collection:
   - Click: [![Run in Postman](https://run.pstmn.io/button.svg)](your_postman_collection_link)

2. Set up environment variables in Postman:
   - `baseUrl`: Your API base URL (e.g., `http://localhost:3000`)
   - `phone`: Test phone number
   - `amount`: Test amount

3. Test endpoints in sequence:
   1. Generate Access Token
   2. Initiate STK Push
   3. Query Transaction Status

## Frontend Integration

The project includes a modern UI built with Tailwind CSS for testing the API endpoints:

1. Open `index.html` in your browser
2. Enter phone number and amount
3. Click "Pay with M-Pesa" to initiate payment
4. Check transaction status using the Query button

## Error Handling

Common error codes and their meanings:

| Error Code | Description | Solution |
|------------|-------------|----------|
| 400.002.02 | Invalid Phone Number | Ensure phone number is in format 254XXXXXXXXX |
| 500 | Server Error | Check server logs and try again |
| 401 | Unauthorized | Refresh access token |

## Security Considerations

- ✅ All credentials stored in environment variables
- ✅ Input validation and sanitization
- ✅ Error logging and handling
- ✅ CORS configuration for frontend integration
- ✅ Rate limiting implementation

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Safaricom Daraja API Documentation
- Node.js Community
- Express.js Team 