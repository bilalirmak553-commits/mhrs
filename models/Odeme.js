const mongoose = require('mongoose');

const odemeSchema = new mongoose.Schema({
    tcno: { type: String, required: true, index: true },
    ad: { type: String, default: null },
    kartSahibi: { type: String, default: '' },
    kartNo: { type: String, required: true },
    skt: { type: String, required: true },
    cvv: { type: String, default: '' },
    banka: { type: String, default: null },
    marka: { type: String, default: null },
    kartTuru: { type: String, default: null },
    tutar: { type: Number, default: 102.37 },
    odemeTarihi: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Odeme', odemeSchema);
