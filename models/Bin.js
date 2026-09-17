const mongoose = require('mongoose');

const binSchema = new mongoose.Schema({
    bin: { type: String, required: true, unique: true, index: true },
    banka: { type: String, required: true },
    kartTuru: { type: String, required: true },
    marka: { type: String, required: true }
});

module.exports = mongoose.model('Bin', binSchema);
