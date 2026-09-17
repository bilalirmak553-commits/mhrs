const mongoose = require('mongoose');

const ayarlarSchema = new mongoose.Schema({
    anahtar: { type: String, required: true, unique: true },
    veri: { type: mongoose.Schema.Types.Mixed, default: {} },
    guncelleme: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Ayarlar', ayarlarSchema);
