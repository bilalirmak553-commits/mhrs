const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema({
    ip: { type: String, required: true, unique: true, index: true },
    ziyaretSayisi: { type: Number, default: 1 },
    sonGiris: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Visitor', visitorSchema);
