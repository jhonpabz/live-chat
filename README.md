# Live Chat Customer Support System

A modern, simple, self-hosted live chat system for small BPO companies. Inspired by Intercom/Tidio with a clean UI.

## Tech Stack
- **Frontend**: Vite + React + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Node.js + Express + Socket.io
- **Database**: PostgreSQL
- **Cache/Presence**: Redis

## Project Structure
```
live-chat/
├── backend/
│   ├── server.js          # Main Express + Socket.io server
│   ├── schema.sql         # PostgreSQL schema
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── AgentDashboard.tsx
    │   │   ├── ChatWidget.tsx
    │   │   └── Login.tsx
    │   ├── components/ui/
    │   └── ...
    ├── package.json
    └── ...
```

## Setup Instructions

### 1. Prerequisites
- Node.js 18+
- PostgreSQL
- Redis

### 2. Database Setup
```bash
# Create database
createdb livechat

# Run schema
psql -d livechat -f backend/schema.sql
```

Create an agent (replace password hash):
```sql
-- Generate hash with: node -e "console.log(require('bcryptjs').hashSync('password', 10))"
INSERT INTO agents (name, email, password_hash) 
VALUES ('Admin', 'admin@example.com', '$2a$10$...');
```

### 3. Backend
```bash
cd backend
cp .env.example .env
# Edit .env with your DATABASE_URL, REDIS_URL, JWT_SECRET

npm install
npm run dev   # or npm start
```

Backend runs on http://localhost:3001

### 4. Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend runs on http://localhost:5173

- Dashboard: http://localhost:5173/dashboard
- Widget: http://localhost:5173/widget
- Login: http://localhost:5173/login

### 5. Embedding the Widget
For any website, embed via iframe:
```html
<iframe src="http://your-server:5173/widget" style="position:fixed;bottom:0;right:0;border:none;width:400px;height:600px;z-index:9999;"></iframe>
```

Or build a script loader that injects the widget.

## Core Features Implemented
- Real-time messaging via Socket.io
- Agent dashboard with conversation list
- Customer chat widget (floating button)
- Online/offline status (Redis presence)
- JWT authentication for agents
- Conversation resolve
- Basic knowledge base auto-reply (keyword match)
- Configurable welcome message & announcement
- Search conversations
- Light/dark mode support (Tailwind)

## Socket.io Events
- `visitor_join` - Visitor connects
- `send_message` - Send a message
- `new_message` - Receive message
- `typing` - Typing indicator
- `agent_status` - Agent status update
- `conversation_resolved` - Conversation closed

## Next Steps / Extensions
- Image upload (multer + storage)
- Full blacklist
- Better visitor creation flow
- Production deployment (PM2, Nginx, Docker)
- More shadcn components
- Emoji picker

## Notes
This is a practical, focused implementation prioritizing simplicity and clean UI. Extend as needed for production use.

Default credentials example: admin@example.com / password (after inserting hashed password).
