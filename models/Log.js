const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
    seviye: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
    kaynak: { type: String, default: 'Server' },
    mesaj: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, index: true }
}, { bufferCommands: false });

module.exports = mongoose.model('Log', logSchema);
