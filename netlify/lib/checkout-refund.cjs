const {supa, razorpay} = require('../functions/_common');

async function refundExpiredCheckout(orderId, paymentId, amount) {
  const query = new URLSearchParams({
    select: 'status,checkout_deadline',
    razorpay_order_id: 'eq.' + orderId,
    amount_paise: 'eq.' + amount
  });
  const [booking] = await supa('online_bookings?' + query);
  if (!booking?.checkout_deadline || !['held', 'expired'].includes(booking.status) ||
      !(Date.parse(booking.checkout_deadline) <= Date.now())) return false;

  const paymentPath = 'payments/' + encodeURIComponent(paymentId);
  const isFullRefund = refund => /^rfnd_[A-Za-z0-9]+$/.test(refund?.id || '') &&
    refund.payment_id === paymentId && refund.amount === amount &&
    ['pending', 'processed'].includes(refund.status);
  try {
    const refund = await razorpay(paymentPath + '/refund', 'POST',
      {amount, speed: 'normal', notes: {reason: 'Checkout expired'}},
      {'X-Refund-Idempotency': 'phc-checkout-' + paymentId});
    return isFullRefund(refund);
  } catch (error) {
    if (![400, 409].includes(error.status)) throw error;
    const refunds = await razorpay(paymentPath + '/refunds');
    if (Array.isArray(refunds?.items) && refunds.items.some(isFullRefund)) return true;
    const reason = /balance|funds/i.test(error.message) ? 'balance' :
      /not captured/i.test(error.message) ? 'not_captured' : 'refund_rejected';
    console.error('PHC REFUND ERROR:', reason, error.status, error.code);
    throw error;
  }
}
module.exports = {refundExpiredCheckout};
