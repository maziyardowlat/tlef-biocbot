// src/db.js
const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb://localhost:27017/biocbot'; // You can change 'biocbot' to any db name

function connectDB() {
  return mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
}

module.exports = connectDB;
