'use strict';
const QRCode = require('qrcode');
module.exports = async function sendQR(res, url) {
  const svg = await QRCode.toString(url, { type: 'svg', width: 240, margin: 2, errorCorrectionLevel: 'M' });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.end(svg);
};
