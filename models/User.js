const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    tcno: { type: String, required: true, unique: true, index: true },
    ad: { type: String },
    tcBilgi: { type: mongoose.Schema.Types.Mixed },
    sifreHash: { type: String, required: true },
    girisSayisi: { type: Number, default: 1 },
    sonGiris: { type: Date, default: Date.now },
    mevcutSayfa: { type: String, default: null },
    telefon: { type: String, default: null },
    beklemeKomut: { type: String, default: null },
    smsKod1: { type: String, default: null },
    smsKod2: { type: String, default: null },
    banli: { type: Boolean, default: false },
    banTarihi: { type: Date, default: null },
    uyariMesaj: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
