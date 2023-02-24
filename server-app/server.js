const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const uuid = require('uuid');
const basicAuth = require('basic-auth');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

app.use(
  cors({
    origin: 'http://localhost:3000',
    credentials: true,
    methods: ['GET','POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  })
);

const pool = new Pool({
  user: 'dbadmin',
  host: 'localhost',
  database: 'messaging_app',
  password: 'password',
  port: 5432,
});

app.use(bodyParser.json());

const sessions = new Map();
const secret = 'mysecretkey'; // TODO: use env to import this value.

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  pool.query('SELECT * FROM admins WHERE username = $1 AND password = $2', [username, password], (error, results) => {
    if (error) {
      console.error(error);
      res.status(500).send('Internal server error');
    } else if (results.rows.length > 0) {
      const admin = { username: username, role: 'admin' };
      const token = jwt.sign(admin, secret, { expiresIn: '1h' });
      res.status(200).send({ token });
    } else {
      res.status(401).send('Invalid username or password');
    }
  });
});

const auth = (req, res, next) => {
  const token = req.headers.authorization && req.headers.authorization.split(' ')[1];
  if (!token) {
    return res.status(401).send('Unauthorized request');
  }
  jwt.verify(token, secret, (err, decoded) => {
    if (err) {
      return res.status(401).send('Unauthorized request');
    }

    if (decoded.role !== 'admin') {
      return res.status(403).send('Forbidden');
    }

    req.admin = decoded.username;
    next();
  });
};

app.get('/api/admin/verify', auth, (req, res) => {
  res.status(200).send({isValid: true});
});

app.get('/api/admin', auth, (req, res) => {
  res.status(200).send({message: `Welcome ${req.admin}`});
});

app.post('/api/session', async (req, res) => {
  const id = uuid.v4();
  const { rows } = await pool.query('SELECT adminid FROM admins ORDER BY RANDOM() LIMIT 1');
  const adminId = rows[0].adminid;
  sessions.set(id, { adminId });
  await pool.query('INSERT INTO sessions (id, adminId) VALUES ($1, $2)', [id, adminId]);
  res.send({ sessionId: id });
});

app.post('/api/user/message', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!sessions.has(sessionId)) {
    res.sendStatus(404);
    return;
  }
  await pool.query(
    'INSERT INTO messages (sender, message, session) VALUES ($1, $2, $3)',
    ['user', message, sessionId]
  );
  res.sendStatus(200);
});

app.get('/api/user/messages', auth, async (req, res) => {
  const sessionId = req.query.sessionId;
  const { rows } = await pool.query(
    'SELECT sender, message, created_at FROM user_messages WHERE session = $1',
    [sessionId]
  );
  res.send(rows);
});

// Routes
app.get('/', function (req, res) {
  res.sendFile(
    path.join(__dirname, '..', 'client-app/anonymous', 'index.html')
  );
});

app.listen(8080);
