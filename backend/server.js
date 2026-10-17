require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const redis = require('redis');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Redis
const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

app.use(cors());
app.use(express.json());

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// ===== REST API =====

// Auth: Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM agents WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const agent = result.rows[0];
    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: agent.id, email: agent.email, name: agent.name }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, agent: { id: agent.id, name: agent.name, email: agent.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get conversations
app.get('/api/conversations', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, v.visitor_id, v.ip_address, v.location, v.user_agent,
             (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM conversations c
      JOIN visitors v ON c.visitor_id = v.id
      WHERE c.status != 'resolved' OR c.updated_at > NOW() - INTERVAL '7 days'
      ORDER BY c.updated_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get messages for a conversation
app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark conversation resolved
app.post('/api/conversations/:id/resolve', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      'UPDATE conversations SET status = $1, resolved_at = NOW(), updated_at = NOW() WHERE id = $2',
      ['resolved', req.params.id]
    );
    io.to(`conversation:${req.params.id}`).emit('conversation_resolved', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Quick replies
app.get('/api/quick-replies', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM quick_replies ORDER BY title');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settings
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings');
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Socket.io =====

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (token) {
    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = user;
      socket.isAgent = true;
    } catch (err) {
      // visitor
    }
  }
  next();
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Agent joins
  if (socket.isAgent) {
    socket.join('agents');
    redisClient.set(`agent:${socket.user.id}:online`, '1', { EX: 60 });
    socket.on('agent_status', async (status) => {
      await pool.query('UPDATE agents SET status = $1 WHERE id = $2', [status, socket.user.id]);
      io.to('agents').emit('agent_status_update', { id: socket.user.id, status });
    });
  }

  // Visitor joins
  socket.on('visitor_join', async (data) => {
    const { visitorId, conversationId } = data || {};
    if (!visitorId) {
      console.log('visitor_join ignored: missing visitorId');
      return;
    }

    socket.visitorId = visitorId;
    socket.join(`visitor:${visitorId}`);
    if (conversationId) {
      socket.join(`conversation:${conversationId}`);
    }

    // Ensure visitor exists
    let visitorResult = await pool.query('SELECT id FROM visitors WHERE visitor_id = $1', [visitorId]);
    if (visitorResult.rows.length === 0) {
      visitorResult = await pool.query(
        'INSERT INTO visitors (visitor_id, ip_address) VALUES ($1, $2) RETURNING id',
        [visitorId, socket.handshake.address || '127.0.0.1']
      );
    }
    const visitorDbId = visitorResult.rows[0].id;

    // Ensure conversation exists if not provided
    if (!conversationId) {
      let convResult = await pool.query(
        'SELECT id FROM conversations WHERE visitor_id = $1 AND status != $2 ORDER BY created_at DESC LIMIT 1',
        [visitorDbId, 'resolved']
      );
      if (convResult.rows.length === 0) {
        convResult = await pool.query(
          'INSERT INTO conversations (visitor_id) VALUES ($1) RETURNING id',
          [visitorDbId]
        );
      }
      socket.conversationId = convResult.rows[0].id;
      socket.join(`conversation:${socket.conversationId}`);
      socket.emit('conversation_ready', { conversationId: socket.conversationId });
    }

    // Update last seen
    await pool.query('UPDATE visitors SET last_seen = NOW() WHERE visitor_id = $1', [visitorId]);

    // Presence
    await redisClient.set(`visitor:${visitorId}:online`, '1', { EX: 30 });
    io.to('agents').emit('visitor_online', { visitorId });
  });

  // Send message
  socket.on('send_message', async (data) => {
    const { conversationId, content, messageType = 'text', senderType } = data;
    const senderId = socket.isAgent ? socket.user.id : socket.visitorId;

    try {
      const result = await pool.query(
        `INSERT INTO messages (conversation_id, sender_type, sender_id, content, message_type)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [conversationId, senderType || (socket.isAgent ? 'agent' : 'visitor'), senderId, content, messageType]
      );
      const message = result.rows[0];

      // Update conversation
      await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

      // Broadcast
      io.to(`conversation:${conversationId}`).emit('new_message', message);
      io.to('agents').emit('conversation_update', { conversationId, lastMessage: content });

      // Simple KB auto-reply for visitors
      if (!socket.isAgent) {
        const kb = await pool.query(
          'SELECT response FROM knowledge_base WHERE keyword ILIKE $1 LIMIT 1',
          [`%${content.toLowerCase()}%`]
        );
        if (kb.rows.length > 0) {
          const autoMsg = await pool.query(
            `INSERT INTO messages (conversation_id, sender_type, sender_id, content, message_type)
             VALUES ($1, 'system', 'kb', $2, 'text') RETURNING *`,
            [conversationId, kb.rows[0].response]
          );
          io.to(`conversation:${conversationId}`).emit('new_message', autoMsg.rows[0]);
        }
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Typing
  socket.on('typing', (data) => {
    const { conversationId, isTyping } = data;
    socket.to(`conversation:${conversationId}`).emit('typing', {
      isTyping,
      isAgent: socket.isAgent
    });
  });

  socket.on('disconnect', () => {
    if (socket.visitorId) {
      redisClient.del(`visitor:${socket.visitorId}:online`);
      io.to('agents').emit('visitor_offline', { visitorId: socket.visitorId });
    }
  });
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
