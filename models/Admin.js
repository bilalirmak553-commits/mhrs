const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
    kullaniciAdi: { type: String, required: true, unique: true, index: true },
    sifreHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Admin', adminSchema);
