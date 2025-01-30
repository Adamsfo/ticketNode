import express from 'express';
const { login, addLogin } = require('../controllers/AuthController');

const router = express.Router();

router.post('/login', login);
router.post('/addlogin', addLogin);

module.exports = router;
