const https = require('https');

/**
 * Send an SMS using VasPro API
 * @param {string} phoneNumber - The recipient phone number
 * @param {string} message - The message to send
 * @returns {Promise<Object>} - Promise that resolves with the SMS response
 */
const sendSMS = async (phoneNumber, message) => {
  try {
    // Format phone number to ensure it starts with 254
    let formattedPhone = phoneNumber.toString().trim();
    formattedPhone = formattedPhone.replace(/^\+|^0+|\s+/g, "");
    if (!formattedPhone.startsWith("254")) {
      formattedPhone = "254" + formattedPhone;
    }

    const data = JSON.stringify({
      apiKey: 'f9e412887a42ff4938baa34971e0b096',
      shortCode: 'VasPro',
      message: message,
      recipient: formattedPhone,
      callbackURL: '',
      enqueue: 1,
      isScheduled: false,
    });

    const options = {
      hostname: 'api.vaspro.co.ke',
      port: 443,
      path: '/v3/BulkSMS/api/create',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };

    return new Promise((resolve, reject) => {
      const smsReq = https.request(options, (smsRes) => {
        let responseData = '';

        smsRes.on('data', (chunk) => {
          responseData += chunk;
        });

        smsRes.on('end', () => {
          console.log('SMS sent successfully:', responseData);
          try {
            const parsedResponse = JSON.parse(responseData);
            resolve({ success: true, data: parsedResponse });
          } catch (error) {
            console.log('Could not parse SMS response, returning raw data');
            resolve({ success: true, data: responseData });
          }
        });
      });

      smsReq.on('error', (error) => {
        console.error('Error sending SMS:', error);
        reject({ success: false, error: error });
      });

      smsReq.write(data);
      smsReq.end();
    });
  } catch (error) {
    console.error('SMS sending error:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendSMS
};
