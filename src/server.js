import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDatabase } from './models/database.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'https://repomind-frontend-ogqe.onrender.com'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure required directories exist
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('📁 Created uploads directory');
}

// Import routes
import uploadRouter from './routes/upload.js';
import questionRouter from './routes/question.js';
import historyRouter from './routes/history.js';
import refactorRouter from './routes/refactor.js';
import healthRouter from './routes/health.js';

// Routes
app.use('/api/upload', uploadRouter);
app.use('/api/question', questionRouter);
app.use('/api/history', historyRouter);
app.use('/api/refactor', refactorRouter);
app.use('/api/health', healthRouter);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Aggrosso API is running!',
    version: '1.0.0',
    endpoints: {
      upload: '/api/upload/zip or /api/upload/github',
      question: '/api/question/ask',
      history: '/api/history/:codebaseId',
      refactor: '/api/refactor',
      health: '/api/health'
    }
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.url} not found`
  });
});

// Start server
async function startServer() {
  try {
    // Initialize database (connect to MongoDB)
    await initDatabase();

    app.listen(PORT, () => {
      console.log(`🚀 Aggrosso backend server running on port ${PORT}`);
      console.log(`📁 Upload directory: ${uploadDir}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
