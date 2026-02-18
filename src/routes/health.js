import express from 'express';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.get('/', async (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: { status: 'unknown' },
        ai: { status: 'unknown' },
        system: {},
        stats: {},
    };

    // ── Database check ──
    try {
        const dbState = mongoose.connection.readyState;
        // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
        health.database = {
            status: dbState === 1 ? 'connected' : 'disconnected',
            readyState: dbState,
        };
        if (dbState !== 1) health.status = 'degraded';
    } catch (err) {
        health.database = { status: 'error', error: err.message };
        health.status = 'degraded';
    }

    // ── AI / OpenAI key check ──
    try {
        if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
        health.ai = { status: 'configured', provider: 'OpenAI' };
    } catch (err) {
        health.ai = { status: 'not_configured', error: err.message };
        health.status = 'degraded';
    }

    // ── System info ──
    const mem = process.memoryUsage();
    health.system = {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: `${Math.floor(process.uptime())}s`,
        memoryUsage: `${Math.round(mem.heapUsed / 1024 / 1024)} MB / ${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
    };

    // ── DB stats ──
    try {
        if (mongoose.connection.readyState === 1) {
            const db = mongoose.connection.db;
            const [codebases, codeFiles, questions] = await Promise.all([
                db.collection('codebases').countDocuments(),
                db.collection('codefiles').countDocuments(),
                db.collection('questions').countDocuments(),
            ]);
            health.stats = { codebases, codeFiles, questions };
        }
    } catch {
        health.stats = {};
    }

    res.status(200).json(health);
});

export default router;
