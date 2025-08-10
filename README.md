# PayNow Backend

This is the backend server for the PayNow payment processing platform. It handles M-Pesa integration, invoice generation, and customer management.

## Features

- M-Pesa STK Push integration
- PDF invoice generation
- Email notifications
- SMS notifications
- Customer management (CRM Lite)
- Firebase integration for data storage

## Setup Instructions

### Prerequisites

- Node.js (v14+)
- npm or yarn
- Firebase account
- M-Pesa API credentials

### Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

4. Update the `.env` file with your credentials:
   - Email configuration for sending notifications
   - Firebase credentials for database and storage
   - M-Pesa API credentials
   - Base URL for callbacks

### Running the Server

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

## API Endpoints

### M-Pesa Integration

- `POST /stkpush` - Initiate STK Push payment
- `POST /callback/:orderId` - M-Pesa callback handler
- `POST /query` - Check payment status
- `POST /validation/:orderId` - M-Pesa validation URL

### Order Management

- `POST /update-order-status` - Update order status
- `POST /cancel-order` - Cancel an order

## Invoice Generation

The system automatically generates PDF invoices for successful payments. Invoices include:

- Transaction details
- Customer information
- Payment information
- Merchant branding

Invoices are stored in Firebase Storage and can be accessed via the dashboard.

## Customer Management

Customer data is automatically collected and organized for merchants:

- Contact information
- Transaction history
- Total spend
- Payment preferences

Merchants can view and manage customers through the dashboard.

## Environment Variables

| Variable | Description |
|----------|-------------|
| EMAIL_USER | Email address for sending notifications |
| EMAIL_PASS | Email password or app-specific password |
| BASE_URL | Base URL for callbacks |
| FIREBASE_PROJECT_ID | Firebase project ID |
| FIREBASE_CLIENT_EMAIL | Firebase service account email |
| FIREBASE_PRIVATE_KEY | Firebase service account private key |
| FIREBASE_STORAGE_BUCKET | Firebase storage bucket name |
| ALLOWED_ORIGINS | Comma-separated list of allowed CORS origins |

## License

This project is proprietary software.